// A/B-AUSWERTUNG — was der Test tatsächlich ergeben hat.
//
// Ein Test ohne Auswertung ist nur eine kompliziertere Art, dasselbe zu tun.
// Dieser Bericht liest die je Lead gespeicherte Tonalität und Betreffvariante
// und stellt ihnen das Ergebnis gegenüber: zugestellt, gebounct, geantwortet.
//
// EHRLICHKEIT ÜBER SIGNIFIKANZ: Bei den hier realistischen Fallzahlen ist ein
// Unterschied von ein, zwei Antworten Rauschen. Der Bericht nennt deshalb pro
// Arm, wie viele Antworten nötig wären, um überhaupt etwas ablesen zu können,
// statt einen Sieger auszurufen, den die Daten nicht hergeben.
//
//   TEDOS_STORAGE_PATH=./.revenue-state npm run ab:report

import { createStorage } from "./../storage.js";
import { loadLeadStatus, type LeadRecord } from "./batch-send.js";
import { describeExperiment, experimentConfig } from "./experiment.js";

interface Arm { sent: number; bounced: number; replied: number; demo: number }

const leer = (): Arm => ({ sent: 0, bounced: 0, replied: 0, demo: 0 });

function zaehle(records: LeadRecord[], key: (r: LeadRecord) => string): Map<string, Arm> {
  const m = new Map<string, Arm>();
  for (const r of records) {
    const k = key(r);
    const a = m.get(k) ?? leer();
    if (r.status === "bounced") a.bounced += 1;
    else if (r.status === "replied") a.replied += 1;
    else if (r.status === "demo-booked") a.demo += 1;
    else a.sent += 1;
    m.set(k, a);
  }
  return m;
}

function tabelle(titel: string, m: Map<string, Arm>): void {
  console.log(`\n── ${titel} ──`);
  console.log(`  ${"Arm".padEnd(10)} ${"versendet".padStart(10)} ${"Bounces".padStart(9)} ${"Antworten".padStart(10)} ${"Quote".padStart(8)}`);
  const zeilen = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, a] of zeilen) {
    const gesamt = a.sent + a.bounced + a.replied + a.demo;
    const antw = a.replied + a.demo;
    const quote = gesamt ? ((antw / gesamt) * 100).toFixed(2) + " %" : "—";
    console.log(`  ${k.padEnd(10)} ${String(gesamt).padStart(10)} ${String(a.bounced).padStart(9)} ${String(antw).padStart(10)} ${quote.padStart(8)}`);
  }
  const gesamtN = zeilen.reduce((s, [, a]) => s + a.sent + a.bounced + a.replied + a.demo, 0);
  const gesamtA = zeilen.reduce((s, [, a]) => s + a.replied + a.demo, 0);
  if (gesamtA < zeilen.length * 5) {
    console.log(`  ⚠ ${gesamtA} Antworten auf ${zeilen.length} Arme — zu wenig für eine Aussage.`);
    console.log(`    Faustregel: mindestens 5 Antworten JE ARM, hier also ${zeilen.length * 5}.`);
    if (gesamtA > 0 && gesamtN > 0) {
      const proMail = gesamtA / gesamtN;
      console.log(`    Bei aktuell ${(proMail * 100).toFixed(2)} % Antwortquote wären das rund ${Math.ceil((zeilen.length * 5) / proMail)} Mails.`);
    }
  }
}

function main(): void {
  if (!process.env.TEDOS_STORAGE_PATH) { console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt."); process.exitCode = 1; return; }
  const records = Object.values(loadLeadStatus(createStorage())).filter((r) => r.sent_at);
  console.log(`\n═══ A/B-Auswertung · ${records.length} versendete Mails ═══`);
  console.log(`Aktuelle Konfiguration: ${describeExperiment(experimentConfig())}`);

  const mitIndex = records.filter((r) => typeof r.subjectIndex === "number");
  if (!mitIndex.length) {
    console.log(`\n⚠ Kein einziger Datensatz trägt eine Betreffvariante.`);
    console.log(`  Alle ${records.length} Mails gingen vor Einführung der Zuteilung raus —`);
    console.log(`  ausschliesslich Tonalität E mit Betreff 0. Es gibt nichts zu vergleichen.`);
  }

  tabelle("Tonalität", zaehle(records, (r) => r.variant ?? "?"));
  if (mitIndex.length) tabelle("Betreffzeile", zaehle(mitIndex, (r) => `Betreff ${r.subjectIndex}`));
  if (mitIndex.length) tabelle("Kombination", zaehle(mitIndex, (r) => `${r.variant}/${r.subjectIndex}`));
  console.log("");
}

main();
