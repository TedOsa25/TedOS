// Sprint 9 — Connectors tests. Deterministic, offline, no AI, no network.

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { Task } from "./types.js";
import { ConnectorRouter } from "./connector-router.js";
import {
  ConnectorRegistry,
  GitHubConnector,
  SupabaseConnector,
  VercelConnector,
  LinkedInConnector,
  InstagramConnector,
} from "./connectors.js";

const task = (description: string): Task => ({ id: "t", description, kind: "general" });

/** Env vars these connectors read; cleared before each test for determinism. */
const ENV_VARS = [
  "GITHUB_TOKEN",
  "GITHUB_REPO",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT",
  "LINKEDIN_TOKEN",
  "LINKEDIN_ORG",
  "INSTAGRAM_TOKEN",
  "INSTAGRAM_ACCOUNT",
];

beforeEach(() => {
  for (const key of ENV_VARS) delete process.env[key];
});

describe("Sprint 9: ConnectorRouter routes the three required connectors", () => {
  const router = new ConnectorRouter();
  test("pull request -> GitHub", () => assert.equal(router.route(task("Open a pull request")), "GitHub"));
  test("database migration -> Supabase", () =>
    assert.equal(router.route(task("Run a database migration")), "Supabase"));
  test("deploy -> Vercel", () => assert.equal(router.route(task("Deploy to Vercel production")), "Vercel"));
  test("existing routes still hold (no redesign)", () => {
    assert.equal(router.route(task("Update the project documentation")), "Filesystem");
    assert.equal(router.route(task("Implement a coding feature")), "Claude");
    assert.equal(router.route(task("Reticulate the splines")), "None");
  });
});

describe("Sprint 9: each connector reports config independently, offline", () => {
  test("GitHub: not configured by default, configured with env (no secret leak)", () => {
    const gh = new GitHubConnector();
    assert.equal(gh.status().configured, false);
    process.env.GITHUB_TOKEN = "secret-token";
    process.env.GITHUB_REPO = "tedos/tedos";
    const s = gh.status();
    assert.equal(s.configured, true);
    assert.match(s.detail, /tedos\/tedos/);
    assert.doesNotMatch(s.detail, /secret-token/, "never prints the token");
  });

  test("Supabase: reports host only, never the key", () => {
    const sb = new SupabaseConnector();
    assert.equal(sb.status().configured, false);
    process.env.SUPABASE_URL = "https://abc123.supabase.co";
    process.env.SUPABASE_KEY = "super-secret-key";
    const s = sb.status();
    assert.equal(s.configured, true);
    assert.match(s.detail, /abc123\.supabase\.co/);
    assert.doesNotMatch(s.detail, /super-secret-key/, "never prints the key");
  });

  test("Vercel: configured by token alone, optional project shown", () => {
    const vc = new VercelConnector();
    assert.equal(vc.status().configured, false);
    process.env.VERCEL_TOKEN = "vtoken";
    assert.equal(vc.status().configured, true);
    process.env.VERCEL_PROJECT = "tedos-web";
    assert.match(vc.status().detail, /tedos-web/);
    assert.doesNotMatch(vc.status().detail, /vtoken/, "never prints the token");
  });
});

describe("Sprint 9: ConnectorRegistry reuses the router to select connectors", () => {
  const registry = new ConnectorRegistry();

  test("registers exactly the three required connectors", () => {
    assert.deepEqual(
      registry.all().map((c) => c.type).sort(),
      ["GitHub", "Instagram", "LinkedIn", "Supabase", "Vercel"],
    );
  });

  test("forTask routes via the existing router to the right connector", () => {
    assert.equal(registry.forTask(task("Open a pull request")).connector?.type, "GitHub");
    assert.equal(registry.forTask(task("Run a database migration")).connector?.type, "Supabase");
    assert.equal(registry.forTask(task("Roll back the deployment")).connector?.type, "Vercel");
  });

  test("routes without an external connector resolve to null (execution continues)", () => {
    const docs = registry.forTask(task("Update the README documentation"));
    assert.equal(docs.type, "Filesystem");
    assert.equal(docs.connector, null);
    const unknown = registry.forTask(task("Reticulate the splines"));
    assert.equal(unknown.type, "None");
    assert.equal(unknown.connector, null);
  });

  test("routing is deterministic across calls", () => {
    const t = task("Deploy the preview build");
    assert.equal(registry.forTask(t).type, registry.forTask(t).type);
    assert.equal(registry.forTask(t).type, "Vercel");
  });
});

describe("Social connectors: LinkedIn + Instagram (approval-gated, credential-gated)", () => {
  test("router routes social tasks to the right platform", () => {
    const router = new ConnectorRouter();
    assert.equal(router.route(task("Publish the post on LinkedIn")), "LinkedIn");
    assert.equal(router.route(task("Schedule an Instagram story")), "Instagram");
  });

  test("inert without credentials — cannot publish, reports not-configured", () => {
    const li = new LinkedInConnector();
    const ig = new InstagramConnector();
    assert.equal(li.canPublish(), false);
    assert.equal(li.status().configured, false);
    assert.equal(ig.canPublish(), false);
    assert.equal(ig.status().configured, false);
  });

  test("becomes publish-ready only when a token is set (no secret leak)", () => {
    const li = new LinkedInConnector();
    process.env.LINKEDIN_TOKEN = "li-secret";
    process.env.LINKEDIN_ORG = "heycarbo";
    assert.equal(li.canPublish(), true);
    assert.match(li.status().detail, /heycarbo/);
    assert.doesNotMatch(li.status().detail, /li-secret/);
  });

  test("registry resolves social tasks to their connector", () => {
    const registry = new ConnectorRegistry();
    assert.equal(registry.forTask(task("post to LinkedIn")).connector?.type, "LinkedIn");
    assert.equal(registry.forTask(task("an instagram reel")).connector?.type, "Instagram");
  });
});
