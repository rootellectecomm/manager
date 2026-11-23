/**
 * Tool execution gateway — the single choke point for every action an agent takes.
 * Approval policy is enforced HERE, in code, not in prompts:
 *
 *  1. Emergency stop blocks everything except read-only (level 0).
 *  2. "Pause production-changing actions" blocks level ≥ 2.
 *  3. Unknown or disabled tools are denied.
 *  4. The agent must be active (not paused/retired) and have the tool on its allowlist.
 *  5. Shadow-mode agents may only run levels 0–1; higher actions become proposals.
 *  6. Level 2 needs a founder standing approval on the tool, within its caps.
 *  7. Level 3–4 need an APPROVED, unexpired, unexecuted request for this agent + tool
 *     whose parameter hash matches exactly — changed parameters are refused.
 *  8. External side-effects run once per idempotency key; an interrupted call is never
 *     blindly retried (it is flagged for manual verification instead).
 */
import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";
import { hashParams, sha256, canonicalJson } from "../crypto";
import { areProductionWritesPaused, isEmergencyStopped } from "../settings";
import { requestApproval, type ApprovalInput } from "../approvals";
import { NotConfiguredError } from "../connectors/registry";
import { POLICY_BY_KEY } from "./policies";
import { TOOLS } from "./registry";
import { istDayStart } from "../time";

export type GatewayResult =
  | { status: "ok"; output: unknown; executionId: string; replayed?: boolean }
  | { status: "approval_required"; approvalId: string; shortCode: string }
  | { status: "denied"; reason: string }
  | { status: "not_configured"; reason: string }
  | { status: "manual"; taskId: string; reason: string }
  | { status: "needs_verification"; reason: string }
  | { status: "failed"; error: string; executionId?: string };

export interface ToolCall {
  agentCode: string;
  toolKey: string;
  params: Record<string, unknown>;
  taskId?: string;
  runId?: string;
  approvalId?: string;
  idempotencyKey?: string;
  /** Used to create the approval request when one is needed. */
  approval?: Omit<ApprovalInput, "agentCode" | "toolKey" | "params" | "taskId" | "workflowRunId">;
}

async function deny(call: ToolCall, reason: string): Promise<GatewayResult> {
  await audit({ actor: `agent:${call.agentCode}`, action: "tool.denied", entityType: "tool", entityId: call.toolKey, data: { reason, taskId: call.taskId ?? null } });
  await db.execution.create({ data: { kind: "tool", toolKey: call.toolKey, agentCode: call.agentCode, taskId: call.taskId, workflowRunId: call.runId, status: "BLOCKED", input: canonicalJson(call.params), error: reason, endedAt: new Date() } });
  return { status: "denied", reason };
}

