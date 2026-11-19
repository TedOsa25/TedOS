// Meta-Ads-Agent ausfuehren. NUR LESEN, fuehrt nichts aus.
//
//   npm run growth:meta-ads -- [--tage 30] [--runtime <dir>] [--dry]
//
// Liest das Werbekonto (Schluessel heyaudit-meta-ads-read), schreibt die
// Befunde nach <runtime>/growth/eingang/meta-ads.json (fuer das Briefing),
// legt Vorschlaege in die Growth-Warteschlange und protokolliert Signale.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { analysiere, holeMetaKonto } from "./meta-ads.js";
import { META_KEYCHAIN_DIENST } from "./meta-insights.js";
import { tokenAus } from "./meta-run.js";
import { vorlegen } from "./vorlegen.js";
import { SignalLog, signal } from "./signal.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const jetzt = new Date();
  const tage = Number(arg("tage") ?? 30);
  const growth = join(resolve(arg("runtime") ?? "runtime/heyaudit"), "growth");
  let roh = "";
  try {
    roh = execFileSync("security", ["find-generic-password", "-s", META_KEYCHAIN_DIENST, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    roh = "";
  }
  const token = tokenAus(roh);
  if (!token) {
    console.error("Meta-Ads: kein Lese-Schlüssel im Schlüsselbund.");
    return;
  }
  const konto = await holeMetaKonto(token, tage, jetzt);
  const a = analysiere(konto);
  const ergebnis = { stand: konto.stand, zeitraumTage: tage, kostenJeRegistrierung: a.kostenJeRegistrierung, befunde: a.befunde, vorschlaege: a.vorschlaege.map((v) => v.title) };

  if (process.argv.includes("--dry")) {
    process.stdout.write(JSON.stringify(ergebnis, null, 2) + "\n");
    return;
  }
  mkdirSync(join(growth, "eingang"), { recursive: true });
  writeFileSync(join(growth, "eingang", "meta-ads.json"), JSON.stringify(ergebnis, null, 2) + "\n", "utf8");
  const queue = new ApprovalQueue(new JsonFileStorage(growth));
  for (const v of a.vorschlaege) vorlegen(queue, v);
  new SignalLog(join(growth, "signale.jsonl")).anhaengen([
    signal({ von: "meta_ads", art: "analyse.erstellt", modus: "observe", betreff: `${a.befunde.length} Befunde`, daten: ergebnis, belege: [] }, jetzt),
    ...a.vorschlaege.map((v, i) =>
      signal({ von: "meta_ads", art: "vorschlag.kampagne", modus: "approval_required", betreff: v.title, daten: { goalId: v.goalId }, belege: [] }, jetzt, i + 1),
    ),
  ]);
  console.error(`Meta-Ads: ${a.befunde.length} Befunde, ${a.vorschlaege.length} Vorschläge`);
}

if (process.argv[1]?.endsWith("meta-ads-run.ts")) {
  main().catch((e) => console.error(`Meta-Ads: fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`));
}
