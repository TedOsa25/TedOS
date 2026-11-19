// Growth OS: gemeinsames Nachrichtenformat aller Growth-Agenten.
//
// Jeder Agent (Orchestrator, Conversion, Lifecycle, Analytics, Ads, Content …)
// schreibt, was er erkannt oder vorgeschlagen hat, als GrowthSignal in ein
// gemeinsames, nur anhaengendes Protokoll (JSON Lines). Andere Agenten lesen
// es. So haengen die Agenten zusammen, ohne sich direkt zu kennen, und jeder
// Schritt bleibt nachvollziehbar (Audit-Log).
//
// Modus je Signal (die drei Betriebsmodi des Growth OS):
//   observe            nur gelesen / analysiert
//   execute_safe       interne Aktion (Entwurf, Bericht, Sync) – ohne Freigabe
//   approval_required  wirkt nach aussen – geht in die ApprovalQueue, nie direkt
//
// Rein bis auf SignalLog (Datei anhaengen/lesen). Keine Netzwerkzugriffe.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Storage } from "../storage.js";

export const SIGNAL_VERSION = 1 as const;

export type GrowthModus = "observe" | "execute_safe" | "approval_required";

export type GrowthAgent =
  | "orchestrator"
  | "market_intelligence"
  | "content_strategy"
  | "creative"
  | "instagram"
  | "linkedin"
  | "google_ads"
  | "meta_ads"
  | "lead_crm"
  | "conversion"
  | "lifecycle"
  | "analytics"
  | "optimization";

/** Woher eine Aussage stammt. Ohne Beleg keine Zahl. */
export interface Beleg {
  quelle: string;
  stand: string; // ISO-Zeitpunkt der Daten
  konfidenz: "hoch" | "mittel" | "niedrig";
}

export interface GrowthSignal<D = unknown> {
  version: typeof SIGNAL_VERSION;
  id: string;
  von: GrowthAgent;
  /** Optional: an wen (sonst an alle). */
  an?: GrowthAgent;
  /** Punkt-getrennt, z. B. "briefing.erstellt", "vorschlag.upgrade". */
  art: string;
  modus: GrowthModus;
  betreff: string;
  daten: D;
  belege: Beleg[];
  erstelltAm: string;
}

export function signal<D>(
  felder: Omit<GrowthSignal<D>, "version" | "id" | "erstelltAm">,
  jetzt: Date,
  seq = 0,
): GrowthSignal<D> {
  const id = `${felder.von}:${felder.art}:${jetzt.toISOString()}:${seq}`;
  return { version: SIGNAL_VERSION, id, erstelltAm: jetzt.toISOString(), ...felder };
}

/** Nur anhaengendes Protokoll in einer JSONL-Datei. */
export class SignalLog {
  constructor(private readonly datei: string) {}

  anhaengen(signale: GrowthSignal[]): void {
    if (signale.length === 0) return;
    mkdirSync(dirname(this.datei), { recursive: true });
    appendFileSync(this.datei, signale.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  }

  lesen(filter?: { art?: string; von?: GrowthAgent; seit?: string }): GrowthSignal[] {
    if (!existsSync(this.datei)) return [];
    return readFileSync(this.datei, "utf8")
      .split("\n")
      .filter((z) => z.trim())
      .map((z) => JSON.parse(z) as GrowthSignal)
      .filter(
        (s) =>
          (!filter?.art || s.art === filter.art || s.art.startsWith(`${filter.art}.`)) &&
          (!filter?.von || s.von === filter.von) &&
          (!filter?.seit || s.erstelltAm >= filter.seit),
      );
  }
}

/**
 * Speicher, der nur liest. Fuer fremde Laufzeitstaende (z. B. den
 * Outbound-Status), die das Growth OS beobachten, aber nie aendern darf.
 */
export class NurLeseSpeicher implements Storage {
  constructor(private readonly innen: Storage) {}
  load<T>(key: string): T | null {
    return this.innen.load<T>(key);
  }
  save(): void {
    throw new Error("NurLeseSpeicher: Schreiben ist hier verboten (Modus observe).");
  }
}
