import type { ActiveProject } from "./project.js";
import type { PolicyEngine } from "./policy.js";
import type { ApprovalGate } from "./approval-gate.js";
import { Runtime } from "./runtime.js";
import type { RuntimeState } from "./runtime.js";

/**
 * Scheduler is the autonomous trigger for TedOS.
 *
 * Its single rule (see /scheduler/README.md): never wait for work if
 * work already exists. It hands control to the Runtime — together with
 * the Policy Engine and Approval Gate that guard every goal — when the
 * active project has pending work, and stays idle otherwise.
 */
export class Scheduler {
  constructor(
    private readonly project: ActiveProject,
    private readonly policy: PolicyEngine,
    private readonly approvals: ApprovalGate,
  ) {}

  /**
   * Start work if the active project has any.
   * Returns the resulting Runtime state, or null when there is nothing to do.
   */
  async start(): Promise<RuntimeState | null> {
    if (this.project.engine.isEmpty()) {
      return null;
    }
    return new Runtime(this.project, this.policy, this.approvals).run();
  }
}
