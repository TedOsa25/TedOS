// NACHFASS-VERSAND — die zweite Stufe der Sequenz.
//
// In der Kaltakquise kommt ein erheblicher Teil der Antworten erst aus den
// Nachfassmails. followUp1/followUp2 werden längst für jeden Lead erzeugt, es
// gab dafür nur nie einen Versandweg — 1.614 Kontakte warten unbeantwortet.
//
// SICHERUNGEN (in dieser Reihenfolge)
//   1. POSTEINGANGS-GATE. Ohne frischen inbox:scan wird gar nicht erst
//      ausgewählt. Wer geantwortet oder sich abgemeldet hat, steht sonst noch
//      auf "sent" und bekäme ein "haben Sie meine Mail gesehen?" — der
//      sicherste Weg, einen warmen Kontakt zu verbrennen bzw. bei einer
//      Abmeldung ein Rechtsverstoß.
//   2. Nur Status "sent". Jede Reaktion (replied/unsubscribed/bounced/
//      demo-booked/won/lost) verlässt diesen Status und damit die Sequenz.
//   3. Maximal ZWEI Nachfassmails je Lead, danach ist Schluss.
//   4. Mindestabstand in WERKTAGEN, nicht Kalendertagen.
//   5. Derselbe Preflight wie beim Erstkontakt (SMTP · DNS · Abmelde-Register
//      · Landingpages · MX), inklusive Entfernen unzustellbarer Empfänger.
//
//   TEDOS_STORAGE_PATH=./.revenue-state ./send-batch.sh … (Erstkontakt)
//   npm run followup:send            # Vorschau
//   npm run followup:send -- --apply # versenden (zusätzlich REVENUE_SEND_ENABLED=1)

import { createStorage } from "./../storage.js";
import { loadAccounts, type Account } from "./accounts.js";
import { activeBrandProfile } from "./brand-profile.js";
import { selectedProviderName, getProvider, isSendArmed, dispatch, type OutboundEmail } from "./sending.js";
import { buildOpportunity } from "./revenue-engine.js";
import {
  loadLeadStatus, selectFollowUps, followUpGate, listUnsubscribeHeaders,
  type LeadRecord,
} from "./batch-send.js";
import { runPreflight, formatPreflight, recipientMxCheck, dnsMxResolver } from "./preflight.js";
import { writeReportFile } from "./report-file.js";
import { berlinDatum } from "./zeit.js";
import { istGrosskonzern } from "./grossunternehmen.js";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.env.REVENUE_FOLLOWUP_SIZE ?? 20);
const MIN1 = Number(process.env.REVENUE_FOLLOWUP_MIN1 ?? 4);
const MIN2 = Number(process.env.REVENUE_FOLLOWUP_MIN2 ?? 5);
/** Absurditätsgrenze in Werktagen. Qualität filtert `eligible`, nicht das Alter. */
const MAX = Number(process.env.REVENUE_FOLLOWUP_MAX ?? 60);
const SENDER = {
  email: process.env.REVENUE_FROM_EMAIL ?? activeBrandProfile().identity.senderEmail,
  name: process.env.REVENUE_FROM_NAME ?? activeBrandProfile().identity.senderName,
};

