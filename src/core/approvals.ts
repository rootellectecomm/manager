import { db } from "./db/client";
import { j } from "./db/json";
import { audit } from "./audit";
import { canonicalJson, hashParams, shortCode, signToken } from "./crypto";
import { env } from "./env";
import { POLICY_BY_KEY } from "./tools/policies";

export type ApprovalDecision = "APPROVE" | "REJECT" | "REQUEST_CHANGES" | "DEFER" | "DELEGATE";

export interface ApprovalInput {
  title: string;
  agentCode: string;
  toolKey: string;
  params: Record<string, unknown>;
  reason: string;
  evidence?: { kind: string; ref: string; note?: string }[];
  expectedImpact?: string;
  estCostInr?: number;
  riskAssessment?: string;
  rollbackPlan?: string;
  recommendation?: string;
  urgency?: "low" | "normal" | "high" | "critical";
  taskId?: string;
  workflowRunId?: string;
  ttlHours?: number;
}

/** Creates an approval request carrying the exact parameters to execute (hashed). Re-requests for identical params are deduplicated. */
export async function requestApproval(a: ApprovalInput) {
  const policy = await db.toolPolicy.findUnique({ where: { toolKey: a.toolKey } });
  const risk = policy?.riskLevel ?? POLICY_BY_KEY[a.toolKey]?.risk ?? 4;
  const paramsHash = hashParams(a.params);
  const dup = await db.approvalRequest.findFirst({ where: { toolKey: a.toolKey, paramsHash, agentCode: a.agentCode, status: { in: ["PENDING", "DEFERRED"] } } });
  if (dup) return dup;
  const agent = await db.agent.findUnique({ where: { code: a.agentCode }, include: { department: true } });
  const shadow = agent?.status === "SHADOW";
  const ttl = a.ttlHours ?? (a.urgency === "critical" ? 6 : a.urgency === "high" ? 24 : 72);
  let code = shortCode("AP");
  while (await db.approvalRequest.findUnique({ where: { shortCode: code } })) code = shortCode("AP");
  const req = await db.approvalRequest.create({
    data: {
      shortCode: code,
      title: shadow ? `[Shadow proposal] ${a.title}` : a.title,
      agentCode: a.agentCode, department: agent?.department.name ?? "", taskId: a.taskId, workflowRunId: a.workflowRunId,
      toolKey: a.toolKey, params: canonicalJson(a.params), paramsHash, riskLevel: risk,
      reason: a.reason, evidence: j(a.evidence ?? []), expectedImpact: a.expectedImpact ?? "", estCostInr: a.estCostInr ?? 0,
      riskAssessment: a.riskAssessment ?? "", rollbackPlan: a.rollbackPlan ?? "", recommendation: a.recommendation ?? "",
      urgency: a.urgency ?? "normal", expiresAt: new Date(Date.now() + ttl * 3600_000),
    },
  });
  await db.approvalEvent.create({ data: { approvalId: req.id, event: "REQUESTED", actor: `agent:${a.agentCode}`, channel: "system", note: a.reason } });
  await audit({ actor: `agent:${a.agentCode}`, action: "approval.request", entityType: "approval", entityId: req.id, data: { tool: a.toolKey, risk, paramsHash } });
  const { notifyFounder } = await import("./comms/notify");
  const link = approvalLink(req.id);
  await notifyFounder({
    severity: "APPROVAL", approvalId: req.id, dedupeKey: `approval:${req.id}`,
    subject: `Approval needed (${code}): ${req.title}`,
    body: `${req.title}\nAgent: ${a.agentCode} · Risk level ${risk}\nReason: ${a.reason}\nEstimated cost: ₹${(a.estCostInr ?? 0).toFixed(0)}\nRollback: ${a.rollbackPlan || "—"}\n\nReview: ${link}\nExpires: ${req.expiresAt.toISOString()}`,
  });
  return req;
}

export function approvalLink(id: string): string {
  try {
    return `${env.appUrl}/approvals/${id}?t=${signToken({ approvalId: id }, 72 * 3600)}`;
  } catch {
    return `${env.appUrl}/approvals/${id}`;
  }
}

export class ApprovalError extends Error {}

/**
 * Records a decision. Only an authenticated human founder can decide — no agent identity
 * can approve anything. Level-4 approvals additionally require a named qualified reviewer.
 */
export async function decideApproval(id: string, decision: ApprovalDecision, actor: string, channel: "dashboard" | "whatsapp" | "email", opts: { note?: string; reviewer?: string; delegateTo?: string } = {}) {
  if (!actor.startsWith("founder:")) {
    await audit({ actor, action: "approval.decide.denied", entityType: "approval", entityId: id, data: { decision } });
    throw new ApprovalError("Only the founder can decide approvals.");
  }
  const req = await db.approvalRequest.findUniqueOrThrow({ where: { id } });
  if (!["PENDING", "DEFERRED", "DELEGATED"].includes(req.status)) throw new ApprovalError(`Request is already ${req.status.toLowerCase()}.`);
  if (req.expiresAt < new Date()) {
    await db.approvalRequest.update({ where: { id }, data: { status: "EXPIRED" } });
    throw new ApprovalError("This request has expired. The agent must re-submit with current evidence.");
  }
  if (decision === "APPROVE" && req.riskLevel >= 4 && !opts.reviewer?.trim()) {
    throw new ApprovalError("Level 4 actions need the name and role of the qualified reviewer who signed off.");
  }
  if (decision === "APPROVE" && req.riskLevel >= 3 && channel === "whatsapp") {
    throw new ApprovalError("Level 3+ actions must be approved in the authenticated dashboard. Open the link to approve.");
  }
  const status = { APPROVE: "APPROVED", REJECT: "REJECTED", REQUEST_CHANGES: "CHANGES_REQUESTED", DEFER: "DEFERRED", DELEGATE: "DELEGATED" }[decision];
  const note = [opts.note, opts.reviewer ? `Reviewer: ${opts.reviewer}` : "", opts.delegateTo ? `Delegated to: ${opts.delegateTo}` : ""].filter(Boolean).join(" · ");
  const updated = await db.approvalRequest.update({ where: { id }, data: { status, decidedAt: new Date(), decidedBy: actor, decisionNote: note || null } });
  await db.approvalEvent.create({ data: { approvalId: id, event: status, actor, channel, note } });
  await audit({ actor, action: `approval.${status.toLowerCase()}`, entityType: "approval", entityId: id, data: { channel, paramsHash: req.paramsHash, note } });
  // Wake any workflow waiting on this approval.
  if (req.workflowRunId) await db.workflowRun.updateMany({ where: { id: req.workflowRunId, status: "WAITING" }, data: { status: "PENDING", nextRunAt: new Date() } });
  return updated;
}

export async function expireStaleApprovals() {
  const r = await db.approvalRequest.updateMany({ where: { status: { in: ["PENDING", "DEFERRED"] }, expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
  return r.count;
}
