// Vorschlag nur EINMAL vorlegen. Die Warteschlange prueft nur offene Duplikate;
// nach Freigabe oder Ablehnung wuerde der taegliche Lauf denselben Vorschlag
// sonst neu einreihen (passiert am 12.11. mit abgelehnten Kampagnen-Starts).
// Eine Entscheidung des Gruenders gilt, bis sich die goalId aendert.

import type { ApprovalInput, ApprovalQueue } from "../approval-queue.js";

export function vorlegen(queue: Pick<ApprovalQueue, "all" | "enqueue">, v: ApprovalInput): boolean {
  if (queue.all().some((e) => e.goalId === v.goalId)) return false;
  queue.enqueue(v);
  return true;
}
