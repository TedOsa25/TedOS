// Watchdog manifest tests — validate the schedule is consistent and that the
// Executive Report aggregates every source. Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { WATCHDOGS, MAIN_LOOP, EXECUTIVE_REPORT, GUARDRAILS, allFeeds, validateSchedule } from "./watchdogs.js";

describe("TedOS watchdog manifest", () => {
  test("registers the twelve daily watchdogs", () => {
    assert.equal(WATCHDOGS.length, 12);
    for (const id of ["sales", "supplier"]) {
      assert.ok(WATCHDOGS.some((w) => w.id === id), `${id} watchdog present`);
    }
  });

  test("ids, crons and feeds are unique; every cron is 5-field", () => {
    const { ok, errors } = validateSchedule();
    assert.ok(ok, `schedule invalid: ${errors.join("; ")}`);
  });

  test("each watchdog writes to a *-findings.json feed", () => {
    for (const w of WATCHDOGS) assert.match(w.feed, /-findings\.json$/);
  });

  test("Sales runs 16:30 and Supplier runs 17:30", () => {
    assert.equal(WATCHDOGS.find((w) => w.id === "sales")?.time, "16:30");
    assert.equal(WATCHDOGS.find((w) => w.id === "supplier")?.time, "17:30");
  });

  test("Executive Report aggregates all 13 sources (Main Loop + every watchdog)", () => {
    assert.equal(EXECUTIVE_REPORT.sources.length, 13);
    assert.ok(EXECUTIVE_REPORT.sources.includes(MAIN_LOOP.id));
    for (const w of WATCHDOGS) {
      assert.ok(EXECUTIVE_REPORT.sources.includes(w.id), `exec report reads ${w.id}`);
    }
  });

  test("allFeeds() lists the main-loop feed plus all watchdog feeds", () => {
    const feeds = allFeeds();
    assert.equal(feeds.length, 13);
    assert.ok(feeds.includes("loop-outcomes.json"));
    assert.ok(feeds.includes("sales-findings.json"));
    assert.ok(feeds.includes("supplier-findings.json"));
  });

  test("guardrails forbid the high-risk surfaces", () => {
    const forbidden: readonly string[] = GUARDRAILS.forbidden;
    for (const f of ["deploy", "merge", "main", "compliance", "co2", "billing", "pricing", "security", "migrations"]) {
      assert.ok(forbidden.includes(f), `forbidden: ${f}`);
    }
  });
});
