// Growth-Briefing ausfuehren (fuer 08:00 gedacht).
//
//   npm run growth:briefing -- [--aktivierung <json>] [--meta <json>]
//                              [--runtime <dir>] [--aus <dir>] [--dry]
//
// Liest (nie schreibend): Outbound-Stand aus --runtime (Default runtime/heyaudit),
// optional Aktivierungs-JSON (heyaudit-dashboard: pnpm growth:aktivierung -- --json)
// und optional eine Meta-Kennzahlen-JSON.
// Schreibt nur in --aus (Default <runtime>/growth): Briefing als Markdown,
// Vorschlaege in die eigene ApprovalQueue, Signale ins Protokoll.
// --dry schreibt gar nichts und gibt nur das Briefing aus.
// Versendet nichts, veroeffentlicht nichts, aendert keine Budgets.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue, type ApprovalEntry } from "../approval-queue.js";
import { lifecycleCounts } from "../revenue/reporting.js";
import { InMemoryStorage, JsonFileStorage } from "../storage.js";
import { baueBriefing, briefingSignale, renderBriefing, type BriefingQuellen } from "./briefing.js";
import { vorlegen } from "./vorlegen.js";
import { NurLeseSpeicher, SignalLog } from "./signal.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function jsonLesen<T>(pfad: string | undefined): T | undefined {
  if (!pfad) return undefined;
  return JSON.parse(readFileSync(resolve(pfad), "utf8")) as T;
}

/** Ist der launchd-Versandjob geladen? Nur lesend (launchctl print). */
function versandJobGeladen(): boolean | null {
  if (process.platform !== "darwin") return null;
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const r = spawnSync("launchctl", ["print", `gui/${uid}/com.heyaudit.versand`], { stdio: "ignore" });
  return r.status === 0;
}

function main(): void {
  const jetzt = new Date();
  const dry = process.argv.includes("--dry");
  const runtime = resolve(arg("runtime") ?? "runtime/heyaudit");
  const aus = resolve(arg("aus") ?? join(runtime, "growth"));

  // Outbound: fremder Laufzeitstand, nur lesen.
  let outbound: BriefingQuellen["outbound"];
  const statusDatei = join(runtime, "revenue-lead-status.json");
  if (existsSync(statusDatei)) {
    const lesen = new NurLeseSpeicher(new JsonFileStorage(runtime));
    const tagDatei = join(runtime, "letzter-versandtag");
    outbound = {
      stand: statSync(statusDatei).mtime.toISOString(),
      lifecycle: lifecycleCounts(lesen),
      letzterVersandtag: existsSync(tagDatei) ? readFileSync(tagDatei, "utf8").trim() : null,
      versandJobGeladen: versandJobGeladen(),
    };
  }

  // Eigene Freigabe-Warteschlange des Growth OS (bestehende ApprovalQueue-Klasse).
  const vorhanden = existsSync(join(aus, "approval-queue.json"))
    ? (JSON.parse(readFileSync(join(aus, "approval-queue.json"), "utf8")) as ApprovalEntry[])
    : [];
  const speicher = dry ? new InMemoryStorage() : new JsonFileStorage(aus);
  if (dry) speicher.save("approval-queue", vorhanden);
  const queue = new ApprovalQueue(speicher);

  const quellen: BriefingQuellen = {
    jetzt,
    freigaben: {
      stats: queue.stats(),
      offen: queue.pending().map((e) => ({ goalId: e.goalId, title: e.title, createdAt: e.createdAt })),
    },
  };
  const aktivierung = jsonLesen<NonNullable<BriefingQuellen["aktivierung"]>>(arg("aktivierung"));
  if (aktivierung) quellen.aktivierung = aktivierung;
  const meta = jsonLesen<NonNullable<BriefingQuellen["meta"]>>(arg("meta"));
  if (meta) quellen.meta = meta;
  const metaAds = jsonLesen<NonNullable<BriefingQuellen["metaAds"]>>(arg("meta-ads"));
  if (metaAds) quellen.metaAds = metaAds;
  if (outbound) quellen.outbound = outbound;

  const briefing = baueBriefing(quellen);
  const vorher = new Set(queue.pending().map((e) => e.goalId));
  for (const v of briefing.vorschlaege) vorlegen(queue, v);
  const neu = queue.pending().filter((e) => !vorher.has(e.goalId)).length;

  const text = renderBriefing(briefing, neu);
  if (dry) {
    process.stdout.write(text);
    console.error(`\n(--dry: nichts geschrieben. Ziel wäre ${aus})`);
    return;
  }
  mkdirSync(join(aus, "briefings"), { recursive: true });
  const datei = join(aus, "briefings", `${briefing.datum}.md`);
  writeFileSync(datei, text, "utf8");
  new SignalLog(join(aus, "signale.jsonl")).anhaengen(briefingSignale(briefing, jetzt));
  process.stdout.write(text);
  console.error(`\nBriefing: ${datei}`);
}

main();
