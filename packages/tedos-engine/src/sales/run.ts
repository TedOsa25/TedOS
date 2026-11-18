import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Kind = "target" | "signup" | "inquiry" | "booking" | "reply" | "opt_out" | "bounce" | "demo_held" | "won";
type Event = {
  id: string;
  account: string;
  kind: Kind;
  at: string;
  source?: string | undefined;
  evidence?: string | undefined;
  fit?: "yes" | "no" | "unknown" | undefined;
};
const kinds: Kind[] = ["target", "signup", "inquiry", "booking", "reply", "opt_out", "bounce", "demo_held", "won"];
const interestKinds: Kind[] = ["signup", "inquiry", "booking", "reply"];
const priority: Record<Kind, number> = {
  target: 0, signup: 1, inquiry: 2, reply: 3, booking: 4,
  demo_held: 5, won: 6, bounce: 7, opt_out: 8,
};
const nextStep: Record<Kind, string> = {
  target: "review_target", signup: "review_signup", inquiry: "review_inquiry",
  booking: "prepare_demo", reply: "review_reply", bounce: "suppress_contact",
  opt_out: "suppress_contact", demo_held: "prepare_followup_draft", won: "complete",
};

function parse(line: string): Event {
  const item = JSON.parse(line) as Partial<Event>;
  if (!item || typeof item.id !== "string" || !item.id.trim() ||
      typeof item.account !== "string" || !item.account.trim() ||
      !kinds.includes(item.kind as Kind) || typeof item.at !== "string" ||
      !Number.isFinite(Date.parse(item.at)) ||
      (item.source !== undefined && typeof item.source !== "string") ||
      (item.evidence !== undefined && typeof item.evidence !== "string") ||
      (item.fit !== undefined && !["yes", "no", "unknown"].includes(item.fit))) {
    throw new Error("Invalid sales event");
  }
  const event = item as Event;
  if (event.kind === "target" && !event.evidence?.trim()) throw new Error("Target requires evidence");
  return { id: event.id.trim(), account: event.account.trim().toLowerCase(), kind: event.kind,
    at: new Date(event.at).toISOString(), source: event.source, evidence: event.evidence, fit: event.fit };
}

function project(events: Event[]) {
  const grouped = new Map<string, Event[]>();
  for (const event of events) {
    const accountEvents = grouped.get(event.account) ?? [];
    accountEvents.push(event);
    grouped.set(event.account, accountEvents);
  }
  return [...grouped].map(([account, history]) => {
    const ordered = history.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const strongest = ordered.reduce((best, event) => priority[event.kind] >= priority[best.kind] ? event : best);
    const firstInterest = ordered.find(event => interestKinds.includes(event.kind));
    return {
      account,
      interested: Boolean(firstInterest),
      source: firstInterest?.source?.trim() || "unknown",
      nextStep: nextStep[strongest.kind],
      fit: ordered.filter(event => event.fit).at(-1)?.fit ?? "unknown",
      evidence: [...new Set(ordered.flatMap(event => event.evidence ? [event.evidence] : []))],
      demoHeld: history.some(event => event.kind === "demo_held"),
      won: history.some(event => event.kind === "won"),
    };
  });
}

const [input, stateDir] = process.argv.slice(2);
if (!input || !stateDir) throw new Error("Usage: npm run sales:shadow -- INPUT.ndjson STATE_DIRECTORY");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const lock = join(stateDir, "run.lock");
mkdirSync(lock);
try {
  const ledgerPath = join(stateDir, "ledger.json");
  let prior: Event[] = [];
  try {
    prior = JSON.parse(readFileSync(ledgerPath, "utf8")) as Event[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ledger = new Map(prior.map(event => [event.id, event]));
  for (const line of readFileSync(input!, "utf8").split(/\r?\n/).filter(line => line.trim())) {
    const event = parse(line);
    const previous = ledger.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error("Conflicting sales event ID");
    ledger.set(event.id, event);
  }
  const events = [...ledger.values()];
  const accounts = project(events);
  const bySource = new Map<string, { leads: number; qualifiedDemos: number; wins: number }>();
  for (const item of accounts) {
    const totals = bySource.get(item.source) ?? { leads: 0, qualifiedDemos: 0, wins: 0 };
    totals.leads += Number(item.interested);
    totals.qualifiedDemos += Number(item.demoHeld && item.fit === "yes");
    totals.wins += Number(item.won);
    bySource.set(item.source, totals);
  }
  function save(name: string, value: unknown) {
    const path = join(stateDir!, name);
    writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(path + ".tmp", path);
  }
  save("ledger.json", events);
  save("snapshot.json", { mode: "shadow", ranAt: new Date().toISOString(), accounts,
    targetAccountsWithoutInterest: accounts.filter(item => item.nextStep === "review_target").length,
    bySource: Object.fromEntries(bySource) });
  console.log(JSON.stringify({ events: events.length, newEvents: events.length - prior.length, accounts: accounts.length }));
} finally {
  rmSync(lock, { recursive: true });
}
