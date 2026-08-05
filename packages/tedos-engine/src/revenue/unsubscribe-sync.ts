// UNSUBSCRIBE SYNC — pulls the opt-outs recorded on heycarbo.com into the
// local lead store, so an unsubscribed contact can never be approved or mailed
// again.
//
// The website records only an opaque token (it deliberately never learns which
// company or address it belongs to). The mapping token → lead id exists ONLY
// here, because only the engine knows the salt. So the resolution runs locally:
// we recompute every lead's token and match.
//
//   TEDOS_STORAGE_PATH=./.revenue-state \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   npm run unsubscribe:sync            # preview
//   npm run unsubscribe:sync -- --apply # persist the opt-outs
//
// Preview by default: it never writes without --apply. Running it twice is
// harmless — unsubscribeLead is idempotent for an already-opted-out lead.

import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { activeBrandProfile } from "./brand-profile.js";
import { loadLeadStatus, unsubscribeLead } from "./batch-send.js";
import { unsubscribeToken } from "./email-template.js";

const APPLY = process.argv.includes("--apply");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface RemoteOptOut {
  token: string;
  unsubscribed_at: string;
  source: string;
}

async function fetchOptOuts(endpoint: string, since?: string): Promise<RemoteOptOut[]> {
  const url = new URL(endpoint);
  if (since) url.searchParams.set("since", since);
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Abruf fehlgeschlagen (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.unsubscribes ?? []) as RemoteOptOut[];
}

async function main(): Promise<void> {
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — Abbruch (Opt-outs müssen im geteilten Store landen).");
    return;
  }
  const endpoint = process.env.REVENUE_UNSUBSCRIBE_POST_URL ?? activeBrandProfile().urls.unsubscribePostUrl;
  if (!endpoint) {
    console.log("⚠ Kein Unsubscribe-Endpunkt konfiguriert (brand profile urls.unsubscribePostUrl). Abbruch.");
    return;
  }
  if (!SERVICE_KEY) {
    console.log("⚠ SUPABASE_SERVICE_ROLE_KEY nicht gesetzt — das Opt-out-Register ist bewusst nicht öffentlich lesbar. Abbruch.");
    return;
  }

  const optOuts = await fetchOptOuts(endpoint, process.env.REVENUE_UNSUBSCRIBE_SINCE);
  console.log(`Opt-out-Register: ${optOuts.length} Einträge abgerufen.`);
  if (optOuts.length === 0) {
    console.log("Nichts zu synchronisieren.");
    return;
  }

  // token → lead id, recomputed locally (the salt never leaves this machine).
  const accounts = loadAccounts();
  const byToken = new Map<string, { id: string; company: string }>();
  for (const a of accounts) byToken.set(unsubscribeToken(a.id), { id: a.id, company: a.company });

  const storage = createStorage();
  const status = loadLeadStatus(storage);

  const toApply: { id: string; company: string; at: string; source: string }[] = [];
  const unknown: string[] = [];
  let already = 0;

  for (const o of optOuts) {
    const lead = byToken.get(o.token.toLowerCase());
    if (!lead) { unknown.push(o.token); continue; }
    if (status[lead.id]?.status === "unsubscribed") { already += 1; continue; }
    toApply.push({ ...lead, at: o.unsubscribed_at, source: o.source });
  }

  console.log(`Zuordnung: ${toApply.length} neu · ${already} bereits abgemeldet · ${unknown.length} ohne passenden Lead`);
  if (unknown.length) {
    // A token with no matching lead is expected after a CRM export changes ids,
    // and must NOT be silently dropped — it is an opt-out we owe someone.
    console.log(`  ⚠ Unzuordenbare Tokens (bitte prüfen): ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? " …" : ""}`);
  }

  for (const t of toApply) console.log(`  • ${t.company} (${t.id}) · ${t.source} · ${t.at}`);

  if (!APPLY) {
    console.log("\n(Vorschau — nichts geändert. Mit --apply übernehmen.)");
    return;
  }
  // createIfMissing: the token → id resolution above ran against the full CRM,
  // so a lead with no status row yet is still a real, correctly identified
  // opt-out and must be recorded.
  for (const t of toApply) unsubscribeLead(storage, t.id, `Opt-out (${t.source})`, () => t.at, true);
  console.log(`\n→ ${toApply.length} Lead(s) auf "unsubscribed" gesetzt.`);
}

main().catch((e) => { console.error("unsubscribe-sync failed:", (e as Error).message); process.exitCode = 1; });
