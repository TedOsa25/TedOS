import type { Storage } from "./storage.js";

/** A goal waiting for human approval. */
export interface ApprovalRecord {
  id: string;
  reason: string;
}

/** Persisted approval state. */
interface ApprovalState {
  approved: string[];
  awaiting: ApprovalRecord[];
}

const KEY = "approvals";

/**
 * ApprovalGate tracks which goals a human has approved.
 *
 * State lives in the existing Storage, so pending approvals survive
 * restarts: a goal can sit awaiting approval across runs until someone
 * approves it. The Runtime asks the gate before executing approval-gated
 * work; an operator approves through it.
 */
export class ApprovalGate {
  private readonly state: ApprovalState;

  constructor(private readonly storage: Storage) {
    this.state = storage.load<ApprovalState>(KEY) ?? { approved: [], awaiting: [] };
  }

  /** True once a human has approved this goal. */
  isApproved(id: string): boolean {
    return this.state.approved.includes(id);
  }

  /** Record that a goal is blocked awaiting approval (idempotent). */
  requestApproval(id: string, reason: string): void {
    if (this.isApproved(id)) return;
    if (this.state.awaiting.some((record) => record.id === id)) return;
    this.state.awaiting.push({ id, reason });
    this.persist();
  }

  /** Approve a goal so it may run on the next pass. */
  approve(id: string): void {
    this.state.awaiting = this.state.awaiting.filter((record) => record.id !== id);
    if (!this.state.approved.includes(id)) this.state.approved.push(id);
    this.persist();
  }

  /** Goals currently waiting for approval. */
  awaiting(): readonly ApprovalRecord[] {
    return this.state.awaiting;
  }

  private persist(): void {
    this.storage.save(KEY, this.state);
  }
}
