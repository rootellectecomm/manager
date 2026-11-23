"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/core/db/client";
import { j } from "@/core/db/json";
import { audit, verifyAuditChain } from "@/core/audit";
import { login, logout, SESSION_TTL_HOURS, beginMfaSetup, confirmMfa, disableMfa } from "@/core/auth";
import { otpauthUri } from "@/core/totp";
import { encryptSecret, hint } from "@/core/crypto";
import { runCommand, type CommandResult } from "@/core/command";
import { decideApproval, type ApprovalDecision } from "@/core/approvals";
import { founderOverride, createTask } from "@/core/tasks/service";
import { updateAgent, duplicateAgent } from "@/core/org/registry";
import { saveConfig, checkConnector, disconnect } from "@/core/connectors/registry";
import { setSetting, SETTING_KEYS } from "@/core/settings";
import { ackAlert, resolveAlert, addIncidentNote } from "@/core/comms/alerts";
import { addVerifiedKnowledge, verifyKnowledge, correctKnowledge } from "@/core/knowledge/service";
import { updateSchedule } from "@/core/workflows/schedules";
import { startWorkflow, cancelWorkflow } from "@/core/workflows";
import { ADAPTERS, suggestTiers, type ProviderId } from "@/core/ai/providers";
import { POLICY_BY_KEY } from "@/core/tools/policies";
import { requireFounder, SESSION_COOKIE } from "./lib/session";

export type FormState = { ok?: boolean; error?: string; message?: string } | null;
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const fail = (e: unknown): FormState => ({ error: (e as Error).message ?? String(e) });

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const ua = (await headers()).get("user-agent") ?? undefined;
  const r = await login(s(fd, "email"), String(fd.get("password") ?? ""), ua, s(fd, "totp") || undefined);
  if ("error" in r) return { error: r.error, message: r.needsTotp ? "totp" : undefined };
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_HOURS * 3600 });
  redirect(s(fd, "next") || "/");
}

export async function logoutAction() {
  const c = await cookies();
  const t = c.get(SESSION_COOKIE)?.value;
  if (t) await logout(t);
  c.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function commandAction(_: CommandResult | null, fd: FormData): Promise<CommandResult | null> {
  const { actor } = await requireFounder();
  const text = s(fd, "q");
  if (!text) return null;
  try {
    const r = await runCommand(text, actor);
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

export async function decideApprovalAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  try {
    await decideApproval(s(fd, "id"), s(fd, "decision") as ApprovalDecision, actor, "dashboard", { note: s(fd, "note"), reviewer: s(fd, "reviewer"), delegateTo: s(fd, "delegateTo") });
    revalidatePath("/approvals");
    revalidatePath("/");
    return { ok: true, message: `Recorded: ${s(fd, "decision").toLowerCase().replace("_", " ")}` };
  } catch (e) { return fail(e); }
}

export async function taskOverrideAction(fd: FormData) {
  const { actor } = await requireFounder();
  await founderOverride(s(fd, "id"), s(fd, "action") as "pause" | "cancel" | "resume", actor, s(fd, "note"));
  revalidatePath(`/tasks/${s(fd, "id")}`);
  revalidatePath("/tasks");
}

export async function runTaskAction(fd: FormData) {
  await requireFounder();
  const id = s(fd, "id");
  await startWorkflow("agent-task", { taskId: id }, { dedupeKey: `agent-task:${id}:${Date.now()}`, taskId: id });
  revalidatePath(`/tasks/${id}`);
}

export async function newObjectiveAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const objective = s(fd, "objective");
  if (objective.length < 8) return { error: "Describe the objective in a sentence or two." };
  const run = await startWorkflow("objective", { objective, actor, autoStart: fd.get("autoStart") === "on" }, { actor });
  revalidatePath("/tasks");
  return { ok: true, message: `Chief of Staff is planning it (run ${run.id.slice(-6)}). Tasks appear here as they're created.` };
}

export async function newTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  try {
    const { task } = await createTask({
      title: s(fd, "title"), objective: s(fd, "objective"), source: "founder", ownerAgentCode: s(fd, "owner") || undefined,
      priority: Number(s(fd, "priority") || 3), acceptanceCriteria: s(fd, "criteria").split("\n").map((x) => x.trim()).filter(Boolean), actor,
      dueAt: s(fd, "due") ? new Date(s(fd, "due")) : undefined,
    });
    if (fd.get("start") === "on" && task.ownerAgentId) await startWorkflow("agent-task", { taskId: task.id }, { dedupeKey: `agent-task:${task.id}`, taskId: task.id });
    revalidatePath("/tasks");
    return { ok: true, message: "Task created." };
  } catch (e) { return fail(e); }
}

