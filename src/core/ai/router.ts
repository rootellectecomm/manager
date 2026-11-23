import type { z } from "zod";
import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { decryptSecret } from "../crypto";
import { env } from "../env";
import { ADAPTERS, extractJson, ProviderError, type ProviderId } from "./providers";
import { assertWithinBudget, costInr } from "./budget";
import { simulate } from "./simulated";

export type Tier = "fast" | "balanced" | "deep";

export interface ModelCall<T> {
  purpose: string; // e.g. "agent_task", "debate_r1" — used for logging and the simulated provider
  provider: ProviderId;
  fallback?: ProviderId | null;
  tier: Tier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  agentCode?: string;
  taskId?: string;
  debateId?: string;
  workflowRunId?: string;
  maxOutputTokens?: number;
  simulationContext?: Record<string, unknown>;
}

export interface ModelResult<T> { data: T; provider: ProviderId | "simulated"; model: string; simulated: boolean; costInr: number; costVerified: boolean }

export class NoProviderError extends Error {}

// Simple in-process sliding window per provider (each worker enforces its share).
const windows = new Map<string, number[]>();
async function rateLimit(provider: string, perMin: number) {
  for (;;) {
    const now = Date.now();
    const w = (windows.get(provider) ?? []).filter((t) => now - t < 60_000);
    if (w.length < perMin) { w.push(now); windows.set(provider, w); return; }
    await new Promise((r) => setTimeout(r, Math.max(250, 60_000 - (now - w[0]))));
  }
}

export async function providerReady(p: ProviderId): Promise<boolean> {
  const row = await db.modelProvider.findUnique({ where: { provider: p } });
  return Boolean(row?.enabled && row.encryptedKey && row.status === "CONNECTED");
}

export async function availableProviders(): Promise<ProviderId[]> {
  const rows = await db.modelProvider.findMany({ where: { enabled: true, status: "CONNECTED" } });
  return rows.filter((r) => r.encryptedKey).map((r) => r.provider as ProviderId);
}

async function callOnce<T>(p: ProviderId, call: ModelCall<T>): Promise<ModelResult<T>> {
  const row = await db.modelProvider.findUnique({ where: { provider: p } });
  if (!row?.enabled || !row.encryptedKey) throw new NoProviderError(`${p} is not configured`);
  const tiers = parseJson<Record<string, string>>(row.tierModels, {});
  const model = tiers[call.tier] ?? tiers.balanced;
  if (!model) throw new NoProviderError(`${p} has no model set for tier "${call.tier}" (Settings → AI Providers)`);
  await rateLimit(p, row.rateLimitPerMin);

  const exec = await db.execution.create({
    data: { kind: "model", taskId: call.taskId, workflowRunId: call.workflowRunId, agentCode: call.agentCode, provider: p, model, status: "RUNNING", input: j({ purpose: call.purpose, promptChars: call.prompt.length }) },
  });
  const key = decryptSecret(row.encryptedKey);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await ADAPTERS[p].complete(key, { model, system: call.system, prompt: attempt === 0 ? call.prompt : `${call.prompt}\n\nYour previous reply was not valid JSON for the required schema (${(lastErr as Error)?.message?.slice(0, 200)}). Reply again with valid JSON only.`, json: true, maxOutputTokens: call.maxOutputTokens });
      const price = parseJson<Record<string, { inPerMTok: number; outPerMTok: number }>>(row.priceTable, {})[out.model] ?? parseJson<Record<string, { inPerMTok: number; outPerMTok: number }>>(row.priceTable, {})[model];
      const cost = costInr(out.tokensIn, out.tokensOut, price, row.inrPerUsd);
      await db.modelUsage.create({ data: { provider: p, model: out.model, agentCode: call.agentCode, taskId: call.taskId, debateId: call.debateId, tokensIn: out.tokensIn, tokensOut: out.tokensOut, costInr: cost.inr, costVerified: cost.verified } });
      const parsed = call.schema.safeParse(extractJson(out.text));
      if (!parsed.success) { lastErr = new Error(parsed.error.message); continue; }
      await db.execution.update({ where: { id: exec.id }, data: { status: "SUCCEEDED", output: j(parsed.data), costInr: cost.inr, endedAt: new Date() } });
      return { data: parsed.data, provider: p, model: out.model, simulated: false, costInr: cost.inr, costVerified: cost.verified };
    } catch (e) {
      lastErr = e;
      if (e instanceof ProviderError && !e.retryable) break;
      if (e instanceof ProviderError) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  await db.execution.update({ where: { id: exec.id }, data: { status: "FAILED", error: String((lastErr as Error)?.message ?? lastErr), endedAt: new Date() } });
  if (lastErr instanceof ProviderError && (lastErr.status === 401 || lastErr.status === 403)) {
    await db.modelProvider.update({ where: { provider: p }, data: { status: "ERROR", lastError: lastErr.message } });
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Calls the agent's primary provider, then its fallback. Enforces budgets first.
 * With no providers configured: uses the SIMULATED provider only when
 * ALLOW_SIMULATED_PROVIDER=true, and every output is labelled simulated.
 */
export async function callModel<T>(call: ModelCall<T>): Promise<ModelResult<T>> {
  await assertWithinBudget({ agentCode: call.agentCode, debate: Boolean(call.debateId) });
  const order = [call.provider, ...(call.fallback && call.fallback !== call.provider ? [call.fallback] : [])];
  const errors: string[] = [];
  for (const p of order) {
    if (!(await providerReady(p))) { errors.push(`${p}: not configured`); continue; }
    try {
      return await callOnce(p, call);
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  }
  if (env.allowSimulatedProvider) {
    const data = call.schema.parse(simulate(call.purpose, call.simulationContext ?? {}, call.provider));
    await db.execution.create({ data: { kind: "model", taskId: call.taskId, workflowRunId: call.workflowRunId, agentCode: call.agentCode, provider: "simulated", model: "simulated", status: "SIMULATED", input: j({ purpose: call.purpose }), output: j(data), endedAt: new Date() } });
    return { data, provider: "simulated", model: "simulated", simulated: true, costInr: 0, costVerified: true };
  }
  throw new NoProviderError(`No AI provider available. ${errors.join(" · ")}`);
}

/** Calls one specific provider (used by the debate panel, where independence matters more than fallback). */
export async function callSpecific<T>(provider: ProviderId, call: Omit<ModelCall<T>, "provider" | "fallback">): Promise<ModelResult<T>> {
  await assertWithinBudget({ agentCode: call.agentCode, debate: Boolean(call.debateId) });
  if (await providerReady(provider)) return callOnce(provider, { ...call, provider });
  if (env.allowSimulatedProvider) {
    const data = call.schema.parse(simulate(call.purpose, call.simulationContext ?? {}, provider));
    return { data, provider: "simulated", model: `simulated-${provider}`, simulated: true, costInr: 0, costVerified: true };
  }
  throw new NoProviderError(`${provider} is not configured`);
}
