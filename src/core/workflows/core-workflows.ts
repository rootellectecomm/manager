import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";
import { defineWorkflow, startWorkflow } from "./engine";
import { runAgentOnTask, managerReview, processProposedActions } from "../ai/agent-runner";
import { runDebate } from "../ai/debate";
import { callModel } from "../ai/router";
import { Plan } from "../ai/schemas";
import { createTask, transitionTask, findStalledTasks, type Evidence } from "../tasks/service";
import { expireStaleApprovals } from "../approvals";
import { wakeDecidedApprovals, resumeBudgetPaused } from "./engine";
import { escalateUnacknowledged } from "../comms/notify";
import { raiseAlert } from "../comms/alerts";
import { checkAllConnectors } from "../connectors/registry";
import { executeTool } from "../tools/gateway";
import { getSetting, SETTING_KEYS } from "../settings";
import { AGENTS } from "../org/catalog";

/**
 * Generic agent task: research/execute → manager review → actions through the gateway.
 * The task only reaches VERIFIED when evidence exists; COMPLETED follows verification.
 */
defineWorkflow("agent-task", async (ctx) => {
  const { taskId } = ctx.input as { taskId: string };
  const task = await ctx.step("load", async () => {
    const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    if (t.status === "ASSIGNED" || t.status === "NEEDS_REWORK") await transitionTask(taskId, "EXECUTING", "system:workflow", "agent started");
    return { status: t.status, riskLevel: t.riskLevel, owner: t.ownerAgentId };
  });
  if (!task.owner) throw new Error("Task has no owner");
  const output = await ctx.step("agent", () => runAgentOnTask(taskId, { workflowRunId: ctx.runId }));
  await ctx.step("to-review", () => transitionTask(taskId, "MANAGER_REVIEW", "system:workflow", "deliverable submitted", { evidence: output.evidenceRefs.map((r) => ({ kind: "tool", ref: r })) }).then(() => true));
  const review = await ctx.step("review", () => managerReview(taskId, output, { workflowRunId: ctx.runId }));
  if (review.verdict === "rework") {
    await ctx.step("rework", () => transitionTask(taskId, "NEEDS_REWORK", `agent:${review.reviewer}`, review.note).then(() => true));
    return { verdict: "rework", note: review.note };
  }
  if (output.needsDebate || review.verdict === "escalate") {
    await ctx.step("debate", async () => {
      const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      const run = await startWorkflow("debate", { question: `${t.title}: ${output.recommendation}`, context: output.summary, taskId }, { dedupeKey: `debate:${taskId}`, taskId });
      return run.id;
    });
  }
  const actions = await ctx.step("actions", async () => {
    const agent = await db.agent.findUniqueOrThrow({ where: { id: task.owner! } });
    const res = await processProposedActions(taskId, agent.code, output.proposedActions, ctx.runId);
    return res.map((r) => ({ tool: r.action.tool, status: r.result.status, ...(r.result.status === "approval_required" ? { approvalId: r.result.approvalId } : {}) }));
  });
  const pending = actions.filter((a) => a.status === "approval_required") as { tool: string; status: string; approvalId: string }[];
  const executed: Evidence[] = [];
  if (pending.length) {
    await ctx.step("awaiting", () => transitionTask(taskId, "AWAITING_APPROVAL", "system:workflow", `${pending.length} approval(s) requested`).then(() => true));
    for (const p of pending) {
      const decision = await ctx.waitForApproval(p.approvalId); // parks the run; silence is never approval
      if (decision !== "APPROVED") {
        await ctx.step(`declined-${p.approvalId}`, () => transitionTask(taskId, "NEEDS_REWORK", "system:workflow", `Approval ${decision.toLowerCase()} for ${p.tool}`).then(() => true));
        return { verdict: "approval_declined", decision };
      }
      const res = await ctx.step(`execute-${p.approvalId}`, async () => {
        const a = await db.approvalRequest.findUniqueOrThrow({ where: { id: p.approvalId } });
        return executeTool({ agentCode: a.agentCode, toolKey: a.toolKey, params: JSON.parse(a.params), taskId, runId: ctx.runId, approvalId: a.id });
      });
      if (res.status !== "ok" && res.status !== "manual") {
        await ctx.step(`exec-failed-${p.approvalId}`, () => transitionTask(taskId, "NEEDS_REWORK", "system:workflow", `Approved action failed: ${JSON.stringify(res).slice(0, 300)}`).then(() => true));
        return { verdict: "execution_failed", result: res };
      }
      executed.push({ kind: res.status === "manual" ? "manual-handoff" : "approved-action", ref: `${p.tool}:${p.approvalId}` });
    }
    await ctx.step("released", () => transitionTask(taskId, "RELEASED", "system:workflow", "approved actions executed", { evidence: executed }).then(() => true));
  }
  const evidence: Evidence[] = [
    ...output.evidenceRefs.map((r) => ({ kind: "tool", ref: r })),
    ...actions.filter((a) => a.status === "ok").map((a) => ({ kind: "action", ref: a.tool })),
    ...executed,
  ];
  if (!evidence.length) {
    // An answer without execution evidence is a draft: it stays in review for the Chief of Staff/founder.
    await ctx.step("draft-only", () => db.task.update({ where: { id: taskId }, data: { statusReason: "Accepted by manager as a draft — no execution evidence yet" } }).then(() => true));
    return { verdict: "accepted_draft_no_evidence" };
  }
  await ctx.step("verify", () => transitionTask(taskId, "VERIFIED", `agent:${review.reviewer}`, "manager accepted with evidence", { evidence }).then(() => true));
  await ctx.step("complete", () => transitionTask(taskId, "COMPLETED", "system:workflow", "accepted").then(() => true));
  return { verdict: "completed" };
}, { description: "Owner agent works the task; manager reviews; actions pass the approval gateway" });

