// Ausfuehrer starten. Ohne Hauptschalter wird NUR angezeigt, was faellig waere.
//
//   npm run growth:ausfuehren -- [--runtime <dir>]
//
// Hauptschalter: <runtime>/growth/ausfuehren.json
//   { "scharf": true, "bildBasis": "https://…/social" }
// Fehlt die Datei oder steht "scharf" nicht auf true, passiert nichts nach aussen.
// Schluessel: Schluesselbund-Dienst "heyaudit-meta-write" (Systemnutzer mit
// Kampagnen- und Instagram-Rechten). Fuehrt nur freigegebene Vorschlaege aus.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import {
  faelligeBeitraege,
  faelligeMetaAktionen,
  fuehreMetaAus,
  instagramKonto,
  postSchluessel,
  veroeffentliche,
  type Veroeffentlicht,
} from "./ausfuehren.js";
import type { Wochenplan } from "./content-plan.js";
import { tokenAus } from "./meta-run.js";
import { SignalLog, signal } from "./signal.js";

export const SCHREIB_DIENST = "heyaudit-meta-write";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function lies<T>(pfad: string, standard: T): T {
  return existsSync(pfad) ? (JSON.parse(readFileSync(pfad, "utf8")) as T) : standard;
}

async function main(): Promise<void> {
  const jetzt = new Date();
  const growth = join(resolve(arg("runtime") ?? "runtime/heyaudit"), "growth");
  const schalter = lies<{ scharf?: boolean; bildBasis?: string }>(join(growth, "ausfuehren.json"), {});
  const scharf = schalter.scharf === true;

  const queue = new ApprovalQueue(new JsonFileStorage(growth));
  const freigaben = queue.all();
  const inhalt = join(growth, "content");
  const plaene = existsSync(inhalt)
    ? readdirSync(inhalt)
        .filter((f) => /^plan-\d{4}-kw\d{2}\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(join(inhalt, f), "utf8")) as Wochenplan)
    : [];
  const erledigtPfad = join(growth, "veroeffentlicht.json");
  const erledigt = lies<Veroeffentlicht>(erledigtPfad, {});

  const posts = faelligeBeitraege(plaene, freigaben, erledigt, jetzt);
  const meta = faelligeMetaAktionen(freigaben);
  for (const e of posts.verpasst) console.error(`Verpasst (wird nicht nachgeholt): ${e.datum} ${e.motiv.titel}`);
  if (!posts.heute.length && !meta.length) {
    console.error("Ausführen: nichts fällig.");
    return;
  }
  if (!scharf) {
    for (const e of posts.heute) console.error(`Wäre fällig (Hauptschalter aus): Instagram ${e.art} ${e.motiv.titel}`);
    for (const a of meta) console.error(`Wäre fällig (Hauptschalter aus): Meta ${a.art} ${a.objektId}`);
    return;
  }

  let roh = "";
  try {
    roh = execFileSync("security", ["find-generic-password", "-s", SCHREIB_DIENST, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    roh = "";
  }
  const token = tokenAus(roh);
  if (!token) {
    console.error(`Ausführen: kein Schreib-Schlüssel (${SCHREIB_DIENST}) im Schlüsselbund.`);
    return;
  }
  const log = new SignalLog(join(growth, "signale.jsonl"));

  if (posts.heute.length) {
    if (!schalter.bildBasis) {
      console.error("Instagram: bildBasis fehlt in ausfuehren.json, nichts veröffentlicht.");
    } else {
      const igId = await instagramKonto(token);
      for (const e of posts.heute) {
        try {
          const mediaId = await veroeffentliche(e, igId, schalter.bildBasis, token);
          erledigt[postSchluessel(e)] = { mediaId, zeit: new Date().toISOString() };
          writeFileSync(erledigtPfad, JSON.stringify(erledigt, null, 2) + "\n", "utf8");
          log.anhaengen([signal({ von: "instagram", art: "ausgefuehrt.beitrag", modus: "approval_required", betreff: e.motiv.titel, daten: { mediaId, datum: e.datum }, belege: [] }, jetzt)]);
          console.error(`Instagram: veröffentlicht ${e.motiv.titel} (${mediaId})`);
        } catch (err) {
          console.error(`Instagram: ${e.motiv.titel} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  for (const a of meta) {
    try {
      await fuehreMetaAus(a, token);
      queue.markImplemented(a.goalId);
      log.anhaengen([signal({ von: "meta_ads", art: `ausgefuehrt.${a.art}`, modus: "approval_required", betreff: a.goalId, daten: a, belege: [] }, jetzt)]);
      console.error(`Meta: ${a.art} ${a.objektId} umgesetzt`);
    } catch (err) {
      console.error(`Meta: ${a.goalId} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (process.argv[1]?.endsWith("ausfuehren-run.ts")) {
  main().catch((e) => console.error(`Ausführen: ${e instanceof Error ? e.message : String(e)}`));
}