export async function startWorkflowAction(fd: FormData) {
  const { actor } = await requireFounder();
  const type = s(fd, "type");
  const allowed = ["website-audit", "connector-health", "reconciliation", "ga4-audit", "daily-marketing", "executive-brief", "marketplace-audit", "seo-control", "weekly-review", "storefront-check"];
  if (!allowed.includes(type)) throw new Error("Unknown workflow");
  await startWorkflow(type, type === "website-audit" ? { requestedBy: actor } : {}, { actor });
  revalidatePath("/", "layout");
}

export async function cancelRunAction(fd: FormData) {
  const { actor } = await requireFounder();
  await cancelWorkflow(s(fd, "id"), actor);
  revalidatePath("/tasks");
}

export async function updateAgentAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const lines = (k: string) => s(fd, k).split("\n").map((x) => x.trim()).filter(Boolean);
  try {
    await updateAgent(s(fd, "code"), {
      description: s(fd, "description"), instructions: s(fd, "instructions"),
      responsibilities: lines("responsibilities"), kpis: lines("kpis"), tools: fd.getAll("tools").map(String),
      providerPrimary: s(fd, "providerPrimary"), providerFallback: s(fd, "providerFallback"), modelTier: s(fd, "modelTier"),
      status: s(fd, "status"), maxAutonomousRisk: Number(s(fd, "maxAutonomousRisk")), monthlyBudgetInr: Number(s(fd, "monthlyBudgetInr")), dailyTokenBudget: Number(s(fd, "dailyTokenBudget")),
    }, actor, s(fd, "changeNote") || "Edited in dashboard");
    revalidatePath(`/organization/${s(fd, "code")}`);
    return { ok: true, message: "Saved as a new version." };
  } catch (e) { return fail(e); }
}

export async function agentStatusAction(fd: FormData) {
  const { actor } = await requireFounder();
  await updateAgent(s(fd, "code"), { status: s(fd, "status") }, actor, `Status → ${s(fd, "status")}`);
  revalidatePath("/organization");
  revalidatePath(`/organization/${s(fd, "code")}`);
}

export async function duplicateAgentAction(fd: FormData) {
  const { actor } = await requireFounder();
  const copy = await duplicateAgent(s(fd, "code"), s(fd, "name") || "New agent", actor);
  redirect(`/organization/${copy.code}`);
}

export async function saveProviderAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const provider = z.enum(["openai", "anthropic", "gemini"]).parse(s(fd, "provider")) as ProviderId;
  const row = await db.modelProvider.findUniqueOrThrow({ where: { provider } });
  const key = s(fd, "apiKey");
  try {
    const data: Record<string, unknown> = { rateLimitPerMin: Number(s(fd, "rateLimitPerMin") || 30), inrPerUsd: Number(s(fd, "inrPerUsd") || 84), enabled: fd.get("enabled") === "on" };
    if (key) { data.encryptedKey = encryptSecret(key); data.keyHint = hint(key); }
    const tiers = { fast: s(fd, "fast"), balanced: s(fd, "balanced"), deep: s(fd, "deep") };
    const prices = s(fd, "priceTable");
    if (prices) { try { JSON.parse(prices); data.priceTable = prices; } catch { return { error: "Price table must be JSON like {\"model-id\": {\"inPerMTok\": 3, \"outPerMTok\": 15}}" }; } }
    const effectiveKey = key || (row.encryptedKey ? (await import("@/core/crypto")).decryptSecret(row.encryptedKey) : "");
    if (effectiveKey) {
      try {
        const models = await ADAPTERS[provider].models(effectiveKey);
        const suggested = suggestTiers(provider, models);
        data.models = j(models);
        data.tierModels = j({ fast: tiers.fast || suggested.fast || "", balanced: tiers.balanced || suggested.balanced || "", deep: tiers.deep || suggested.deep || "" });
        data.status = "CONNECTED"; data.lastError = null; data.lastTestedAt = new Date();
      } catch (e) {
        data.status = "ERROR"; data.lastError = (e as Error).message; data.lastTestedAt = new Date();
      }
    }
    await db.modelProvider.update({ where: { provider }, data });
    await audit({ actor, action: "provider.configure", entityType: "provider", entityId: provider, data: { keyChanged: Boolean(key), enabled: data.enabled } });
    revalidatePath("/settings");
    const fresh = await db.modelProvider.findUniqueOrThrow({ where: { provider } });
    return fresh.status === "CONNECTED" ? { ok: true, message: `${provider} connected · ${JSON.parse(fresh.models).length} models discovered` } : { error: fresh.lastError ?? "Not connected" };
  } catch (e) { return fail(e); }
}

