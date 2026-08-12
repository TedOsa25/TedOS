// MX-PRÜFUNG ÜBER DEN GESAMTEN BESTAND — Bounce-Vermeidung vor dem Versand.
//
// Der Preflight prüft MX nur für die 20 Empfänger des jeweiligen Batches. Damit
// fällt jede tote Domain erst auf, wenn ihr Lead an der Reihe ist — bis dahin
// zählt sie unsichtbar im Pool mit. Bei 9,54 % gemessener Bounce-Rate ist das
// zu spät: Reputationsschaden entsteht beim Senden, nicht beim Auswerten.
//
// Dieser Lauf prüft ALLE versandfähigen Adressen auf einmal und legt die toten
// still, bevor sie je in einen Batch geraten.
//
//   TEDOS_STORAGE_PATH=./.revenue-state npm run mx:sweep            # Vorschau
//   TEDOS_STORAGE_PATH=./.revenue-state npm run mx:sweep -- --apply # anwenden

import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { loadLeadStatus, rejectLeads, type LeadRecord } from "./batch-send.js";
import { dnsMxResolver } from "./preflight.js";

const APPLY = process.argv.includes("--apply");
const CONCURRENCY = Number(process.env.MX_CONCURRENCY ?? 20);

/** Statuswerte, die noch versendet werden könnten — nur die sind zu prüfen. */
const OFFEN = new Set(["active", "pending", "approved", "sent"]);

async function main(): Promise<void> {
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — Abbruch.");
    process.exitCode = 1;
    return;
  }
  const storage = createStorage();
  const statusMap = loadLeadStatus(storage);
  const accounts = loadAccounts();

  // Nur Leads, die noch angeschrieben werden könnten. "sent" ist dabei, weil
  // die Nachfass-Sequenz sie erneut adressiert.
  const kandidaten = accounts.filter((a) => {
    const st = (statusMap[a.id] as LeadRecord | undefined)?.status ?? "active";
    return OFFEN.has(st) && (a.email ?? "").trim() !== "";
  });

  const domains = new Map<string, string[]>();
  for (const a of kandidaten) {
    const d = (a.email as string).split("@")[1]?.toLowerCase();
    if (d) domains.set(d, [...(domains.get(d) ?? []), a.id]);
  }
  console.log(`\n═══ MX-Prüfung · ${kandidaten.length} Adressen auf ${domains.size} Domains ═══\n`);

  const tot: string[] = [];
  const queue = [...domains.keys()];
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const d = queue.shift() as string;
      try {
        const mx = await dnsMxResolver(d);
        if (!mx.length) tot.push(d);
      } catch {
        tot.push(d); // NXDOMAIN oder Resolver-Fehler — nicht zustellbar
      }
      if (++done % 100 === 0) console.log(`  … ${done}/${domains.size} Domains`);
    }
  }));

  const betroffen = tot.flatMap((d) => domains.get(d) ?? []);
  console.log(`\n── Ergebnis ──`);
  console.log(`  Domains ohne MX : ${tot.length}`);
  console.log(`  Betroffene Leads: ${betroffen.length}`);
  if (tot.length) {
    console.log(`\n  Tote Domains:`);
    for (const d of tot.sort()) console.log(`    ✗ ${d.padEnd(38)} ${(domains.get(d) ?? []).length} Lead(s)`);
  }
  // Was der Versand dadurch künftig NICHT mehr an Bounces produziert.
  const anteil = kandidaten.length ? (betroffen.length / kandidaten.length) * 100 : 0;
  console.log(`\n  Anteil am versandfähigen Bestand: ${anteil.toFixed(2)} %`);

  if (!betroffen.length) { console.log("\nNichts zu tun.\n"); return; }
  if (!APPLY) { console.log("\n(Vorschau — nichts geändert. Mit --apply stilllegen.)\n"); return; }

  // Bereits versendete Leads NICHT anfassen: deren Versandhistorie bleibt, und
  // ein echter Bounce wird ohnehin über inbox:scan als "bounced" verbucht.
  const stillzulegen = betroffen.filter((id) => {
    const st = (statusMap[id] as LeadRecord | undefined)?.status ?? "active";
    return st !== "sent";
  });
  rejectLeads(storage, stillzulegen);
  const nach = loadLeadStatus(storage);
  for (const id of stillzulegen) {
    const d = (accounts.find((a) => a.id === id)?.email as string).split("@")[1];
    nach[id] = { ...(nach[id] as LeadRecord), note: `${d} has no MX record — undeliverable, retired before sending` };
  }
  storage.save("revenue-lead-status", nach);

  const c: Record<string, number> = {};
  for (const r of Object.values(nach)) c[r.status] = (c[r.status] ?? 0) + 1;
  console.log(`\n✅ ${stillzulegen.length} Lead(s) stillgelegt (${betroffen.length - stillzulegen.length} bereits versendet, unangetastet).`);
  console.log(`Store: ${JSON.stringify(c)}\n`);
}

main().catch((e) => { console.error("mx-sweep failed:", (e as Error).message); process.exitCode = 1; });
