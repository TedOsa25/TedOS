// Project Selection tests. Deterministic, offline, no AI.
//
// Verifies the live loop can be pointed at a selected project (TEDOS_PROJECT
// env or --project arg) while defaulting to TedOS, reusing ProjectRegistry +
// ProjectRouter. No kernel component is involved.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { selectProject, readProjectSelection, createTedosLoop } from "./tedos-loop.js";

// Hermetic: a stray TEDOS_PROJECT in the shell must not skew default-selection.
delete process.env.TEDOS_PROJECT;

describe("Project Selection: selectProject", () => {
  test("selects HeyCarbo by name", () => {
    assert.equal(selectProject("heycarbo").name, "HeyCarbo");
  });

  test("selects HeyAudit by name", () => {
    assert.equal(selectProject("heyaudit").name, "HeyAudit");
  });

  test("name match is case-insensitive", () => {
    assert.equal(selectProject("HEYCARBO").name, "HeyCarbo");
    assert.equal(selectProject("HeyAudit").name, "HeyAudit");
  });

  test("no selection -> defaults to TedOS itself", () => {
    assert.equal(selectProject(undefined).name, "TedOS");
    assert.equal(selectProject("").name, "TedOS");
  });

  test("unknown selection -> falls back to TedOS (never throws)", () => {
    assert.equal(selectProject("does-not-exist").name, "TedOS");
  });

  test("selected project carries its own context (repository + connectors)", () => {
    const carbo = selectProject("heycarbo");
    assert.equal(carbo.repository, "tedos/heycarbo");
    assert.ok(carbo.connectors.includes("vercel"));
  });
});

describe("Project Selection: readProjectSelection", () => {
  const savedArgv = process.argv;
  const savedEnv = process.env.TEDOS_PROJECT;

  afterEach(() => {
    process.argv = savedArgv;
    if (savedEnv === undefined) delete process.env.TEDOS_PROJECT;
    else process.env.TEDOS_PROJECT = savedEnv;
  });

  test("reads --project <name>", () => {
    process.argv = ["node", "tedos-loop.ts", "--project", "heyaudit"];
    delete process.env.TEDOS_PROJECT;
    assert.equal(readProjectSelection(), "heyaudit");
  });

  test("reads --project=<name>", () => {
    process.argv = ["node", "tedos-loop.ts", "--project=heycarbo"];
    delete process.env.TEDOS_PROJECT;
    assert.equal(readProjectSelection(), "heycarbo");
  });

  test("reads TEDOS_PROJECT env when no CLI arg", () => {
    process.argv = ["node", "tedos-loop.ts"];
    process.env.TEDOS_PROJECT = "heyaudit";
    assert.equal(readProjectSelection(), "heyaudit");
  });

  test("CLI arg overrides env", () => {
    process.argv = ["node", "tedos-loop.ts", "--project", "heycarbo"];
    process.env.TEDOS_PROJECT = "heyaudit";
    assert.equal(readProjectSelection(), "heycarbo");
  });

  test("nothing set -> undefined (default applies downstream)", () => {
    process.argv = ["node", "tedos-loop.ts"];
    delete process.env.TEDOS_PROJECT;
    assert.equal(readProjectSelection(), undefined);
  });
});

describe("Project Selection: createTedosLoop honours the option", () => {
  test("explicit project option is reflected on the loop", () => {
    const loop = createTedosLoop({ project: "heycarbo", maxTicks: 1, intervalMs: 0 });
    assert.equal(loop.selected.name, "HeyCarbo");
  });

  test("default loop runs against TedOS", () => {
    const loop = createTedosLoop({ maxTicks: 1, intervalMs: 0 });
    assert.equal(loop.selected.name, "TedOS");
  });
});