export async function saveConnectorAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const key = s(fd, "key");
  const cfg: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("f_")) cfg[k.slice(2)] = String(v);
  try {
    const r = await saveConfig(key, cfg, actor);
    revalidatePath("/integrations");
    return r.status === "CONNECTED" ? { ok: true, message: `Connected — ${r.detail}` } : { error: `${r.status.replace("_", " ")}: ${r.detail}` };
  } catch (e) { return fail(e); }
}

export async function checkConnectorAction(fd: FormData) {
  const { actor } = await requireFounder();
  await checkConnector(s(fd, "key"), actor);
  revalidatePath("/integrations");
}

export async function disconnectConnectorAction(fd: FormData) {
  const { actor } = await requireFounder();
  await disconnect(s(fd, "key"), actor);
  revalidatePath("/integrations");
}

export async function settingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const editable = [SETTING_KEYS.founderEmail, SETTING_KEYS.founderWhatsapp, SETTING_KEYS.founderPhone, SETTING_KEYS.quietHours, SETTING_KEYS.storefrontUrl, SETTING_KEYS.stagingUrl, SETTING_KEYS.debateRiskThreshold, "product_paths", "post_release_verify_minutes"];
  for (const k of editable) if (fd.has(k)) await setSetting(k, s(fd, k), actor);
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

export async function safetySwitchAction(fd: FormData) {
  const { actor } = await requireFounder();
  const key = s(fd, "key");
  if (![SETTING_KEYS.emergencyStop, SETTING_KEYS.productionWritesPaused].includes(key as never)) throw new Error("Unknown switch");
  await setSetting(key, s(fd, "value") === "true" ? "true" : "false", actor);
  revalidatePath("/", "layout");
}

export async function budgetAction(fd: FormData) {
  const { actor } = await requireFounder();
  const limit = Number(s(fd, "limitInr"));
  if (!(limit >= 0)) throw new Error("Invalid limit");
  const b = await db.budget.update({ where: { id: s(fd, "id") }, data: { limitInr: limit } });
  await audit({ actor, action: "budget.update", entityType: "budget", entityId: b.id, data: { scope: b.scope, period: b.period, limitInr: limit } });
  revalidatePath("/costs");
}

export async function toolPolicyAction(fd: FormData) {
  const { actor } = await requireFounder();
  const key = s(fd, "toolKey");
  const def = POLICY_BY_KEY[key];
  const risk = Number(s(fd, "riskLevel"));
  if (def?.risk === 4 && risk < 4) throw new Error("Level-4 actions cannot be downgraded.");
  const cap = s(fd, "capInr"), daily = s(fd, "dailyCapInr");
  await db.toolPolicy.update({ where: { toolKey: key }, data: { riskLevel: risk, enabled: fd.get("enabled") === "on", standingApproval: fd.get("standingApproval") === "on" && risk === 2, capInr: cap ? Number(cap) : null, dailyCapInr: daily ? Number(daily) : null, updatedBy: actor } });
  await audit({ actor, action: "policy.update", entityType: "tool_policy", entityId: key, data: { risk, enabled: fd.get("enabled") === "on", standing: fd.get("standingApproval") === "on", cap, daily } });
  revalidatePath("/settings");
}

