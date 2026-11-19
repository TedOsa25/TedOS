// Instagram-Wochenplan erzeugen (Content-Agent). VEROEFFENTLICHT NICHTS.
//
//   npm run growth:content -- [--runtime <dir>] [--marketing <dir>] [--dry] [--neu] [--wochenmix]
//
// Standard: Tagesplan, jeden Morgen ein Post im Format vom 04.11. (tagesplan.ts).
// --wochenmix: alter Plan (4 Posts, 2 Storys aus dem Design-Katalog).
// --neu: vorhandenen, noch NICHT freigegebenen Plan der Woche neu erzeugen;
//        der alte Vorschlag wird als abgelehnt ("ersetzt") markiert.
// Mit --marketing werden fehlende Bilder <marketing>/motive/<id>.png aus
// format-katalog.ts mit Chrome (headless) gerendert, 2160×2160.
//
// --marketing: Ordner mit motive/<id>.png; der Plan wird zusaetzlich nach
// <marketing>/wochenplaene/ kopiert und nennt je Beitrag die Bilddatei.
//
// Plant die kommende Woche aus dem Katalog, beruecksichtigt fruehere Plaene
// (<runtime>/growth/content/plan-*.json), schreibt Plan als JSON und Markdown,
// legt EINEN Freigabe-Vorschlag in die Growth-Warteschlange und protokolliert
// ein Signal. Gleicher Plan zweimal erzeugt: nur ein Vorschlag (goalId je KW).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { KATALOG } from "./content-katalog.js";
import { baueWochenplan, isoWoche, naechsterMontag, renderWochenplan, wochenplanFreigabe, type Wochenplan } from "./content-plan.js";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { FORMAT_KATALOG, formatHtml } from "./format-katalog.js";
import { baueTagesplan } from "./tagesplan.js";
import { baueLinkedinPlan, linkedinFreigabe, renderLinkedinPlan } from "./linkedin.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Rendert fehlende Format-Bilder. Gibt die IDs zurueck, die nicht gerendert werden konnten. */
export function rendereBilder(ids: string[], motivOrdner: string): string[] {
  const fehlt: string[] = [];
  mkdirSync(motivOrdner, { recursive: true });
  for (const id of ids) {
    const ziel = join(motivOrdner, `${id}.png`);
    if (existsSync(ziel)) continue;
    const m = FORMAT_KATALOG.find((x) => x.id === id);
    if (!m || !existsSync(CHROME)) { fehlt.push(id); continue; }
    const html = join(tmpdir(), `heyaudit-${id}.html`);
    writeFileSync(html, formatHtml(m), "utf8");
    try {
      execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1080,1080", "--force-device-scale-factor=2", "--virtual-time-budget=5000", `--screenshot=${ziel}`, `file://${html}`], { stdio: "ignore", timeout: 60_000 });
    } catch { /* Ergebnis unten pruefen */ }
    if (!existsSync(ziel)) fehlt.push(id);
  }
  return fehlt;
}
import { SignalLog, signal } from "./signal.js";
import { vorlegen } from "./vorlegen.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Fruehere Plaene -> wann welches Motiv zuletzt eingeplant war. */
export function verlaufAus(plaene: Pick<Wochenplan, "eintraege">[]): { motivId: string; datum: string }[] {
  return plaene.flatMap((p) => p.eintraege.map((e) => ({ motivId: e.motiv.id, datum: e.datum })));
}

