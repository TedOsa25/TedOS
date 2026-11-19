// Google-Suchkampagne als Entwurf schreiben und EINMAL zur Freigabe vorlegen.
// SCHALTET NICHTS. Google Ads ist noch nicht angebunden.
//
//   npm run growth:google -- [--runtime <dir>] [--marketing <dir>] [--dry]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { vorlegen } from "./vorlegen.js";
import { baueSuchEntwurf, renderSuchEntwurf, suchFreigabe } from "./google-ads.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const e = baueSuchEntwurf();
  const text = renderSuchEntwurf(e);
  if (process.argv.includes("--dry")) { process.stdout.write(text); return; }
  const growth = join(resolve(arg("runtime") ?? "runtime/heyaudit"), "growth");
  const ordner = join(growth, "google");
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, "suche-entwurf.json"), JSON.stringify(e, null, 2) + "\n", "utf8");
  writeFileSync(join(ordner, "suche-entwurf.md"), text, "utf8");
  const marketing = arg("marketing");
  if (marketing) {
    const m = join(resolve(marketing), "google-ads");
    mkdirSync(m, { recursive: true });
    writeFileSync(join(m, "suche-entwurf.md"), text, "utf8");
  }
  const queue = new ApprovalQueue(new JsonFileStorage(growth));
  const v = suchFreigabe(e);
  vorlegen(queue, v);
  console.error(`Google-Entwurf: ${join(ordner, "suche-entwurf.md")}${e.befunde.length ? ` · ${e.befunde.length} Befunde` : ""}`);
}

if (process.argv[1]?.endsWith("google-ads-run.ts")) main();
