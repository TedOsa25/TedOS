import type { DiscoverySummary } from "./types.js";
import type { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import type { Scheduler } from "./scheduler.js";
import type { RuntimeState } from "./runtime.js";

/** What happened during a single autonomous tick. */
export interface TickSummary {
  tick: number;
  discovery: DiscoverySummary;
  /** Runtime totals, or null when the Scheduler found no work to run. */
  execution: RuntimeState | null;
}

/**
 * AutonomousRunner turns TedOS from a one-shot run into repeated cycles.
 *
 * Each tick discovers new work (which the Discovery Engine submits to
 * the Goal Engine) and then runs the Scheduler over whatever is pending.
 * A tick is always bounded — it processes the current backlog and
 * returns. The host decides when to tick again; there are no timers and
 * no infinite loops here.
 */
export class AutonomousRunner {
  private ticks = 0;

  constructor(
    private readonly discovery: GoalDiscoveryEngine,
    private readonly scheduler: Scheduler,
  ) {}

  /** Run one discover -> execute cycle and report what happened. */
  async tick(): Promise<TickSummary> {
    this.ticks += 1;
    const { summary } = this.discovery.run();
    const execution = await this.scheduler.start();
    return { tick: this.ticks, discovery: summary, execution };
  }

  /** Run a bounded number of ticks back to back. */
  async run(times: number): Promise<TickSummary[]> {
    const summaries: TickSummary[] = [];
    for (let i = 0; i < times; i++) {
      summaries.push(await this.tick());
    }
    return summaries;
  }
}
