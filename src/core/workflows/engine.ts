/**
 * Durable workflow engine (replay-based, Temporal-style semantics on the control-plane DB).
 *
 * - A workflow is an async function. Every side-effecting unit runs inside ctx.step(key, fn);
 *   completed steps are checkpointed, so after a crash/restart the function replays and
 *   completed steps return their stored output instead of running again.
 * - Runs are claimed with a lease (lockedBy/lockedUntil). A crashed worker's lease expires
 *   and another worker resumes the run from its last checkpoint.
 * - ctx.waitForApproval() parks the run (WAITING) until the founder decides — silence never
 *   counts as approval; the approval decision wakes the run.
 * - Failures retry with exponential backoff up to maxAttempts, then FAIL with an alert.
 *
 * ADR-001 explains why this is used instead of Temporal for Phase 1–3, and the migration path.
 */
import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";
import { env } from "../env";

export class WaitSignal extends Error {
  constructor(public waitingFor: { kind: "approval"; id: string } | { kind: "timer"; until: string }) { super("waiting"); }
}
export class CancelledError extends Error {}

export interface WfContext<I = Record<string, unknown>> {
  runId: string;
  input: I;
  taskId: string | null;
  step<T>(key: string, fn: () => Promise<T>): Promise<T>;
  waitForApproval(approvalId: string): Promise<"APPROVED" | "EXECUTED" | "REJECTED" | "CHANGES_REQUESTED" | "EXPIRED" | "EXECUTION_FAILED">;
  sleepUntil(until: Date): Promise<void>;
  log(note: string): Promise<void>;
}

export type WorkflowFn = (ctx: WfContext<any>) => Promise<unknown>;
const REGISTRY = new Map<string, { fn: WorkflowFn; maxAttempts: number; description: string }>();

export function defineWorkflow(type: string, fn: WorkflowFn, opts: { maxAttempts?: number; description?: string } = {}) {
  REGISTRY.set(type, { fn, maxAttempts: opts.maxAttempts ?? 5, description: opts.description ?? "" });
}
export function workflowTypes() { return [...REGISTRY.entries()].map(([type, v]) => ({ type, description: v.description })); }

export async function startWorkflow(type: string, input: Record<string, unknown>, opts: { dedupeKey?: string; taskId?: string; runAt?: Date; actor?: string } = {}) {
  if (opts.dedupeKey) {
    const existing = await db.workflowRun.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (existing) return existing;
  }
  const run = await db.workflowRun.create({ data: { workflowType: type, input: j(input), dedupeKey: opts.dedupeKey, taskId: opts.taskId, nextRunAt: opts.runAt ?? new Date() } });
  await audit({ actor: opts.actor ?? "system:workflow", action: "workflow.start", entityType: "workflow", entityId: run.id, data: { type } });
  return run;
}

export async function cancelWorkflow(runId: string, actor: string) {
  await db.workflowRun.update({ where: { id: runId }, data: { status: "CANCELLED", lockedBy: null, lockedUntil: null } });
  await audit({ actor, action: "workflow.cancel", entityType: "workflow", entityId: runId });
}

const LEASE_MS = 120_000;