async function main(): Promise<void> {
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — Abbruch.");
    process.exitCode = 1;
    return;
  }
  const storage = createStorage();
  const now = new Date().toISOString();

  // === 1) Posteingangs-Gate — vor allem anderen ==============================
  const gate = followUpGate(storage, now);
  console.log(`\n── Posteingangs-Gate ──\n  ${gate.ok ? "✅" : "⛔"} ${gate.detail}`);
  if (!gate.ok) {
    console.log("\n⛔ Abbruch: Ohne ausgewerteten Posteingang darf nicht nachgefasst werden.");
    process.exitCode = 1;
    return;
  }

  const accounts = loadAccounts();
  const statusMap = loadLeadStatus(storage);
  /**
   * Wer heute keinen Erstkontakt bekäme, bekommt auch keine Nachfassmail.
   *
   * Was hier NICHT geprüft wird: ob die Adresse im Impressum belegt ist. Diese
   * Hürde gilt dem Erstkontakt, wo eine geratene Adresse 17,5 % Bounce
   * bedeutete. Bei einem bereits kontaktierten Lead ist die ZUSTELLUNG der
   * Beleg — die Mail ging raus und kam nicht zurück, sonst stünde er auf
   * "bounced" und wäre ohnehin gesperrt. Ein erster Anlauf verlangte den
   * Impressum-Nachweis trotzdem und sperrte damit 1.524 von 1.727 Kontakten,
   * also praktisch die ganze Kampagne.
   *
   * Was bleibt, sind die Fehler, die eine Zustellung NICHT ausschließt:
   * das falsche Postfach (ir@conti.de ist Investor Relations) und die falsche
   * Firmengröße (Continental hat 200.000 Mitarbeitende).
   */
  const eligible = (a: Account): boolean => {
    // 1) Falsches Postfach. ir@conti.de ist Investor Relations.
    //
    //    AUCH ENGLISCH: der Filter kannte nur deutsche Bezeichnungen, und
    //    data.protection.officer@hirschvogel.com kam dadurch bis in die
    //    Auswahl — ein Datenschutzbeauftragter, angeschrieben mit einem
    //    Vertriebsangebot. Genau die Adresse, die eine Beschwerde auslöst.
    const local = String(a.email ?? "").split("@")[0]?.toLowerCase() ?? "";
    const ROLLE = /^(ir|pr|presse|press|media|jobs|karriere|career|recruit|bewerbung|datenschutz|data[._-]?protection|privacy|dpo|legal|compliance|webmaster|invest|abuse)/;
    if (ROLLE.test(local)) return false;

    // 2) KEINE Untergrenze bei der Größe.
    //
    // Ein erster Anlauf verlangte 200–4.000 Mitarbeitende, abgeleitet aus der
    // Kundenliste des Wettbewerbers. Bcomp Ltd hat 51 — und Bcomp ist die
    // Firma, die am 17.08. um eine Demo bat, ausgelöst durch die Nachfassmail
    // vom Vortag. Die Untergrenze hätte genau diese Mail verhindert. REEL, die
    // einzige gebuchte Demo, hat überhaupt keine hinterlegte Zahl.
    //
    // Beide Erfolge, die wir haben, wären an einer Größenregel gescheitert.
    // Sie taugt als Rangfolge, nicht als Ausschluss. Was bleibt, ist die
    // Obergrenze: bei Continental (200.000 MA) entscheidet niemand über
    // info@ — dort ist der KANAL falsch, nicht die Größe.
    // Obergrenze 2.000, nicht 10.000: Unternehmen dieser Groesse haben in aller
    // Regel bereits eine Loesung im Einsatz — dann ist auch die zweite Mail
    // vergeblich. Deckt sich mit dem, was wir sehen: zur Demo kamen Bcomp
    // (51 MA) und REEL; die Antworten bei 1.200 MA blieben Antworten.
    // Betrifft 199 der 1.742 nachfassbaren Leads.
    const e = typeof a.employees === "number" && a.employees > 0 ? a.employees : null;
    if (e !== null && e > 2_000) return false;
    // Dieselbe Obergrenze für die 55 % der Leads, bei denen die Zahl im CRM
    // fehlt — siehe grossunternehmen.ts. Ohne das schlug der Lauf Schaeffler,
    // MAHLE, Freudenberg, Knorr-Bremse, MANN+HUMMEL und Eberspächer in einem
    // einzigen Batch vor.
    if (istGrosskonzern(a.email)) return false;

    // 3) Ausserhalb DACH. Wir verkaufen deutschsprachig, mit CSRD- und
    //    Catena-X-Aufhänger. Procotex France und Teknor Apex standen in der
    //    Auswahl, ohne dass die Mail für sie je gedacht war.
    const land = String(a.country ?? "").trim().toLowerCase();
    if (land && !/^(de|at|ch|deutschland|germany|österreich|osterreich|austria|schweiz|switzerland)$/.test(land)) return false;

    // 4) Forschungsinstitute, Hochschulen und Verbände stellen nichts her,
    //    für das sich ein Product Carbon Footprint rechnen liesse.
    //
    //    AUCH die Adresse prüfen, nicht nur den Firmennamen: "Werkstoffforum
    //    der Zukunft" verrät sich nirgends im Namen, schreibt aber von
    //    mail@kunststoff-institut.de. Der Name ist die Marke, die Domain die
    //    Einrichtung dahinter.
    // "Deutsches Zentrum für Luft- und Raumfahrt" traegt kein "Institut" im
    // Namen und ist doch eine Forschungseinrichtung.
    const INSTITUT = /fraunhofer|institut|universit|hochschule|akademie|verband|forschungs|zentrum für|\be\.\s?v\.?\b/i;
    if (INSTITUT.test(`${a.company ?? ""} ${a.email ?? ""} ${a.website ?? ""}`)) return false;

    return true;
  };

  const sel = selectFollowUps(accounts, statusMap, { limit: LIMIT, now, minWorkdays1: MIN1, minWorkdays2: MIN2, maxWorkdays: MAX, eligible });

  console.log(`\n── Auswahl ──`);
  console.log(`  Kontaktiert (Status "sent") : ${sel.sent}`);
  console.log(`  Fällig                      : ${sel.eligible}`);
  console.log(`  Noch zu früh                : ${sel.tooEarly}`);
  console.log(`  Zu lange her (> ${String(MAX).padStart(2)} WT)      : ${sel.tooLate}`);
  console.log(`  Bekäme heute keinen Erstkontakt: ${sel.ungeeignet}`);
  console.log(`  Sequenz beendet (2 gesendet): ${sel.exhausted}`);
  for (const [k, v] of Object.entries(sel.excluded)) console.log(`  Ausgeschlossen (${k}): ${v}`);
  console.log(`  → in diesem Lauf            : ${sel.batch.length}`);
  if (!sel.batch.length) { console.log("\nNichts zu tun."); return; }

  for (const c of sel.batch) {
    console.log(`   ${c.stage === 1 ? "FU1" : "FU2"} · ${String(c.account.company).slice(0, 38).padEnd(40)} ${String(c.workdays).padStart(3)} WT seit ${berlinDatum(statusMap[c.account.id]?.followup1_at ?? statusMap[c.account.id]?.sent_at)} · ${c.account.email}`);
  }

  // === 2) Preflight — identisch zum Erstkontakt ==============================
  const pf = await runPreflight({
    storage, batchSize: LIMIT,
    senderEmail: process.env.REVENUE_FROM_EMAIL ?? process.env.SMTP_USER ?? SENDER.email,
    provider: selectedProviderName(),
    armed: isSendArmed() && APPLY,
    accounts,
    campaignLabel: `followup-${new Date().toISOString().slice(0, 10)}`,
    clock: () => now,
  });
  // "approved" bezieht sich auf den Erstkontakt und ist beim Nachfassen
  // naturgemäß leer — diese eine Prüfung zählt hier nicht.
  const blocking = pf.checks.filter((c) => c.blocking && !c.ok && c.id !== "approved-only" && c.id !== "batch-limit" && c.id !== "dns-recipients");
  // formatPreflight endet mit einem eigenen Gesamturteil. Beim Nachfassen ist
  // das irreführend: "approved" gehört zum Erstkontakt und ist hier immer leer,
  // also meldet der Block "⛔ PREFLIGHT FEHLGESCHLAGEN — kein Versand", während
  // der Lauf gleich sendet. Die Zeile steht genau dort, wo entschieden wird.
  console.log("\n" + formatPreflight(pf));
  console.log(`  Hinweis              : "approved"/Versandlimit gelten dem Erstkontakt und zählen hier nicht — maßgeblich sind ${blocking.length === 0 ? "keine" : blocking.length} blockierende Prüfungen.`);
  if (blocking.length) {
    console.log(`\n⛔ Abbruch: ${blocking.map((c) => c.label).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // MX EIGENSTÄNDIG prüfen. runPreflight() löst die Adressen der APPROVED-Menge
  // auf — die ist beim Nachfassen leer, der Check meldete deshalb "0 Domains
  // geprüft" und schützte nichts. Die Nachfass-Empfänger sind eine völlig
  // andere Menge und brauchen ihre eigene Auflösung.
  const mx = await recipientMxCheck(
    sel.batch.map((c) => c.account.email as string),
    dnsMxResolver,
  );
  console.log(`  ${mx.ok ? "✅" : "⛔"} ${mx.label} — ${mx.detail}`);
  const dead = new Set(mx.deadEmails.map((e) => e.toLowerCase()));
  const batch = sel.batch.filter((c) => !dead.has(String(c.account.email).toLowerCase()));
  if (batch.length !== sel.batch.length) {
    console.log(`\n⚠ ${sel.batch.length - batch.length} Empfänger ohne MX aus dem Nachfassen entfernt.`);
  }
  if (!batch.length) { console.log("\nNach der MX-Prüfung bleibt niemand übrig."); return; }

  if (!APPLY) {
    console.log("\n(Vorschau — nichts versendet. Mit --apply und REVENUE_SEND_ENABLED=1 senden.)\n");
    return;
  }

  // === 3) Versand ============================================================
  const provider = getProvider();
  const results: { id: string; company: string; email: string; stage: number; status: string; error?: string }[] = [];
  for (const c of batch) {
    const a = c.account;
    const opp = buildOpportunity(a, () => now, "E");
    const body = c.stage === 1 ? opp.followUp1 : opp.followUp2;
    const email: OutboundEmail = {
      to: a.email as string,
      ...(a.company ? { toName: a.company } : {}),
      from: SENDER.email,
      fromName: SENDER.name,
      replyTo: process.env.REVENUE_REPLY_TO ?? SENDER.email,
      // Bezug auf die erste Mail — kein neuer Betreff, damit der Verlauf
      // im Postfach des Empfängers zusammenbleibt.
      subject: `Re: ${opp.subjects[0] ?? a.company}`,
      html: `<div style="font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.6;color:#16172B">${body.replace(/\n/g, "<br>")}</div>`,
      text: body,
      headers: listUnsubscribeHeaders(opp.unsubscribeUrl),
      tags: ["revenue-followup", `stage-${c.stage}`],
    };
    const r = await dispatch(email, provider);
    const rec: LeadRecord = { ...(statusMap[a.id] as LeadRecord) };
    if (r.status === "sent") {
      if (c.stage === 1) rec.followup1_at = now; else rec.followup2_at = now;
    } else if (r.detail) {
      rec.error = r.detail;
    }
    statusMap[a.id] = rec;
    results.push({ id: a.id, company: a.company, email: a.email as string, stage: c.stage, status: r.status, ...(r.detail ? { error: r.detail } : {}) });
  }
  storage.save("revenue-lead-status", statusMap);

  const sent = results.filter((r) => r.status === "sent").length;
  const errors = results.filter((r) => r.status === "error");
  console.log(`\n── Nachfass-Bericht ──`);
  console.log(`  Versendet : ${sent} / ${results.length}`);
  console.log(`  Fehler    : ${errors.length}`);
  for (const e of errors) console.log(`    ⛔ ${e.company} — ${e.error}`);
  try {
    const p = writeReportFile(pf.reportStem, "followup.json", JSON.stringify({ gate, selection: { ...sel, batch: undefined }, results }, null, 2));
    console.log(`\n📄 Report: ${p}`);
  } catch { /* nicht fatal */ }
  process.env.REVENUE_SEND_ENABLED = "0";
  console.log(`\n✅ ${sent} Nachfassmails versendet. Master-Switch zurückgesetzt.`);
}

main().catch((e) => { console.error("followup-run failed:", (e as Error).message); process.exitCode = 1; });