function main(): void {
  const jetzt = new Date();
  const runtime = resolve(arg("runtime") ?? "runtime/heyaudit");
  const growth = join(runtime, "growth");
  const ordner = join(growth, "content");

  // Ein Plan je Woche: existiert er schon, wird er wiederverwendet, nie neu gemischt.
  const { jahr, kw } = isoWoche(naechsterMontag(jetzt));
  const name = `plan-${jahr}-kw${String(kw).padStart(2, "0")}`;
  const frueher = existsSync(ordner)
    ? readdirSync(ordner)
        .filter((f) => /^plan-\d{4}-kw\d{2}\.json$/.test(f) && f !== `${name}.json`)
        .map((f) => JSON.parse(readFileSync(join(ordner, f), "utf8")) as Wochenplan)
    : [];
  const vorhanden = join(ordner, `${name}.json`);
  const queue = new ApprovalQueue(new JsonFileStorage(growth));
  const goalId = `growth:content:ig-${jahr}-kw${String(kw).padStart(2, "0")}`;
  const neu = process.argv.includes("--neu");
  if (neu && queue.all().some((e) => e.goalId === goalId && (e.status === "approved" || e.status === "implemented"))) {
    console.error(`--neu abgelehnt: ${goalId} ist schon freigegeben. Erst ablehnen, dann neu erzeugen.`);
    return;
  }
  const plan = existsSync(vorhanden) && !neu
    ? (JSON.parse(readFileSync(vorhanden, "utf8")) as Wochenplan)
    : process.argv.includes("--wochenmix")
      ? baueWochenplan(KATALOG, { jetzt, verlauf: verlaufAus(frueher) })
      : baueTagesplan({ jetzt, verlauf: verlaufAus(frueher) });
  if (neu && !process.argv.includes("--dry") && queue.pending().some((e) => e.goalId === goalId)) queue.reject(goalId);
  const text = renderWochenplan(plan);

  if (process.argv.includes("--dry")) {
    process.stdout.write(text);
    console.error(`\n(--dry: nichts geschrieben. Ziel wäre ${ordner})`);
    return;
  }

  mkdirSync(ordner, { recursive: true });
  const marketing = arg("marketing");
  if (marketing) {
    const m = resolve(marketing);
    mkdirSync(join(m, "wochenplaene"), { recursive: true });
    const nichtGerendert = rendereBilder(plan.eintraege.map((e) => e.motiv.id).filter((id) => id.startsWith("f_")), join(m, "motive"));
    if (nichtGerendert.length) console.error(`Bilder nicht gerendert: ${nichtGerendert.join(", ")}`);
    const fehlend = plan.eintraege.filter((e) => !existsSync(join(m, "motive", `${e.motiv.id}.png`))).map((e) => e.motiv.id);
    const bilder = plan.eintraege.map((e) => `- ${e.wochentag}: ${join(m, "motive", `${e.motiv.id}.png`)}`).join("\n");
    writeFileSync(
      join(m, "wochenplaene", `${name}.md`),
      `${text}\n## Bilder\n${bilder}\n${fehlend.length ? `\nFEHLT im Ordner motive/: ${fehlend.join(", ")}\n` : ""}`,
      "utf8",
    );
  }
  writeFileSync(join(ordner, `${name}.json`), JSON.stringify(plan, null, 2) + "\n", "utf8");
  writeFileSync(join(ordner, `${name}.md`), text, "utf8");

  const vorschlag = wochenplanFreigabe(plan);
  const vorher = queue.pending().some((e) => e.goalId === vorschlag.goalId);
  vorlegen(queue, vorschlag);

  new SignalLog(join(growth, "signale.jsonl")).anhaengen([
    signal(
      {
        von: "content_strategy",
        an: "instagram",
        art: "vorschlag.wochenplan",
        modus: "approval_required",
        betreff: vorschlag.title,
        daten: { goalId: vorschlag.goalId, datei: `${name}.md`, eintraege: plan.eintraege.length },
        belege: [],
      },
      jetzt,
    ),
  ]);

  // LinkedIn: gleiche Woche, gleiche Motive (Di bis Do), eigener Vorschlag.
  if (!process.argv.includes("--wochenmix")) {
    const li = baueLinkedinPlan(plan);
    const liName = `linkedin-${jahr}-kw${String(kw).padStart(2, "0")}`;
    const liText = renderLinkedinPlan(li);
    writeFileSync(join(ordner, `${liName}.json`), JSON.stringify(li, null, 2) + "\n", "utf8");
    writeFileSync(join(ordner, `${liName}.md`), liText, "utf8");
    if (marketing) writeFileSync(join(resolve(marketing), "wochenplaene", `${liName}.md`), liText, "utf8");
    const liVorschlag = linkedinFreigabe(li);
    vorlegen(queue, liVorschlag);
    console.error(`LinkedIn: ${join(ordner, `${liName}.md`)} (${li.eintraege.length} Posts)`);
  }

  process.stdout.write(text);
  console.error(`\nPlan: ${join(ordner, `${name}.md`)}${vorher ? " (Vorschlag lag schon in der Warteschlange)" : " · Vorschlag in der Freigabe-Warteschlange"}`);
}

if (process.argv[1]?.endsWith("content-run.ts")) main();