/** Atomically claims one runnable workflow (new, due, woken, or abandoned by a dead worker). */
export async function claimNext(workerId = env.workerId) {
  const now = new Date();
  const candidates = await db.workflowRun.findMany({
    where: {
      OR: [
        { status: "PENDING", nextRunAt: { lte: now } },
        { status: "RUNNING", lockedUntil: { lt: now } }, // lease expired → worker died mid-run
      ],
    },
    orderBy: { nextRunAt: "asc" },
    take: 5,
  });
  for (const c of candidates) {
    const got = await db.workflowRun.updateMany({
      where: { id: c.id, status: c.status, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { status: "RUNNING", lockedBy: workerId, lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (got.count === 1) return db.workflowRun.findUniqueOrThrow({ where: { id: c.id } });
  }
  return null;
}

/** Executes (or resumes) a claimed run until it completes, waits, or fails. */
export async function executeRun(runId: string, workerId = env.workerId): Promise<string> {
  const run = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
  const def = REGISTRY.get(run.workflowType);
  if (!def) {
    await db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", error: `Unknown workflow type ${run.workflowType}`, lockedBy: null, lockedUntil: null } });
    return "FAILED";
  }
  const lease = setInterval(() => {
    void db.workflowRun.updateMany({ where: { id: runId, lockedBy: workerId }, data: { lockedUntil: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined);
  }, LEASE_MS / 3);

  const ctx: WfContext = {
    runId, input: parseJson(run.input, {}), taskId: run.taskId,
    async step<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const cp = await db.checkpoint.findUnique({ where: { runId_stepKey: { runId, stepKey: key } } });
      if (cp?.status === "DONE") return parseJson<T>(cp.output, undefined as T);
      const current = await db.workflowRun.findUnique({ where: { id: runId }, select: { status: true, lockedBy: true } });
      if (current?.status === "CANCELLED") throw new CancelledError("cancelled");
      if (current?.lockedBy !== workerId) throw new Error("Lease lost to another worker");
      const out = await fn();
      await db.checkpoint.upsert({
        where: { runId_stepKey: { runId, stepKey: key } },
        create: { runId, stepKey: key, status: "DONE", output: j(out ?? null) },
        update: { status: "DONE", output: j(out ?? null), attempt: { increment: 1 } },
      });
      return out;
    },
    async waitForApproval(approvalId: string) {
      const a = await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
      if (a.status === "PENDING" || a.status === "DEFERRED" || a.status === "DELEGATED") {
        if (a.expiresAt < new Date()) return "EXPIRED";
        throw new WaitSignal({ kind: "approval", id: approvalId });
      }
      // The decision was approval; whether execution later succeeded is tracked by the step that executed it.
      if (a.status === "EXECUTED" || a.status === "EXECUTION_FAILED") return "APPROVED";
      return a.status as "APPROVED";
    },
    async sleepUntil(until: Date) {
      if (Date.now() >= until.getTime()) return;
      throw new WaitSignal({ kind: "timer", until: until.toISOString() });
    },
    async log(note: string) {
      await audit({ actor: `workflow:${run.workflowType}`, action: "workflow.log", entityType: "workflow", entityId: runId, data: { note } });
    },
  };

  try {
    const result = await def.fn(ctx);
    await db.workflowRun.update({ where: { id: runId }, data: { status: "COMPLETED", result: j(result ?? null), error: null, waitingFor: null, lockedBy: null, lockedUntil: null } });
    await audit({ actor: `workflow:${run.workflowType}`, action: "workflow.complete", entityType: "workflow", entityId: runId });
    return "COMPLETED";
  } catch (e) {
    if (e instanceof WaitSignal) {
      const w = e.waitingFor;
      await db.workflowRun.update({
        where: { id: runId },
        data: w.kind === "approval"
          ? { status: "WAITING", waitingFor: j(w), lockedBy: null, lockedUntil: null, attempts: 0 }
          : { status: "PENDING", waitingFor: j(w), nextRunAt: new Date(w.until), lockedBy: null, lockedUntil: null, attempts: 0 },
      });
      return w.kind === "approval" ? "WAITING" : "SLEEPING";
    }
    if (e instanceof CancelledError) return "CANCELLED";
    const msg = (e as Error).message ?? String(e);
    const { BudgetExceededError } = await import("../ai/budget");
    if (e instanceof BudgetExceededError) {
      await db.workflowRun.update({ where: { id: runId }, data: { status: "WAITING", error: msg, waitingFor: j({ kind: "budget" }), lockedBy: null, lockedUntil: null } });
      const { raiseAlert } = await import("../comms/alerts");
      await raiseAlert({ severity: "SEV3", title: "AI budget exhausted — work paused", detail: msg, source: "system:budget", dedupeKey: `budget:${e.scope}:${new Date().toISOString().slice(0, 10)}` });
      return "PAUSED_BUDGET";
    }
    const fresh = await db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    if (fresh.attempts >= def.maxAttempts) {
      await db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", error: msg, lockedBy: null, lockedUntil: null } });
      const { raiseAlert } = await import("../comms/alerts");
      await raiseAlert({ severity: "SEV3", title: `Workflow failed: ${run.workflowType}`, detail: msg, source: "system:workflow", dedupeKey: `wf-failed:${runId}` });
      return "FAILED";
    }
    const backoffMs = Math.min(30 * 60_000, 15_000 * 2 ** (fresh.attempts - 1));
    await db.workflowRun.update({ where: { id: runId }, data: { status: "PENDING", error: msg, nextRunAt: new Date(Date.now() + backoffMs), lockedBy: null, lockedUntil: null } });
    return "RETRYING";
  } finally {
    clearInterval(lease);
  }
}

/** Wake runs whose approval has been decided (also done directly by decideApproval). */
export async function wakeDecidedApprovals() {
  const waiting = await db.workflowRun.findMany({ where: { status: "WAITING" } });
  let n = 0;
  for (const w of waiting) {
    const wf = parseJson<{ kind: string; id?: string }>(w.waitingFor, { kind: "" });
    if (wf.kind === "approval" && wf.id) {
      const a = await db.approvalRequest.findUnique({ where: { id: wf.id } });
      const decided = a && !["PENDING", "DEFERRED", "DELEGATED"].includes(a.status);
      const expired = a && a.expiresAt < new Date();
      if (decided || expired) { await db.workflowRun.update({ where: { id: w.id }, data: { status: "PENDING", nextRunAt: new Date() } }); n++; }
    }
  }
  return n;
}

/** Resume budget-paused runs once budgets allow (founder raised limit or period rolled over). */
export async function resumeBudgetPaused() {
  const { assertWithinBudget } = await import("../ai/budget");
  try { await assertWithinBudget({}); } catch { return 0; }
  const r = await db.workflowRun.updateMany({ where: { status: "WAITING", waitingFor: j({ kind: "budget" }) }, data: { status: "PENDING", nextRunAt: new Date() } });
  return r.count;
}
