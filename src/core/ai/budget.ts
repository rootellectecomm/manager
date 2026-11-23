import { db } from "../db/client";
import { istDayStart, istMonthStart } from "../time";

export class BudgetExceededError extends Error {
  constructor(public scope: string, public limitInr: number, public spentInr: number) {
    super(`Budget exhausted: ${scope} spent ₹${spentInr.toFixed(2)} of ₹${limitInr.toFixed(2)}. Work is paused until the founder raises the limit or the period resets.`);
  }
}

async function spent(where: Record<string, unknown>, since: Date): Promise<number> {
  const r = await db.modelUsage.aggregate({ _sum: { costInr: true }, where: { ...where, createdAt: { gte: since } } });
  return r._sum.costInr ?? 0;
}

/**
 * Checked before every model call. Covers company daily/monthly, per-agent monthly,
 * per-agent daily tokens, and the debate pool. Throws BudgetExceededError — callers pause, never loop.
 */
export async function assertWithinBudget(opts: { agentCode?: string; debate?: boolean }): Promise<void> {
  const day = istDayStart();
  const month = istMonthStart();
  const budgets = await db.budget.findMany();
  for (const b of budgets) {
    if (b.scope === "company") {
      const s = await spent({}, b.period === "daily" ? day : month);
      if (s >= b.limitInr) throw new BudgetExceededError(`company ${b.period}`, b.limitInr, s);
    }
    if (b.scope === "provider" && b.scopeRef === "debate" && opts.debate) {
      const s = await spent({ debateId: { not: null } }, b.period === "daily" ? day : month);
      if (s >= b.limitInr) throw new BudgetExceededError(`debate ${b.period}`, b.limitInr, s);
    }
    if (b.scope === "department" && opts.agentCode && opts.agentCode.startsWith(b.scopeRef)) {
      const s = await spent({ agentCode: { startsWith: b.scopeRef } }, b.period === "daily" ? day : month);
      if (s >= b.limitInr) throw new BudgetExceededError(`department ${b.scopeRef} ${b.period}`, b.limitInr, s);
    }
  }
  if (opts.agentCode) {
    const agent = await db.agent.findUnique({ where: { code: opts.agentCode } });
    if (agent) {
      const m = await spent({ agentCode: agent.code }, month);
      if (m >= agent.monthlyBudgetInr) throw new BudgetExceededError(`agent ${agent.code} monthly`, agent.monthlyBudgetInr, m);
      const t = await db.modelUsage.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { agentCode: agent.code, createdAt: { gte: day } } });
      const tokens = (t._sum.tokensIn ?? 0) + (t._sum.tokensOut ?? 0);
      if (tokens >= agent.dailyTokenBudget) throw new BudgetExceededError(`agent ${agent.code} daily tokens (${tokens}/${agent.dailyTokenBudget})`, 0, 0);
    }
  }
}

/** Default estimate when no price is configured — clearly flagged as unverified in usage records. */
export const ESTIMATE_USD_PER_MTOK = { in: 5, out: 20 };

export function costInr(tokensIn: number, tokensOut: number, price: { inPerMTok: number; outPerMTok: number } | undefined, inrPerUsd: number) {
  const p = price ?? { inPerMTok: ESTIMATE_USD_PER_MTOK.in, outPerMTok: ESTIMATE_USD_PER_MTOK.out };
  const usd = (tokensIn / 1e6) * p.inPerMTok + (tokensOut / 1e6) * p.outPerMTok;
  return { inr: usd * inrPerUsd, verified: Boolean(price) };
}
