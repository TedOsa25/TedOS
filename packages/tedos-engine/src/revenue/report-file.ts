// Per-batch report files. Every productive batch persists its preflight snapshot
// and its final send report to disk, so there is a durable audit trail beyond the
// console. Location: REVENUE_REPORTS_DIR (default <cwd>/.revenue-reports).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Directory the batch reports are written to. */
export function reportDir(): string {
  return process.env.REVENUE_REPORTS_DIR ?? resolve(process.cwd(), ".revenue-reports");
}

/** Create the report directory (idempotent) and return its path. */
export function ensureReportDir(): string {
  const dir = reportDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Filesystem-safe stem shared by all files of one batch, e.g.
 * `2026-07-07T09-20-30-000Z_pilot-batch-03`. Derived from the ISO timestamp and
 * the campaign label so the files sort chronologically and are self-describing.
 */
export function reportStem(label: string | undefined, timestamp: string): string {
  const safeLabel = (label ?? "batch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const safeTs = timestamp.replace(/[:.]/g, "-");
  return `${safeTs}_${safeLabel || "batch"}`;
}

/** Write one report artefact (`<stem>.<ext>`) and return the absolute path. */
export function writeReportFile(stem: string, ext: string, content: string): string {
  const dir = ensureReportDir();
  const path = resolve(dir, `${stem}.${ext}`);
  writeFileSync(path, content, "utf8");
  return path;
}
