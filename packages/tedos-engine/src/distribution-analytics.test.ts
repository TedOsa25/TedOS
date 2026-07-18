// Distribution Analytics + Learning + Executive section tests. Deterministic.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { DistributionJob } from "./distribution-queue.js";
import {
  captureMetrics,
  learnFromMetrics,
  buildDistributionSection,
  renderDistributionSection,
  type DistributionMetrics,
} from "./distribution-analytics.js";

const clock = (): string => "2026-06-26T14:00:00.000Z";

const job = (over: Partial<DistributionJob> = {}): DistributionJob => ({
  id: "j1", source: "marketing", channel: "linkedin", campaign: "c1", title: "t", body: "b",
  status: "published", createdAt: clock(), updatedAt: clock(), ...over,
});

describe("captureMetrics: no fabrication without a live provider", () => {
  test("no provider → all-zero, low confidence", () => {
    const m = captureMetrics(job(), undefined, clock);
    assert.equal(m.confidence, "low");
    assert.equal(m.impressions, 0);
    assert.equal(m.revenue, 0);
  });

  test("provider → high confidence with the given numbers", () => {
    const m = captureMetrics(job(), () => ({ impressions: 500, leads: 3, revenue: 1200 }), clock);
    assert.equal(m.confidence, "high");
    assert.equal(m.impressions, 500);
    assert.equal(m.leads, 3);
  });
});

describe("learnFromMetrics: which content wins", () => {
  const metrics: DistributionMetrics[] = [
    captureMetrics(job({ id: "a", channel: "linkedin", cta: "Demo buchen" }), () => ({ engagements: 100, conversions: 5, revenue: 1000 }), clock),
    captureMetrics(job({ id: "b", channel: "email", cta: "Demo buchen", subject: "Scope 3 Daten" }), () => ({ opens: 80, conversions: 1, revenue: 200 }), clock),
  ];
  const jobs = [
    job({ id: "a", channel: "linkedin", cta: "Demo buchen" }),
    job({ id: "b", channel: "email", cta: "Demo buchen", subject: "Scope 3 Daten" }),
  ];

  test("aggregates per dimension and sorts best-first", () => {
    const learnings = learnFromMetrics(metrics, jobs);
    const channels = learnings.filter((l) => l.dimension === "channel");
    assert.equal(channels[0]?.key, "linkedin", "highest conversions first");
    const cta = learnings.find((l) => l.dimension === "cta" && l.key === "Demo buchen");
    assert.equal(cta?.posts, 2, "CTA aggregates across both posts");
    assert.equal(cta?.conversions, 6);
  });

  test("subject + hour dimensions are derived", () => {
    const learnings = learnFromMetrics(metrics, jobs);
    assert.ok(learnings.some((l) => l.dimension === "subject" && l.key === "scope 3 daten"));
    assert.ok(learnings.some((l) => l.dimension === "hour" && l.key === "14:00"));
  });
});

describe("buildDistributionSection + render", () => {
  test("counts published/sent, campaigns, attribution; ROI per campaign", () => {
    const jobs = [
      job({ id: "a", status: "published", campaign: "c1" }),
      job({ id: "b", status: "sent", channel: "email", campaign: "c2" }),
      job({ id: "c", status: "skipped", campaign: "c3" }),
    ];
    const metrics = [
      captureMetrics(jobs[0] as DistributionJob, () => ({ leads: 4, demoBookings: 2, revenue: 2000, engagements: 100 }), clock),
      captureMetrics(jobs[1] as DistributionJob, () => ({ leads: 1, trialSignups: 3, revenue: 300 }), clock),
    ];
    const section = buildDistributionSection(jobs, metrics);
    assert.equal(section.publishedPosts, 1);
    assert.equal(section.sentEmails, 1);
    assert.equal(section.activeCampaigns, 2);
    assert.equal(section.newLeads, 5);
    assert.equal(section.demoBookings, 2);
    assert.equal(section.trialSignups, 3);
    assert.equal(section.confidence, "high");
    assert.equal(section.topCampaigns[0]?.campaign, "c1", "highest revenue first");

    const out = renderDistributionSection(section);
    assert.ok(out.includes("## Distribution"));
    assert.ok(out.includes("Top campaigns"));
  });

  test("no live metrics → low confidence, no worst-campaign fabrication", () => {
    const section = buildDistributionSection([job({ status: "published" })], []);
    assert.equal(section.confidence, "low");
    assert.equal(section.worstCampaigns.length, 0);
  });
});