/** Founder objective → Chief of Staff plan → department tasks (+ agent workflows for each). */
defineWorkflow("objective", async (ctx) => {
  const { objective, actor, autoStart = true } = ctx.input as { objective: string; actor: string; autoStart?: boolean };
  const plan = await ctx.step("plan", async () => {
    const roster = AGENTS.map((a) => `${a.code} ${a.name}`).join("\n");
    const res = await callModel({
      purpose: "plan", provider: "anthropic", fallback: "openai", tier: "deep", agentCode: "A01", schema: Plan,
      system: "You are the AI Chief of Staff of Rootellect. Turn the founder's objective into a small project plan of concrete, measurable tasks owned by the right agents. Prefer read-only investigation first; anything that changes production, spend, prices, publishing or outreach must be a separate task marked riskLevel 3. Return JSON {projectTitle, summary, tasks[{title, objective, ownerAgentCode, acceptanceCriteria[], riskLevel 0-4, priority 1-5, dependsOn: [indexes]}], approvalsLikely[]}.",
      prompt: `FOUNDER OBJECTIVE: ${objective}\n\nAGENT ROSTER:\n${roster}`, simulationContext: { objective },
    });
    return { ...res.data, simulated: res.simulated };
  });
  const created = await ctx.step("create", async () => {
    const project = await db.project.create({ data: { title: plan.projectTitle, objective, createdBy: actor } });
    const ids: string[] = [];
    for (const [i, t] of plan.tasks.entries()) {
      const owner = AGENTS.some((a) => a.code === t.ownerAgentCode) ? t.ownerAgentCode : "A02";
      const { task } = await createTask({
        title: t.title, objective: t.objective, source: "founder", trigger: `objective:${project.id}`, projectId: project.id, ownerAgentCode: owner,
        acceptanceCriteria: t.acceptanceCriteria, riskLevel: t.riskLevel, priority: t.priority,
        dependsOn: t.dependsOn.filter((d) => d < i).map((d) => ids[d]), actor: "agent:A01",
      });
      ids.push(task.id);
    }
    await audit({ actor: "agent:A01", action: "project.plan", entityType: "project", entityId: project.id, data: { tasks: ids.length, simulated: plan.simulated } });
    return { projectId: project.id, taskIds: ids };
  });
  if (autoStart) {
    await ctx.step("start", async () => {
      for (const id of created.taskIds) {
        const deps = await db.taskDependency.count({ where: { taskId: id } });
        if (!deps) await startWorkflow("agent-task", { taskId: id }, { dedupeKey: `agent-task:${id}`, taskId: id });
      }
      return true;
    });
  }
  return created;
}, { description: "Founder objective → Chief of Staff plan → assigned department tasks" });

