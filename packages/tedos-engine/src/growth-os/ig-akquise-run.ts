// Instagram-Akquise verwalten. FOLGT UND SCHREIBT NICHTS SELBST: das macht Claude
// in der Chrome-Sitzung, dieses Programm fuehrt nur Buch und setzt Grenzen.
//
//   npm run growth:ig-akquise -- charge <kandidaten.json> <morgen|abend>  # Charge vorschlagen
//   npm run growth:ig-akquise -- gefolgt <handle...>                       # nach dem Folgen
//   npm run growth:ig-akquise -- follower <follower.json>                  # Abgleich, zeigt faellige Nachrichten
//   npm run growth:ig-akquise -- angeschrieben <handle...>
//   npm run growth:ig-akquise -- uebersprungen <handle...>
//   npm run growth:ig-akquise -- stand
// Optional: --runtime <dir>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { berlinTag } from "./ausfuehren.js";
import { chargeFreigabe, dankNachricht, faelligeNachrichten, folgenRest, neueCharge, normHandle, zurueckGefolgt, type Bestand, type Kandidat, type Slot, type Status } from "./ig-akquise.js";
import { vorlegen } from "./vorlegen.js";

const argv = process.argv.slice(2).filter((a, i, all) => a !== "--runtime" && all[i - 1] !== "--runtime");
const ri = process.argv.indexOf("--runtime");
const growth = join(resolve(ri >= 0 ? process.argv[ri + 1]! : "runtime/heyaudit"), "growth");
const pfad = join(growth, "ig-akquise.json");
const b: Bestand = existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")) : { kontakte: {} };
const speichern = () => writeFileSync(pfad, JSON.stringify(b, null, 2) + "\n", "utf8");
const jetzt = new Date();
const tag = berlinTag(jetzt);

function setze(handles: string[], von: Status[], nach: Status, feld?: "gefolgtAm" | "angeschriebenAm"): void {
  for (const h of handles.map(normHandle)) {
    const k = b.kontakte[h];
    if (!k) { console.error(`@${h}: unbekannt`); continue; }
    if (!von.includes(k.status)) { console.error(`@${h}: Status ${k.status}, nicht geändert`); continue; }
    k.status = nach;
    if (feld) k[feld] = jetzt.toISOString();
  }
  speichern();
}

const [befehl, ...rest] = argv;
switch (befehl) {
  case "charge": {
    const [datei, slot] = rest as [string, Slot];
    if (!datei || (slot !== "morgen" && slot !== "abend")) throw new Error("charge <kandidaten.json> <morgen|abend>");
    const charge = neueCharge(JSON.parse(readFileSync(datei, "utf8")) as Kandidat[], b, tag, slot);
    for (const k of charge) b.kontakte[k.handle] = k;
    speichern();
    if (charge.length) vorlegen(new ApprovalQueue(new JsonFileStorage(growth)), chargeFreigabe(charge));
    console.log(`${charge.length} neue Konten in Charge ${tag}-${slot}. Heute noch ${folgenRest(b, tag)} Folgen erlaubt.`);
    break;
  }
  case "gefolgt": {
    if (rest.length > folgenRest(b, tag)) throw new Error(`Tageslimit: heute nur noch ${folgenRest(b, tag)} Folgen`);
    setze(rest, ["vorgeschlagen"], "gefolgt", "gefolgtAm");
    break;
  }
  case "follower": {
    const neu = zurueckGefolgt(b, JSON.parse(readFileSync(rest[0]!, "utf8")) as string[], jetzt.toISOString());
    speichern();
    console.log(`Neu zurückgefolgt: ${neu.map((h) => "@" + h).join(", ") || "niemand"}`);
    const f = faelligeNachrichten(b, tag);
    console.log(`Nachricht fällig (${f.length}): ${f.map((k) => "@" + k.handle).join(", ")}\n\n${dankNachricht()}`);
    break;
  }
  case "angeschrieben":
    setze(rest, ["zurueckgefolgt"], "angeschrieben", "angeschriebenAm");
    break;
  case "uebersprungen":
    setze(rest, ["vorgeschlagen", "gefolgt", "zurueckgefolgt"], "uebersprungen");
    break;
  default: {
    const n = (s: Status) => Object.values(b.kontakte).filter((k) => k.status === s).length;
    console.log(`Vorgeschlagen ${n("vorgeschlagen")} · gefolgt ${n("gefolgt")} · zurückgefolgt ${n("zurueckgefolgt")} · angeschrieben ${n("angeschrieben")} · übersprungen ${n("uebersprungen")} · heute noch ${folgenRest(b, tag)} Folgen`);
  }
}