export async function scheduleAction(fd: FormData) {
  const { actor } = await requireFounder();
  await updateSchedule(s(fd, "name"), { cron: s(fd, "cron") || undefined, enabled: fd.get("enabled") === "on" }, actor);
  revalidatePath("/settings");
}

export async function alertAction(fd: FormData) {
  const { actor } = await requireFounder();
  if (s(fd, "action") === "ack") await ackAlert(s(fd, "id"), actor);
  else await resolveAlert(s(fd, "id"), actor);
  revalidatePath("/", "layout");
}

export async function incidentNoteAction(fd: FormData) {
  const { actor } = await requireFounder();
  await addIncidentNote(s(fd, "id"), actor, s(fd, "note") || "(status change)", { status: s(fd, "status") || undefined, rootCause: s(fd, "rootCause") || undefined });
  revalidatePath("/incidents");
}

export async function knowledgeAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  try {
    const op = s(fd, "op");
    if (op === "add") await addVerifiedKnowledge({ title: s(fd, "title"), body: s(fd, "body"), category: s(fd, "category") || "company", source: "founder", provenance: s(fd, "provenance") || "Entered by founder", expiresAt: s(fd, "expiresAt") ? new Date(s(fd, "expiresAt")) : undefined }, actor);
    if (op === "verify") await verifyKnowledge(s(fd, "id"), actor);
    if (op === "correct") await correctKnowledge(s(fd, "id"), s(fd, "body"), actor);
    revalidatePath("/knowledge");
    return { ok: true, message: "Saved." };
  } catch (e) { return fail(e); }
}

export async function productCostAction(fd: FormData) {
  const { actor } = await requireFounder();
  const n = (k: string) => (s(fd, k) === "" ? null : Number(s(fd, k)));
  await db.productCost.update({ where: { sku: s(fd, "sku") }, data: { unitCostInr: n("unitCostInr"), packagingInr: n("packagingInr") } });
  await audit({ actor, action: "product_cost.update", entityType: "product", entityId: s(fd, "sku") });
  revalidatePath("/business");
}

export async function calendarAction(fd: FormData) {
  const { actor } = await requireFounder();
  const e = await db.calendarEvent.create({ data: { title: s(fd, "title"), startsAt: new Date(s(fd, "startsAt")), kind: s(fd, "kind") || "deadline", notes: s(fd, "notes") } });
  await audit({ actor, action: "calendar.create", entityType: "calendar", entityId: e.id });
  revalidatePath("/comms");
}

export async function verifyAuditAction(): Promise<FormState> {
  await requireFounder();
  const r = await verifyAuditChain();
  return r.ok ? { ok: true, message: `Audit chain intact · ${r.checked} events verified` } : { error: `Audit chain broken at event #${r.brokenAt}` };
}

export async function mfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user } = await requireFounder();
  try {
    const op = s(fd, "op");
    if (op === "begin") { const secret = await beginMfaSetup(user.id); return { ok: true, message: `secret:${secret}|${otpauthUri(secret, user.email)}` }; }
    if (op === "confirm") { await confirmMfa(user.id, s(fd, "code")); revalidatePath("/settings"); return { ok: true, message: "Two-factor sign-in is on." }; }
    if (op === "disable") { await disableMfa(user.id, s(fd, "code")); revalidatePath("/settings"); return { ok: true, message: "Two-factor sign-in is off." }; }
    return { error: "Unknown operation" };
  } catch (e) { return fail(e); }
}

/** From the office: give an agent a task and start it immediately (it walks to its desk). */
export async function officeAssignAction(_: FormState, fd: FormData): Promise<FormState> {
  const { actor } = await requireFounder();
  const title = s(fd, "title");
  if (title.length < 4) return { error: "Give the task a short title." };
  try {
    const { task } = await createTask({ title, objective: s(fd, "objective") || title, source: "founder", ownerAgentCode: s(fd, "code"), priority: 2, acceptanceCriteria: ["Deliverable submitted with evidence"], actor });
    await startWorkflow("agent-task", { taskId: task.id }, { dedupeKey: `agent-task:${task.id}`, taskId: task.id });
    revalidatePath("/office");
    return { ok: true, message: "Assigned — watch them head to their desk." };
  } catch (e) { return fail(e); }
}