defineWorkflow("debate", async (ctx) => runDebate(ctx, ctx.input as { question: string; context?: string; taskId?: string }), { maxAttempts: 3, description: "Five-round, three-provider deliberation" });

defineWorkflow("connector-health", async (ctx) => ctx.step("check", () => checkAllConnectors("system:health")), { description: "Check every integration; broken ones trigger repair" });

/** 15-minute storefront heartbeat. Homepage down on two consecutive runs → SEV1. */
defineWorkflow("storefront-check", async (ctx) => {
  const r = await ctx.step("check", async () => {
    const out = await executeTool({ agentCode: "C03", toolKey: "qa.synthetic_check", params: { suite: "single", url: await getSetting(SETTING_KEYS.storefrontUrl, "https://rootellect.com") } });
    return out.status === "ok" ? (out.output as { status: string; detail: string }[]) : [{ status: "FAIL", detail: JSON.stringify(out) }];
  });
  const down = r.some((x) => x.status === "FAIL");
  await ctx.step("evaluate", async () => {
    const prev = await db.testResult.findMany({ where: { suite: "single", check: "Page responds" }, orderBy: { createdAt: "desc" }, take: 2 });
    await db.testResult.create({ data: { runId: ctx.runId, suite: "single", check: "Page responds", target: "storefront", status: down ? "FAIL" : "PASS", detail: r.map((x) => x.detail).join("; ").slice(0, 1000) } });
    if (down && prev[0]?.status === "FAIL") {
      await raiseAlert({ severity: "SEV1", title: "Storefront is not responding", detail: `Two consecutive failed checks. Latest: ${r.map((x) => x.detail).join("; ")}`, source: "workflow:storefront-check", dedupeKey: `storefront-down:${new Date().toISOString().slice(0, 13)}` });
    }
    return true;
  });
  return { down };
}, { description: "Production-safe storefront heartbeat" });

defineWorkflow("housekeeping", async (ctx) => {
  return ctx.step("sweep", async () => {
    const expired = await expireStaleApprovals();
    const woken = await wakeDecidedApprovals();
    const resumed = await resumeBudgetPaused();
    const escalated = await escalateUnacknowledged();
    const stalled = await findStalledTasks(48);
    if (stalled.length) {
      await createTask({
        title: `Stalled work digest (${stalled.length})`, objective: stalled.map((t) => `- ${t.title} [${t.status}] owner ${t.owner?.code ?? "—"}${t.dueAt && t.dueAt < new Date() ? " · OVERDUE" : ""}`).join("\n"),
        source: "workflow", trigger: "housekeeping", ownerAgentCode: "A02", priority: 2, dedupeKey: `stalled:${new Date().toISOString().slice(0, 10)}`, actor: "system:housekeeping",
        acceptanceCriteria: ["Each stalled task re-assigned, unblocked or closed with a reason"],
      });
    }
    return { expired, woken, resumed, escalated, stalled: stalled.length };
  });
}, { description: "Expire approvals, wake decided runs, escalate, detect stalled work" });

export async function tasksEvidence(taskId: string) {
  const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  return parseJson<Evidence[]>(t.evidence, []);
}

export const _j = j;
