// Zustand des Content-Systems (außerhalb von Git, 0600) und der Loop-Schritt,
// den der bestehende Sales-Job "instagram" alle 15 min aufruft.
// Der Loop-Schritt schreibt NUR Content-Status und ein Laufprotokoll; er
// veröffentlicht nichts, sendet nichts und legt keine Sales-Ereignisse an.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ApprovalEntry } from "../approval-queue.js";
import type { Plattform } from "./modell.js";
import type { Konten, Redaktionsplan, Veroeffentlichung } from "./wochenplan.js";
import { setzeStatus, STANDARD_KONTEN, wochenFreigabeId } from "./wochenplan.js";

export const CONTENT_DIR = process.env.CONTENT_STATE_DIR ?? join(homedir(), "dev", "tedos-runtime", "heyaudit-content");

export class ContentStore {
  constructor(public readonly dir: string = CONTENT_DIR) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  pfad(...t: string[]) { return join(this.dir, ...t); }
  lies<T>(name: string, fallback: T): T {
    const p = this.pfad(name);
    if (!existsSync(p)) return fallback;
    try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch (e) { throw new Error(`${name} ist kein gültiges JSON: ${(e as Error).message}`); }
  }
  schreibe(name: string, wert: unknown): void {
    const p = this.pfad(name);
    mkdirSync(join(p, ".."), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, typeof wert === "string" ? wert : JSON.stringify(wert, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, p);
  }
  anhaengen(name: string, zeile: unknown): void {
    mkdirSync(join(this.pfad(name), ".."), { recursive: true, mode: 0o700 });
    appendFileSync(this.pfad(name), JSON.stringify(zeile) + "\n", { mode: 0o600 });
  }
  zeilen<T>(name: string): T[] {
    const p = this.pfad(name);
    return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];
  }
  konten(): Konten { return this.lies<{ konten?: Konten }>("konten.json", {}).konten ?? STANDARD_KONTEN; }
  plaene(): Redaktionsplan[] {
    const d = this.pfad("plaene");
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(d, f), "utf8")) as Redaktionsplan);
  }
  speicherePlan(p: Redaktionsplan): string { const n = `plaene/${p.kampagnenId}.json`; this.schreibe(n, p); return this.pfad(n); }
}

export interface LoopErgebnis { laufId: string; freigegeben: string[]; verworfen: string[]; faelligIg: string[]; text: string }

/** Wochenfreigaben aus der Sales-Freigabe übernehmen; fällige Instagram-Posts melden. Idempotent. */
export function contentLoopSchritt(store: ContentStore, freigaben: ApprovalEntry[], jetzt: Date, quelle = "sales:instagram"): LoopErgebnis {
  const laufId = randomUUID();
  const status = new Map(freigaben.map((f) => [f.goalId, f.status]));
  const freigegeben: string[] = [], verworfen: string[] = [], faelligIg: string[] = [];
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
  for (const p of store.plaene()) {
    const s = status.get(wochenFreigabeId(p));
    let geaendert = false;
    for (const k of p.kernvideos) for (const v of k.veroeffentlichungen) {
      if (v.status === "intern_pruefen" && s === "approved") { geaendert = setzeStatus(v, "freigegeben", "freigabe:" + wochenFreigabeId(p), jetzt) || geaendert; freigegeben.push(v.id); }
      if (v.status === "intern_pruefen" && s === "rejected") { geaendert = setzeStatus(v, "verworfen", "abgelehnt:" + wochenFreigabeId(p), jetzt) || geaendert; verworfen.push(v.id); }
      if (v.plattform === "instagram" && ["freigegeben", "manuell_veroeffentlichen"].includes(v.status) && (v.geplant ?? "").slice(0, 10) <= heute) faelligIg.push(v.id);
    }
    if (geaendert) store.speicherePlan(p);
  }
  const text = `Content: ${faelligIg.length} freigegebene IG-Posts fällig${faelligIg.length ? ` (${faelligIg.join(", ")})` : ""}${freigegeben.length ? ` · +${freigegeben.length} freigegeben` : ""}${verworfen.length ? ` · ${verworfen.length} verworfen` : ""}`;
  store.anhaengen("laeufe.jsonl", { laufId, zeit: jetzt.toISOString(), quelle, freigegeben, verworfen, faelligIg });
  return { laufId, freigegeben, verworfen, faelligIg, text };
}

/** Manuelle Veröffentlichung (IG-Runde) zurückmelden. Gleiche URL nochmal = kein Fehler; andere URL = Konflikt. */
export function meldeVeroeffentlicht(v: Veroeffentlichung, url: string, am: Date, wer: string): string {
  if (v.status === "veroeffentlicht") {
    if (v.url === url) return `${v.id}: schon als veröffentlicht vermerkt`;
    throw new Error(`${v.id} ist bereits mit ${v.url} veröffentlicht — kein zweiter Post`);
  }
  if (!/^https:\/\//.test(url)) throw new Error("--url muss die öffentliche Beitrags-URL sein");
  if (v.status === "freigegeben") setzeStatus(v, "manuell_veroeffentlichen", wer, am);
  setzeStatus(v, "veroeffentlicht", wer, am);
  v.url = url;
  v.veroeffentlichtAm = am.toISOString();
  return `${v.id}: veröffentlicht vermerkt`;
}

export const aktivePlattformen = (k: Konten): Plattform[] => (Object.entries(k) as Array<[Plattform, { verbunden: boolean }]>).filter(([, x]) => x?.verbunden).map(([p]) => p);