export async function executeTool(call: ToolCall): Promise<GatewayResult> {
  const def = TOOLS[call.toolKey];
  const policy = await db.toolPolicy.findUnique({ where: { toolKey: call.toolKey } });
  if (!def || !policy) return deny(call, `Unknown tool "${call.toolKey}"`);
  if (!policy.enabled) return deny(call, `Tool "${call.toolKey}" is disabled by policy`);
  const risk = policy.riskLevel;

  if (risk > 0 && (await isEmergencyStopped())) return deny(call, "Emergency stop is active — only read-only actions are allowed.");
  if (risk >= 2 && (await areProductionWritesPaused())) return deny(call, "Production-changing actions are paused by the founder.");

  const agent = await db.agent.findUnique({ where: { code: call.agentCode } });
  if (!agent) return deny(call, `Unknown agent ${call.agentCode}`);
  if (agent.status === "PAUSED" || agent.status === "RETIRED") return deny(call, `${agent.name} is ${agent.status.toLowerCase()}`);
  const allow = parseJson<string[]>(agent.tools, []);
  if (!allow.includes(call.toolKey)) return deny(call, `${agent.code} ${agent.name} is not permitted to use ${call.toolKey}`);

  const parsed = def.params.safeParse(call.params);
  if (!parsed.success) return deny(call, `Invalid parameters: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const params = parsed.data as Record<string, unknown>;

  // Level 2 — standing approval within caps
  if (risk === 2) {
    if (agent.status === "SHADOW") return deny(call, "Shadow-mode agents cannot run level-2 actions.");
    if (agent.maxAutonomousRisk < 2 || !policy.standingApproval) {
      return approvalNeeded(call, params);
    }
    const est = Number((call.approval?.estCostInr ?? 0));
    if (policy.capInr !== null && est > policy.capInr) return approvalNeeded(call, params);
    if (policy.dailyCapInr !== null) {
      const today = await db.execution.aggregate({ _sum: { costInr: true }, where: { toolKey: call.toolKey, status: "SUCCEEDED", startedAt: { gte: istDayStart() } } });
      if ((today._sum.costInr ?? 0) + est > policy.dailyCapInr) return approvalNeeded(call, params);
    }
  }

  // Level 3–4 — explicit founder (or specialist) approval for these exact parameters
  let approval: Awaited<ReturnType<typeof db.approvalRequest.findUnique>> = null;
  if (risk >= 3) {
    if (!call.approvalId) return approvalNeeded(call, params);
    approval = await db.approvalRequest.findUnique({ where: { id: call.approvalId } });
    if (!approval) return deny(call, "Approval not found");
    if (approval.toolKey !== call.toolKey || approval.agentCode !== call.agentCode) return deny(call, "Approval was granted for a different tool or agent");
    if (approval.paramsHash !== hashParams(params)) {
      await audit({ actor: `agent:${call.agentCode}`, action: "tool.param_mismatch", entityType: "approval", entityId: approval.id, data: { approved: approval.paramsHash, attempted: hashParams(params) } });
      return deny(call, "Parameters differ from what the founder approved — execution refused. Submit a new request.");
    }
    if (approval.status === "EXECUTED") return { status: "ok", output: parseJson(approval.decisionNote, null), executionId: "", replayed: true };
    if (approval.status !== "APPROVED") return deny(call, `Approval is ${approval.status.toLowerCase()}`);
    if (approval.expiresAt < new Date()) return deny(call, "Approval expired");
    if (agent.status === "SHADOW") return deny(call, `${agent.name} is in shadow mode: its proposals are recorded but cannot execute. Promote the agent to ACTIVE first.`);
  }

  // Manual tools: no safe API — hand the exact approved parameters to a human.
  if (def.manual) {
    const { createTask } = await import("../tasks/service");
    const { task } = await createTask({
      title: `Execute approved action: ${POLICY_BY_KEY[call.toolKey]?.title ?? call.toolKey}`,
      objective: `${def.manual}\n\nApproved parameters (do not change):\n${JSON.stringify(params, null, 2)}`,
      source: "workflow", trigger: `approval:${approval?.shortCode ?? "n/a"}`, priority: 2, riskLevel: risk,
      acceptanceCriteria: ["Action executed exactly as approved", "Evidence (screenshot/link) attached"],
      dedupeKey: `manual:${call.approvalId ?? sha256(call.toolKey + canonicalJson(params))}`, actor: "system:gateway",
    });
    if (approval) await db.approvalRequest.update({ where: { id: approval.id }, data: { status: "EXECUTED", executedAt: new Date(), decisionNote: j({ manualTaskId: task.id }) } });
    await audit({ actor: `agent:${call.agentCode}`, action: "tool.manual_handoff", entityType: "tool", entityId: call.toolKey, data: { taskId: task.id } });
    return { status: "manual", taskId: task.id, reason: def.manual };
  }

  // Idempotency for external side-effects
  const external = POLICY_BY_KEY[call.toolKey]?.external ?? false;
  const idemKey = call.approvalId ? `approval:${call.approvalId}` : call.idempotencyKey ?? `${call.toolKey}:${sha256(canonicalJson(params) + (call.taskId ?? "") + (call.runId ?? ""))}`;
  if (external) {
    const rec = await db.idempotencyRecord.findUnique({ where: { key: idemKey } });
    if (rec?.status === "DONE") return { status: "ok", output: parseJson(rec.result, null), executionId: "", replayed: true };
    if (rec?.status === "STARTED") {
      const { raiseAlert } = await import("../comms/alerts");
      await raiseAlert({ severity: "SEV2", title: `Interrupted external action needs verification: ${call.toolKey}`, detail: `An earlier attempt started but did not record completion. It was NOT retried automatically. Check the provider before re-running. Key: ${idemKey}`, source: "system:gateway", dedupeKey: `idem:${idemKey}` });
      return { status: "needs_verification", reason: "A previous attempt may have completed. Not retried — verify manually." };
    }
    await db.idempotencyRecord.upsert({ where: { key: idemKey }, create: { key: idemKey, scope: call.toolKey, status: "STARTED" }, update: { status: "STARTED" } });
  }

  const exec = await db.execution.create({ data: { kind: "tool", toolKey: call.toolKey, agentCode: call.agentCode, taskId: call.taskId, workflowRunId: call.runId, status: "RUNNING", input: canonicalJson(params) } });
  try {
    const output = await def.run!(params, { agentCode: call.agentCode, taskId: call.taskId, runId: call.runId, idempotencyKey: idemKey, actor: `agent:${call.agentCode}` });
    const outJson = j(output);
    await db.execution.update({ where: { id: exec.id }, data: { status: "SUCCEEDED", output: outJson.slice(0, 200_000), endedAt: new Date() } });
    if (external) await db.idempotencyRecord.update({ where: { key: idemKey }, data: { status: "DONE", result: outJson.slice(0, 50_000) } });
    if (approval) await db.approvalRequest.update({ where: { id: approval.id }, data: { status: "EXECUTED", executedAt: new Date() } });
    await audit({ actor: `agent:${call.agentCode}`, action: "tool.execute", entityType: "tool", entityId: call.toolKey, data: { risk, executionId: exec.id, approval: approval?.shortCode ?? null, taskId: call.taskId ?? null } });
    return { status: "ok", output, executionId: exec.id };
  } catch (e) {
    const msg = (e as Error).message;
    await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", error: msg, endedAt: new Date() } });
    // A definite failure response means nothing happened → safe to clear the idempotency lock.
    if (external) await db.idempotencyRecord.update({ where: { key: idemKey }, data: { status: "FAILED", result: j({ error: msg }) } });
    if (approval) await db.approvalRequest.update({ where: { id: approval.id }, data: { status: "EXECUTION_FAILED", decisionNote: msg.slice(0, 500) } });
    await audit({ actor: `agent:${call.agentCode}`, action: "tool.failed", entityType: "tool", entityId: call.toolKey, data: { error: msg.slice(0, 500) } });
    if (e instanceof NotConfiguredError) return { status: "not_configured", reason: msg };
    return { status: "failed", error: msg, executionId: exec.id };
  }
}

async function approvalNeeded(call: ToolCall, params: Record<string, unknown>): Promise<GatewayResult> {
  const a = call.approval;
  const req = await requestApproval({
    title: a?.title ?? `${POLICY_BY_KEY[call.toolKey]?.title ?? call.toolKey}`,
    reason: a?.reason ?? "Agent proposed this action.",
    ...a,
    agentCode: call.agentCode, toolKey: call.toolKey, params, taskId: call.taskId, workflowRunId: call.runId,
  });
  return { status: "approval_required", approvalId: req.id, shortCode: req.shortCode };
}
