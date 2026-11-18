// Phase 2 — automation loop tests. Deterministic, offline, fast.
//
// We force offline mode so a tick never touches the network or a real model:
//   • clear the real-provider env vars  -> loadResearchProviders stays mock,
//   • clear ANTHROPIC_API_KEY           -> the ClaudeWorker simulates work.
// Sleep is injected, so no test ever waits on a real timer.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createTedosLoop, installSignalHandlers, type TedosLoop } from "./tedos-loop.js";
import { activateSkillLoading, SkillLoader } from "./skill-loader.js";

// Hermetic environment for every test in this file.
for (const key of [
  "TEDOS_NPM_PACKAGES",
  "TEDOS_RELEASE_REPOS",
  "ANTHROPIC_RELEASES_URL",
  "OPENAI_RELEASES_URL",
  "ANTHROPIC_API_KEY",
  "TEDOS_MAX_TICKS",
  "TEDOS_LOOP_INTERVAL_MS",
  "TEDOS_PROJECT",
]) {
  delete process.env[key];
}

const noopSleep = async (): Promise<void> => {};
const noopLog = (): void => {};

describe("Phase 2: TedOS automation loop", () => {
  test("respects TEDOS_MAX_TICKS (stops after N ticks)", async () => {
    const loop = createTedosLoop({ maxTicks: 2, intervalMs: 0, sleep: noopSleep, log: noopLog });
    const summaries = await loop.run();
    assert.equal(summaries.length, 2, "ran exactly two ticks");
    assert.deepEqual(
      summaries.map((s) => s.tick),
      [1, 2],
    );
  });

  test("uses the configured interval and does not sleep after the final tick", async () => {
    const slept: number[] = [];
    const loop = createTedosLoop({
      maxTicks: 2,
      intervalMs: 1234,
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: noopLog,
    });
    await loop.run();
    assert.equal(loop.intervalMs, 1234, "interval is configurable");
    assert.deepEqual(slept, [1234], "slept once between two ticks, never after the last");
  });

  test("runs one tick without throwing and reports numeric counters", async () => {
    const loop = createTedosLoop({ maxTicks: 1, sleep: noopSleep, log: noopLog });
    const summary = await loop.tick(1);
    assert.equal(summary.tick, 1);
    assert.equal(typeof summary.discovered, "number");
    assert.ok(summary.discovered > 0, "mock providers surfaced candidates");
    assert.ok(summary.submitted > 0, "candidates were submitted through the pipeline");
    assert.ok(summary.processed >= 0, "runtime processed the backlog");
  });

  test("stop() halts an otherwise-infinite loop after the current tick", async () => {
    let loop: TedosLoop;
    // maxTicks=null means run forever; stop() during the first sleep must end it.
    loop = createTedosLoop({
      maxTicks: null,
      intervalMs: 0,
      log: noopLog,
      sleep: async () => {
        loop.stop();
      },
    });
    const summaries = await loop.run();
    assert.equal(summaries.length, 1, "finished the current tick, then exited");
  });

  test("SIGINT/SIGTERM handlers are installed and cleanly removed", () => {
    const loop = createTedosLoop({ maxTicks: 1, sleep: noopSleep, log: noopLog });
    const beforeInt = process.listenerCount("SIGINT");
    const beforeTerm = process.listenerCount("SIGTERM");

    const uninstall = installSignalHandlers(loop);
    assert.equal(process.listenerCount("SIGINT"), beforeInt + 1, "SIGINT handler added");
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm + 1, "SIGTERM handler added");

    uninstall();
    assert.equal(process.listenerCount("SIGINT"), beforeInt, "SIGINT handler removed");
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm, "SIGTERM handler removed");
  });

  test("integration: a task executed through the normal loop loads the expected skill", async () => {
    // Capture what the skill-aware worker logs inside the real Runtime path.
    const logs: string[] = [];
    const restore = activateSkillLoading(new SkillLoader(), (m) => logs.push(m));
    try {
      const loop = createTedosLoop({ maxTicks: 1, intervalMs: 0, sleep: noopSleep, log: noopLog });
      await loop.run();
    } finally {
      restore(); // always restore the original WorkerFactory.create
    }

    const joined = logs.join("\n");
    assert.match(joined, /Loaded skill:/, "a skill was loaded during loop execution");
    assert.match(joined, /react\.md/, "the React seed task loaded react.md");
  });
});
