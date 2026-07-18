// Phase 4 — Connector Router tests. Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Task } from "./types.js";
import { ConnectorRouter } from "./connector-router.js";

const router = new ConnectorRouter();
const task = (description: string, kind: Task["kind"] = "general"): Task => ({
  id: "t",
  description,
  kind,
});

describe("Phase 4: Connector Router", () => {
  test("React upgrade -> GitHub", () => {
    assert.equal(router.route(task("Upgrade React to 18")), "GitHub");
  });

  test("Database migration -> Supabase", () => {
    assert.equal(router.route(task("Run a database migration")), "Supabase");
  });

  test("Documentation task -> Filesystem", () => {
    assert.equal(router.route(task("Update the project documentation")), "Filesystem");
  });

  test("General coding task -> Claude", () => {
    assert.equal(router.route(task("General coding task to add a function")), "Claude");
  });

  test("Unknown task -> None (execution continues normally)", () => {
    assert.equal(router.route(task("Reticulate the splines")), "None");
  });

  test("routing is deterministic across runs", () => {
    assert.equal(router.route(task("Upgrade React")), router.route(task("Upgrade React")));
    assert.equal(router.route(task("Reticulate the splines")), router.route(task("Reticulate the splines")));
  });
});
