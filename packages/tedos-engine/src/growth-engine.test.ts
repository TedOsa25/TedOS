// Growth Engine tests. Deterministic, offline — injected clock + storage.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./storage.js";
import { DistributionQueue } from "./distribution-queue.js";
import { GrowthEngine, DAILY_TARGETS, type GrowthKind } from "./growth-engine.js";
import { checkContent } from "./brand-guardian.js";

const clock = (): string => "2026-06-27T09:00:00.000Z";

const ALL_KINDS: GrowthKind[] = [
  "sales-email", "follow-up", "linkedin-post", "blog", "comparison-page",
  "landing-page", "supplier-campaign", "seo", "content-improvement",
];
/** A full target map (0 for unspecified kinds), so a test sees only what it sets. */
function only(p: Partial<Record<GrowthKind, number>>): Record<GrowthKind, number> {
  const m = {} as Record<GrowthKind, number>;
  for (const k of ALL_KINDS) m[k] = p[k] ?? 0;
  return m;
}

function setup(targets?: Partial<Record<GrowthKind, number>>, perTickCap = 100) {
  const storage = new InMemoryStorage();
  const queue = new DistributionQueue(storage, undefined, clock);
  const engine = new GrowthEngine(queue, storage, { clock, targets, perTickCap });
  return { storage, queue, engine };
}

describe("GrowthEngine: produces business deliverables", () => {
  test("generates content and enqueues it credential-gated (pending-approval)", () => {
    const { queue, engine } = setup({ "sales-email": 2, "linkedin-post": 1 }, 100);
    const r = engine.run();
    assert.ok(r.generated >= 3, "produced at least the small quota");
    assert.equal(r.queuedForApproval, r.generated);
    // Everything sits in the shared queue, awaiting approval — nothing sent.
    assert.equal(queue.byStatus("pending-approval").length, r.generated);
    assert.equal(queue.byStatus("published").length, 0);
    assert.equal(queue.byStatus("sent").length, 0);
  });

  test("extended business metrics are populated", () => {
    const { engine } = setup(only({ "sales-email": 3, "follow-up": 2, "supplier-campaign": 1, "comparison-page": 2, "seo": 1, "blog": 1 }), 100);
    const r = engine.run();
    assert.equal(r.salesEmails, 5, "sales-email + follow-up");
    assert.equal(r.supplierOpportunities, 1);
    assert.equal(r.newCampaigns, 3, "supplier-campaign + comparison-page + landing-page(0)");
    assert.equal(r.seoOpportunities, 1);
    assert.ok(r.businessImpactScore > 0, "score reflects prepared value");
    assert.ok(r.revenueOpportunities > 0);
  });

  test("content passes the Brand Guardian (no greenwashing / blocking issues)", () => {
    const { engine } = setup({ "sales-email": 5, "blog": 2, "comparison-page": 3 }, 100);
    const r = engine.run();
    for (const o of r.opportunities) {
      assert.equal(checkContent(o.body).ok, true, `brand-block in ${o.id}`);
    }
  });
});

describe("GrowthEngine: daily quota", () => {
  test("never exceeds the daily target across many ticks", () => {
    const { engine } = setup({ "sales-email": 4 }, 100);
    let total = 0;
    for (let i = 0; i < 10; i++) total += engine.run().byKind["sales-email"] ?? 0;
    assert.equal(total, 4, "the day's quota is produced once, then it idles");
    assert.equal(engine.run().generated, 0, "idle after quota met");
  });

  test("perTickCap spreads a day's quota across ticks", () => {
    const { engine } = setup(only({ "sales-email": 10 }), 3);
    const first = engine.run();
    assert.ok(first.generated <= 3, "capped per tick");
    let total = first.generated;
    for (let i = 0; i < 10; i++) total += engine.run().generated;
    assert.equal(total, 10, "eventually reaches the daily quota");
  });
});

describe("GrowthEngine: determinism + defaults", () => {
  test("same date → same deliverable ids", () => {
    const a = setup({ "sales-email": 2 }, 100).engine.run();
    const b = setup({ "sales-email": 2 }, 100).engine.run();
    assert.deepEqual(a.opportunities.map((o) => o.id), b.opportunities.map((o) => o.id));
  });

  test("default daily targets match the requested deliverable quota", () => {
    assert.equal(DAILY_TARGETS["sales-email"], 10);
    assert.equal(DAILY_TARGETS["linkedin-post"], 5);
    assert.equal(DAILY_TARGETS["blog"], 2);
    assert.equal(DAILY_TARGETS["comparison-page"], 3);
    assert.equal(DAILY_TARGETS["supplier-campaign"], 1);
  });
});
