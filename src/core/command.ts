/**
 * Universal command bar ("Ask Rootellect OS anything") and WhatsApp command handler.
 * Deterministic intents are matched first (fast, exact, no model cost). Anything else
 * is interpreted by the Chief of Staff model as a question or an objective.
 */
import { db } from "./db/client";
import { audit } from "./audit";
import { setSetting, SETTING_KEYS } from "./settings";
import { startWorkflow } from "./workflows";
import { decideApproval } from "./approvals";
import { callModel, availableProviders } from "./ai/router";
import { CommandIntent } from "./ai/schemas";
import { searchKnowledge, formatForPrompt } from "./knowledge/service";
import { formatInr, formatIst, istDayStart } from "./time";
import { z } from "zod";
import { env } from "./env";

export interface CommandResult { kind: string; message: string; link?: string; runId?: string }

const Answer = z.object({ answer: z.string(), sources: z.array(z.string()).default([]), confidence: z.enum(["high", "medium", "low"]).default("medium") });

export async function runCommand(text: string, actor: string, channel: "dashboard" | "whatsapp" = "dashboard"): Promise<CommandResult> {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (!actor.startsWith("founder:")) return { kind: "denied", message: "Only the founder can issue commands." };
  await audit({ actor, action: "command", entityType: "command", data: { text: t.slice(0, 500), channel } });

  const decide = lower.match(/^(approve|reject|defer)\s+(ap-[a-z0-9]{5})\b(.*)$/i);
  if (decide) {
    const a = await db.approvalRequest.findUnique({ where: { shortCode: decide[2].toUpperCase() } });
    if (!a) return { kind: "error", message: `No approval ${decide[2].toUpperCase()}.` };
    try {
      await decideApproval(a.id, decide[1].toUpperCase() as "APPROVE" | "REJECT" | "DEFER", actor, channel, { note: decide[3].trim() });
      return { kind: "approval", message: `${a.shortCode} ${decide[1].toLowerCase()}d.` };
    } catch (e) {
      return { kind: "approval", message: (e as Error).message, link: `${env.appUrl}/approvals/${a.id}` };
    }
  }
  if (/emergency stop|stop everything|kill switch/.test(lower)) {
    await setSetting(SETTING_KEYS.emergencyStop, "true", actor);
    return { kind: "emergency_stop", message: "Emergency stop is ON. Workflows halted; only read-only actions allowed. Turn off in Settings." };
  }
  if (/(pause|stop|halt).*(production|changing|write)/.test(lower)) {
    await setSetting(SETTING_KEYS.productionWritesPaused, "true", actor);
    return { kind: "pause_production", message: "All production-changing actions (risk ≥ 2) are paused. Read-only monitoring and drafts continue." };
  }
  if (/(resume|unpause|restart).*(production|changing|write)/.test(lower)) {
    await setSetting(SETTING_KEYS.productionWritesPaused, "false", actor);
    return { kind: "resume_production", message: "Production-changing actions resumed (still subject to approvals)." };
  }
  if (/(pending|waiting|my).*(approval|decision)|review all decisions|show.*approvals/.test(lower)) {
    const p = await db.approvalRequest.findMany({ where: { status: { in: ["PENDING", "DEFERRED"] } }, orderBy: { createdAt: "asc" } });
    return { kind: "show_approvals", message: p.length ? p.map((a) => `${a.shortCode} · ${a.title} (risk ${a.riskLevel})`).join("\n") : "Nothing is waiting for your approval.", link: `${env.appUrl}/approvals` };
  }
  if (/(website|site|storefront).*audit|audit.*(website|site)/.test(lower)) {
    const run = await startWorkflow("website-audit", { requestedBy: actor }, { actor });
    return { kind: "audit", message: "Website audit started: QA is testing the storefront; failures become defect tasks for Engineering. Production fixes will wait for your approval.", runId: run.id, link: `${env.appUrl}/tasks` };
  }
  if (/(check|test).*(integration|connector)/.test(lower)) {
    const run = await startWorkflow("connector-health", {}, { actor });
    return { kind: "integrations_check", message: "Checking every integration now. Broken ones open repair tasks.", runId: run.id, link: `${env.appUrl}/integrations` };
  }
  if (/(brief|business report|month.*report|daily summary)/.test(lower)) {
    const run = await startWorkflow("executive-brief", {}, { actor });
    return { kind: "report", message: "Generating the executive brief from current records.", runId: run.id, link: `${env.appUrl}/reports` };
  }
  if (/today'?s sales|sales today|revenue today/.test(lower)) {
    const m = await db.businessMetric.findFirst({ where: { key: "revenue_web_captured_inr", capturedAt: { gte: istDayStart() } }, orderBy: { capturedAt: "desc" } });
    const n = await db.businessMetric.findFirst({ where: { key: "orders_web_captured", capturedAt: { gte: istDayStart() } }, orderBy: { capturedAt: "desc" } });
    return { kind: "question", message: m ? `Website captured payments today: ${formatInr(m.value)} across ${n?.value ?? "?"} orders (Razorpay, as of ${formatIst(m.capturedAt)}). Amazon sales aren't included unless the SP-API connector is active.` : "No verified sales data for today yet — connect Razorpay (and Amazon SP-API) in Integrations." };
  }
  if (/(which|who).*(employees|agents).*(complete|finish)/.test(lower)) {
    const since = istDayStart();
    const done = await db.task.findMany({ where: { completedAt: { gte: since } }, include: { owner: true } });
    const by = new Map<string, number>();
    for (const d of done) by.set(d.owner ? `${d.owner.code} ${d.owner.name}` : "Unassigned", (by.get(d.owner ? `${d.owner.code} ${d.owner.name}` : "Unassigned") ?? 0) + 1);
    return { kind: "question", message: done.length ? [...by.entries()].map(([k, v]) => `${k}: ${v}`).join("\n") : "No tasks completed today yet." };
  }

  // Natural language → Chief of Staff
  const providers = await availableProviders();
  if (!providers.length && !env.allowSimulatedProvider) {
    return { kind: "unknown", message: "I can run built-in commands (audit, approvals, sales today, pause production, brief). For anything else, connect an AI provider in Settings → AI Providers." };
  }
  const intent = await callModel({
    purpose: "command_intent", provider: "anthropic", fallback: "openai", tier: "fast", agentCode: "A01", schema: CommandIntent,
    system: "You are the AI Chief of Staff of Rootellect. Classify the founder's message. kind=question if they want information; kind=objective if they want work done (put a clear objective). Return JSON {kind, objective, department, requiresApprovalBeforeProduction, answer:''}.",
    prompt: t, simulationContext: { text: t },
  });
  if (intent.data.kind === "objective") {
    const run = await startWorkflow("objective", { objective: intent.data.objective || t, actor }, { actor });
    return { kind: "objective", message: `On it. The Chief of Staff is planning "${intent.data.objective || t}" and assigning departments. Anything touching production, spend or publishing will come to you for approval.`, runId: run.id, link: `${env.appUrl}/tasks` };
  }
  if (intent.data.kind === "question") {
    const k = await searchKnowledge(t, { limit: 6 });
    const metrics = await db.businessMetric.findMany({ orderBy: { capturedAt: "desc" }, take: 30 });
    const openTasks = await db.task.findMany({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { title: true, status: true }, take: 30 });
    const a = await callModel({
      purpose: "answer", provider: "anthropic", fallback: "openai", tier: "balanced", agentCode: "A01", schema: Answer,
      system: "Answer the founder's question using ONLY the records provided. If the records don't contain the answer, say what's missing and which connector or task would get it. Never invent numbers. Return JSON {answer, sources[], confidence}.",
      prompt: `QUESTION: ${t}\n\nKNOWLEDGE:\n${formatForPrompt(k)}\n\nMETRICS (verified=false are estimates):\n${JSON.stringify(metrics.map((m) => ({ key: m.key, value: m.value, unit: m.unit, source: m.source, verified: m.verified, at: m.capturedAt })))}\n\nOPEN TASKS:\n${JSON.stringify(openTasks)}`,
      simulationContext: {},
    }).catch(() => null);
    return { kind: "question", message: a ? (a.data as z.infer<typeof Answer>).answer ?? "" : "I couldn't answer that from current records." };
  }
  return { kind: "unknown", message: intent.data.answer || "I didn't understand. Try: 'Start a website audit', 'Show pending approvals', 'Pause all production-changing actions', or describe an objective." };
}
