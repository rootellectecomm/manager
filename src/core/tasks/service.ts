import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";
import { canTransition, type TaskState, allowedTransitions } from "./lifecycle";

export interface Evidence { kind: string; ref: string; note?: string; at?: string }

export interface NewTask {
  title: string;
  objective: string;
  source: "founder" | "schedule" | "webhook" | "agent" | "workflow";
  trigger?: string;
  projectId?: string;
  parentId?: string;
  ownerAgentCode?: string;
  inputs?: Record<string, unknown>;
  expectedDeliverable?: string;
  acceptanceCriteria?: string[];
  requiredTools?: string[];
  riskLevel?: number;
  priority?: number;
  dueAt?: Date;
  dedupeKey?: string;
  dependsOn?: string[];
  actor: string;
}

/** Creates a task. If dedupeKey matches an open task, returns that task instead (deduplication). */
export async function createTask(t: NewTask) {
  if (t.dedupeKey) {
    const existing = await db.task.findUnique({ where: { dedupeKey: t.dedupeKey } });
    if (existing) return { task: existing, deduplicated: true as const };
  }
  const owner = t.ownerAgentCode ? await db.agent.findUnique({ where: { code: t.ownerAgentCode } }) : null;
  if (t.ownerAgentCode && !owner) throw new Error(`Unknown agent ${t.ownerAgentCode}`);
  const task = await db.task.create({
    data: {
      title: t.title, objective: t.objective, source: t.source, trigger: t.trigger ?? "",
      projectId: t.projectId, parentId: t.parentId,
      ownerAgentId: owner?.id, departmentId: owner?.departmentId,
      inputs: j(t.inputs ?? {}), expectedDeliverable: t.expectedDeliverable ?? "",
      acceptanceCriteria: j(t.acceptanceCriteria ?? []), requiredTools: j(t.requiredTools ?? []),
      riskLevel: t.riskLevel ?? 0, priority: t.priority ?? 3, dueAt: t.dueAt,
      dedupeKey: t.dedupeKey, status: owner ? "ASSIGNED" : "NEW",
      dependsOn: t.dependsOn?.length ? { create: t.dependsOn.map((id) => ({ dependsOnId: id })) } : undefined,
    },
  });
  await db.taskEvent.create({ data: { taskId: task.id, fromState: null, toState: task.status, actor: t.actor, note: "created" } });
  await audit({ actor: t.actor, action: "task.create", entityType: "task", entityId: task.id, data: { title: t.title, owner: t.ownerAgentCode ?? null, risk: task.riskLevel } });
  return { task, deduplicated: false as const };
}

export class TransitionError extends Error {}

export async function transitionTask(taskId: string, to: TaskState, actor: string, note = "", patch: { evidence?: Evidence[]; output?: unknown; testResults?: unknown[] } = {}) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const from = task.status as TaskState;
  const resumeTo = await lastActiveState(taskId);
  if (!canTransition(from, to, resumeTo)) {
    throw new TransitionError(`Illegal transition ${from} → ${to}. Allowed: ${allowedTransitions(from, resumeTo).join(", ") || "none"}`);
  }
  const evidence = [...parseJson<Evidence[]>(task.evidence, []), ...(patch.evidence ?? []).map((e) => ({ ...e, at: e.at ?? new Date().toISOString() }))];
  if (to === "VERIFIED" && evidence.length === 0) {
    throw new TransitionError("Cannot verify a task without execution evidence.");
  }
  if (to === "COMPLETED" && from !== "VERIFIED") throw new TransitionError("Only verified tasks can be completed.");
  if (["EXECUTING", "RESEARCHING", "PLANNED"].includes(to)) {
    const blockers = await db.taskDependency.findMany({ where: { taskId }, include: { dependsOn: true } });
    const open = blockers.filter((b) => b.dependsOn.status !== "COMPLETED");
    if (open.length) throw new TransitionError(`Blocked by unfinished dependencies: ${open.map((b) => b.dependsOn.title).join("; ")}`);
  }
  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      status: to, statusReason: note || null, evidence: j(evidence),
      ...(patch.output !== undefined ? { output: j(patch.output) } : {}),
      ...(patch.testResults ? { testResults: j([...parseJson<unknown[]>(task.testResults, []), ...patch.testResults]) } : {}),
      ...(to === "COMPLETED" ? { completedAt: new Date() } : {}),
      ...(to === "NEEDS_REWORK" || to === "FAILED" ? { attempts: { increment: 1 } } : {}),
    },
  });
  await db.taskEvent.create({ data: { taskId, fromState: from, toState: to, actor, note } });
  await audit({ actor, action: "task.transition", entityType: "task", entityId: taskId, data: { from, to, note } });
  return updated;
}

/** The last non-side state, so BLOCKED/PAUSED tasks resume where they stopped. */
async function lastActiveState(taskId: string): Promise<TaskState | null> {
  const events = await db.taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const e of events) {
    const s = e.toState as TaskState;
    if (!["BLOCKED", "PAUSED", "FAILED", "CANCELLED"].includes(s)) return s;
  }
  return null;
}

export async function assignTask(taskId: string, agentCode: string, actor: string) {
  const agent = await db.agent.findUniqueOrThrow({ where: { code: agentCode } });
  if (agent.status === "PAUSED" || agent.status === "RETIRED") throw new TransitionError(`${agent.name} is ${agent.status.toLowerCase()} and cannot take work.`);
  const task = await db.task.update({ where: { id: taskId }, data: { ownerAgentId: agent.id, departmentId: agent.departmentId } });
  if (task.status === "NEW") await transitionTask(taskId, "TRIAGED", actor, "triaged on assignment");
  const fresh = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (fresh.status === "TRIAGED") await transitionTask(taskId, "ASSIGNED", actor, `assigned to ${agent.code} ${agent.name}`);
  await audit({ actor, action: "task.assign", entityType: "task", entityId: taskId, data: { agent: agentCode } });
}

export async function addEvidence(taskId: string, ev: Evidence[], actor: string) {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const evidence = [...parseJson<Evidence[]>(task.evidence, []), ...ev.map((e) => ({ ...e, at: e.at ?? new Date().toISOString() }))];
  await db.task.update({ where: { id: taskId }, data: { evidence: j(evidence) } });
  await audit({ actor, action: "task.evidence", entityType: "task", entityId: taskId, data: { count: ev.length } });
}

/** Founder override: stop or cancel any task, regardless of state. */
export async function founderOverride(taskId: string, action: "pause" | "cancel" | "resume", actor: string, note = "") {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (action === "pause") return transitionTask(taskId, "PAUSED", actor, note || "paused by founder");
  if (action === "cancel") return transitionTask(taskId, "CANCELLED", actor, note || "cancelled by founder");
  const resumeTo = (await lastActiveState(taskId)) ?? "TRIAGED";
  if (task.status !== "PAUSED" && task.status !== "BLOCKED") throw new TransitionError("Only paused or blocked tasks can be resumed.");
  return transitionTask(taskId, resumeTo, actor, note || "resumed by founder");
}

/** Tasks past due or not updated for a while — surfaced to the Chief of Staff. */
export async function findStalledTasks(staleHours = 24) {
  const cutoff = new Date(Date.now() - staleHours * 3600_000);
  const active = { notIn: ["COMPLETED", "CANCELLED", "PAUSED"] };
  return db.task.findMany({
    where: { status: active, OR: [{ updatedAt: { lt: cutoff } }, { dueAt: { lt: new Date() } }] },
    include: { owner: true }, orderBy: { priority: "asc" }, take: 50,
  });
}
