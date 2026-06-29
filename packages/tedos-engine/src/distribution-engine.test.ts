// Distribution Engine + connectors tests. Deterministic, offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./storage.js";
import { DistributionQueue, type DistributionJobInput } from "./distribution-queue.js";
import { PublisherRegistry, type Transport } from "./distribution-connectors.js";
import { DistributionAnalyticsStore, type MetricsProvider } from "./distribution-analytics.js";
import { DistributionEngine } from "./distribution-engine.js";

const clock = (): string => "2026-06-26T14:00:00.000Z";
const input = (over: Partial<DistributionJobInput> = {}): DistributionJobInput => ({
  id: "j1", source: "marketing", channel: "linkedin", campaign: "c1", title: "t",
  body: "Scope 3 in Minuten. CTA: Demo buchen", ...over,
});

function setup(transports = {}, metrics?: MetricsProvider) {
  const storage = new InMemoryStorage();
  const queue = new DistributionQueue(storage, undefined, clock);
  const analytics = new DistributionAnalyticsStore(storage);
  const engine = new DistributionEngine(queue, new PublisherRegistry(transports), analytics, {
    env: {}, clock, ...(metrics ? { metrics } : {}),
  });
  return { storage, queue, analytics, engine };
}

describe("Distribution connectors: credential + transport gating", () => {
  test("no credentials → skipped with a setup hint, never published", () => {
    const { queue, engine } = setup(); // env {} → no tokens
    queue.enqueue(input());
    queue.approve("j1");
    const res = engine.run();
    assert.equal(res.skipped, 1);
    assert.equal(res.published, 0);
    const job = queue.get("j1");
    assert.equal(job?.status, "skipped");
    assert.match(job?.note ?? "", /LINKEDIN_TOKEN/);
  });

  test("health check reports inert channels without creds", () => {
    const reg = new PublisherRegistry();
    const report = reg.healthReport({});
    assert.equal(report.every((r) => r.health.ok === false), true);
    assert.equal(report.some((r) => r.channel === "linkedin"), true);
  });
});

describe("Distribution Engine: gated publish with a live transport", () => {
  const transport: Transport = (job) => ({ ok: true, externalId: `ext-${job.id}`, detail: "ok" });

  test("credentials + transport → published, metrics captured", () => {
    const { queue, analytics, engine } = (() => {
      const storage = new InMemoryStorage();
      const queue = new DistributionQueue(storage, undefined, clock);
      const analytics = new DistributionAnalyticsStore(storage);
      const metrics: MetricsProvider = () => ({ impressions: 1000, engagements: 50, conversions: 2, leads: 2, revenue: 900 });
      const engine = new DistributionEngine(queue, new PublisherRegistry({ linkedin: transport }), analytics, {
        env: { LINKEDIN_TOKEN: "x" }, clock, metrics,
      });
      return { queue, analytics, engine };
    })();
    queue.enqueue(input());
    queue.approve("j1");
    const res = engine.run();
    assert.equal(res.published, 1);
    assert.equal(queue.get("j1")?.status, "published");
    assert.equal(queue.get("j1")?.externalId, "ext-j1");
    assert.equal(analytics.all().length, 1);
    assert.equal(analytics.all()[0]?.confidence, "high");
  });

  test("email channel → sent (not published)", () => {
    const storage = new InMemoryStorage();
    const queue = new DistributionQueue(storage, undefined, clock);
    const analytics = new DistributionAnalyticsStore(storage);
    const engine = new DistributionEngine(queue, new PublisherRegistry({ email: transport }), analytics, {
      env: { GMAIL_TOKEN: "x" }, clock,
    });
    queue.enqueue(input({ id: "e1", channel: "email", subject: "Demo", recipient: "a@b.c" }));
    queue.approve("e1");
    const res = engine.run();
    assert.equal(res.sent, 1);
    assert.equal(queue.get("e1")?.status, "sent");
  });
});

describe("Distribution Engine: Brand Guardian gate", () => {
  test("greenwashing claim blocks the publish (failed, not published)", () => {
    const transport: Transport = () => ({ ok: true, detail: "ok" });
    const storage = new InMemoryStorage();
    const queue = new DistributionQueue(storage, undefined, clock);
    const analytics = new DistributionAnalyticsStore(storage);
    const engine = new DistributionEngine(queue, new PublisherRegistry({ linkedin: transport }), analytics, {
      env: { LINKEDIN_TOKEN: "x" }, clock,
    });
    queue.enqueue(input({ body: "Wir sind 100% klimaneutral. CTA: Demo buchen" }));
    queue.approve("j1");
    const res = engine.run();
    assert.equal(res.blocked, 1);
    assert.equal(res.failed, 1);
    assert.equal(res.published, 0);
    assert.match(queue.get("j1")?.note ?? "", /brand-block/);
  });
});

describe("Distribution Engine: only approved jobs are distributed", () => {
  test("a pending job is never touched", () => {
    const transport: Transport = () => ({ ok: true, detail: "ok" });
    const { queue, engine } = setup({ linkedin: transport });
    queue.enqueue(input()); // not approved
    const res = engine.run();
    assert.equal(res.attempted, 0);
    assert.equal(queue.get("j1")?.status, "pending-approval");
  });
});
