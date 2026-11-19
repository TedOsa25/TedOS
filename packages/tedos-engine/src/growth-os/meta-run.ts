// Meta-Kennzahlen holen und fuer das Briefing ablegen. NUR LESEN.
//
//   npm run growth:meta -- [--tage 7] [--runtime <dir>] [--dry]
//
// Token aus dem Keychain-Dienst "heyaudit-meta-ads-read" (roh oder base64).
// Schreibt <runtime>/growth/eingang/meta.json. Ohne Token: Hinweis, Exit 0,
// damit der 08:00-Lauf trotzdem ein Briefing schreibt.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { META_KEYCHAIN_DIENST, holeMetaQuelle } from "./meta-insights.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Meta-Tokens beginnen mit "EAA". Andere Werte werden als base64 versucht. */
export function tokenAus(roh: string): string {
  const w = roh.trim();
  if (!w || w.startsWith("EAA")) return w;
  const dekodiert = Buffer.from(w, "base64").toString("utf8").trim();
  return dekodiert.startsWith("EAA") ? dekodiert : w;
}

function keychain(dienst: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-s", dienst, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const tage = Number(arg("tage") ?? 7);
  const runtime = resolve(arg("runtime") ?? "runtime/heyaudit");
  const token = tokenAus(keychain(META_KEYCHAIN_DIENST));
  if (!token) {
    console.error(`Meta: kein Token im Keychain-Dienst "${META_KEYCHAIN_DIENST}". Briefing zeigt Meta als nicht angebunden.`);
    return;
  }
  const quelle = await holeMetaQuelle(token, tage, new Date());
  const text = JSON.stringify(quelle, null, 2) + "\n";
  if (process.argv.includes("--dry")) {
    process.stdout.write(text);
    return;
  }
  const ziel = join(runtime, "growth", "eingang");
  mkdirSync(ziel, { recursive: true });
  writeFileSync(join(ziel, "meta.json"), text, "utf8");
  console.error(`Meta: ${join(ziel, "meta.json")}`);
}

if (process.argv[1]?.endsWith("meta-run.ts")) {
  main().catch((e) => {
    // Kein Abbruch des Briefings: alte meta.json bleibt, das Briefing nennt ihren Stand.
    console.error(`Meta: Abruf fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  });
}
