// Evidence Layer tests. Deterministic, offline — uses an injected env.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DATA_SOURCES,
  isAvailable,
  dataSourceStatus,
  missingDataChecklist,
  tagKpi,
  hasAnyLiveData,
} from "./evidence.js";

const EMPTY: NodeJS.ProcessEnv = {};
const WITH_GSC: NodeJS.ProcessEnv = { GSC_SERVICE_ACCOUNT_JSON: "{...}", GSC_SITE_URL: "https://heycarbo.com" };

describe("Evidence Layer", () => {
  test("knows the configured data sources", () => {
    const names = DATA_SOURCES.map((d) => d.source);
    for (const s of ["Google Search Console", "Google Analytics 4", "Stripe", "Supabase", "LinkedIn", "Instagram", "Gmail"]) {
      assert.ok(names.includes(s), s);
    }
  });

  test("a source is available only when ALL its env vars are set", () => {
    assert.equal(isAvailable("Google Search Console", EMPTY), false);
    assert.equal(isAvailable("Google Search Console", { GSC_SERVICE_ACCOUNT_JSON: "x" }), false); // missing GSC_SITE_URL
    assert.equal(isAvailable("Google Search Console", WITH_GSC), true);
  });

  test("with no env, everything is low-confidence and unavailable", () => {
    const statuses = dataSourceStatus(EMPTY);
    assert.ok(statuses.every((s) => !s.available && s.confidence === "low"));
    assert.equal(hasAnyLiveData(EMPTY), false);
  });

  test("missingDataChecklist names the source + the exact env vars", () => {
    const list = missingDataChecklist(WITH_GSC);
    assert.ok(!list.some((l) => l.startsWith("Google Search Console")), "GSC satisfied → not listed");
    assert.ok(list.some((l) => l.startsWith("Stripe: set STRIPE_SECRET_KEY")));
    assert.ok(list.every((l) => l.includes("connectors-setup.md")));
  });

  test("tagKpi marks hypotheses low-confidence and live data high", () => {
    const hypo = tagKpi("organicTraffic", "Google Search Console", EMPTY);
    assert.deepEqual(hypo, { kpi: "organicTraffic", source: "none", freshness: "n/a (hypothesis)", confidence: "low" });
    const live = tagKpi("organicTraffic", "Google Search Console", WITH_GSC);
    assert.equal(live.confidence, "high");
    assert.equal(live.source, "Google Search Console");
    assert.equal(live.freshness, "live");
  });

  test("hasAnyLiveData flips true once a source is configured", () => {
    assert.equal(hasAnyLiveData(WITH_GSC), true);
  });
});
