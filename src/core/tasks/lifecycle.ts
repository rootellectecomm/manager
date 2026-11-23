/**
 * Task lifecycle state machine.
 * NEW → TRIAGED → ASSIGNED → RESEARCHING → PLANNED → EXECUTING → TESTING →
 * MANAGER_REVIEW → AWAITING_APPROVAL → RELEASED → VERIFIED → COMPLETED
 * plus BLOCKED, FAILED, PAUSED, CANCELLED, NEEDS_REWORK.
 *
 * COMPLETED is only reachable from VERIFIED, and VERIFIED requires evidence
 * (enforced in service.transitionTask) — an agent's answer alone never closes a task.
 */
export const TASK_STATES = [
  "NEW", "TRIAGED", "ASSIGNED", "RESEARCHING", "PLANNED", "EXECUTING", "TESTING",
  "MANAGER_REVIEW", "AWAITING_APPROVAL", "RELEASED", "VERIFIED", "COMPLETED",
  "BLOCKED", "FAILED", "PAUSED", "CANCELLED", "NEEDS_REWORK",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL: TaskState[] = ["COMPLETED", "CANCELLED"];
const SIDE: TaskState[] = ["BLOCKED", "FAILED", "PAUSED", "CANCELLED"];

const FORWARD: Record<TaskState, TaskState[]> = {
  NEW: ["TRIAGED"],
  TRIAGED: ["ASSIGNED"],
  ASSIGNED: ["RESEARCHING", "PLANNED", "EXECUTING"],
  RESEARCHING: ["PLANNED", "EXECUTING"],
  PLANNED: ["EXECUTING"],
  EXECUTING: ["TESTING", "MANAGER_REVIEW"],
  TESTING: ["MANAGER_REVIEW", "NEEDS_REWORK"],
  MANAGER_REVIEW: ["AWAITING_APPROVAL", "RELEASED", "NEEDS_REWORK", "VERIFIED"],
  AWAITING_APPROVAL: ["RELEASED", "NEEDS_REWORK"],
  RELEASED: ["VERIFIED", "NEEDS_REWORK"],
  VERIFIED: ["COMPLETED"],
  COMPLETED: [],
  NEEDS_REWORK: ["ASSIGNED", "RESEARCHING", "PLANNED", "EXECUTING"],
  BLOCKED: [], PAUSED: [], FAILED: ["ASSIGNED", "NEEDS_REWORK"], CANCELLED: [],
};

export function allowedTransitions(from: TaskState, resumeTo?: TaskState | null): TaskState[] {
  if (TERMINAL.includes(from)) return [];
  const next = new Set<TaskState>(FORWARD[from]);
  for (const s of SIDE) if (s !== from) next.add(s);
  // BLOCKED/PAUSED resume to where they were (or re-triage if unknown).
  if (from === "BLOCKED" || from === "PAUSED") next.add(resumeTo ?? "TRIAGED");
  return [...next];
}

export function canTransition(from: TaskState, to: TaskState, resumeTo?: TaskState | null): boolean {
  return allowedTransitions(from, resumeTo).includes(to);
}

export const STATE_LABEL: Record<TaskState, string> = {
  NEW: "New", TRIAGED: "Triaged", ASSIGNED: "Assigned", RESEARCHING: "Researching", PLANNED: "Planned",
  EXECUTING: "Executing", TESTING: "Testing", MANAGER_REVIEW: "Manager review", AWAITING_APPROVAL: "Awaiting approval",
  RELEASED: "Released", VERIFIED: "Verified", COMPLETED: "Completed", BLOCKED: "Blocked", FAILED: "Failed",
  PAUSED: "Paused", CANCELLED: "Cancelled", NEEDS_REWORK: "Needs rework",
};
