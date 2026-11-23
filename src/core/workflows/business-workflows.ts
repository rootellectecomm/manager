import { db } from "../db/client";
import { j } from "../db/json";
import { defineWorkflow } from "./engine";
import { executeTool, type GatewayResult } from "../tools/gateway";
import { raiseAlert } from "../comms/alerts";
import { notifyFounder } from "../comms/notify";
import { createTask } from "../tasks/service";
import { runAgentOnTask, processProposedActions } from "../ai/agent-runner";
import { formatInr, formatIst, istDayStart, toIstParts } from "../time";
import type { RzpPayment, SrOrder } from "../connectors/defs";

const out = <T>(r: GatewayResult): T | null => (r.status === "ok" ? (r.output as T) : null);
const why = (r: GatewayResult) => (r.status === "ok" ? "" : "reason" in r ? r.reason : "error" in r ? r.error : r.status);

async function saveReport(title: string, md: string, taskId?: string) {
  return db.artifact.create({ data: { kind: "report", title, content: md, taskId } });
}

async function metric(key: string, value: number, unit: string, periodStart: Date, periodEnd: Date, source: string, verified = true, note = "") {
  await db.businessMetric.create({ data: { key, value, unit, periodStart, periodEnd, source, verified, note } });
}

// ───────────── Workflow 2: Payment ↔ order ↔ shipment reconciliation ─────────────
defineWorkflow("reconciliation", async (ctx) => {
  const data = await ctx.step("fetch", async () => {
    const pay = await executeTool({ agentCode: "G04", toolKey: "razorpay.read", params: { hours: 30 }, runId: ctx.runId });
    const ship = await executeTool({ agentCode: "G04", toolKey: "shiprocket.read", params: { days: 3 }, runId: ctx.runId });
    return { payments: out<Omit<RzpPayment, "email" | "contact">[]>(pay), paymentsWhy: why(pay), orders: out<SrOrder[]>(ship), ordersWhy: why(ship) };
  });
  if (!data.payments || !data.orders) {
    return { skipped: true, reason: `Needs Razorpay and Shiprocket connected. Razorpay: ${data.paymentsWhy || "ok"}; Shiprocket: ${data.ordersWhy || "ok"}` };
  }
  return ctx.step("reconcile", async () => {
    const captured = data.payments!.filter((p) => p.status === "captured");
    const graceCutoff = Date.now() / 1000 - 2 * 3600; // allow 2h for shipment creation
    const keys = new Set<string>();
    for (const o of data.orders!) { keys.add(String(o.channel_order_id)); keys.add(String(o.id)); }
    const matched = (p: (typeof captured)[number]) => [p.order_id, p.id, p.notes?.order_id, p.notes?.receipt, p.notes?.shopify_order_id, p.notes?.merchant_order_id].some((k) => k && keys.has(String(k)));
    const unmatched = captured.filter((p) => p.created_at < graceCutoff && !matched(p));
    const failed = data.payments!.filter((p) => p.status === "failed");
    for (const p of unmatched) {
      await raiseAlert({ severity: "SEV2", title: `Paid order without shipment: ${p.id}`, detail: `Payment ${p.id} (${formatInr(p.amount / 100)}, ${p.method}) captured at ${formatIst(new Date(p.created_at * 1000))} has no matching Shiprocket order (checked order_id, payment id and notes). Verify in Razorpay and Shiprocket before acting.`, source: "workflow:reconciliation", dedupeKey: `unmatched:${p.id}` });
    }
    const today = istDayStart();
    const todays = captured.filter((p) => p.created_at * 1000 >= today.getTime());
    await metric("revenue_web_captured_inr", todays.reduce((s, p) => s + p.amount / 100, 0), "INR", today, new Date(), "razorpay", true, "Captured payments today (IST), before refunds/fees");
    await metric("orders_web_captured", todays.length, "count", today, new Date(), "razorpay");
    if (data.payments!.length) await metric("payment_failure_rate", failed.length / data.payments!.length, "ratio", new Date(Date.now() - 30 * 3600_000), new Date(), "razorpay");
    return { captured: captured.length, shipments: data.orders!.length, unmatched: unmatched.map((p) => p.id), failedPayments: failed.length };
  });
}, { description: "Razorpay captured payments vs Shiprocket orders; unmatched paid orders open incidents" });

// ───────────── Workflow 3: GA4 tracking auditor ─────────────
defineWorkflow("ga4-audit", async (ctx) => {
  const d = await ctx.step("fetch", async () => {
    const ga = await executeTool({ agentCode: "D04", toolKey: "ga4.read", params: { preset: "purchases_by_day", days: 7 }, runId: ctx.runId });
    const pay = await executeTool({ agentCode: "D04", toolKey: "razorpay.read", params: { hours: 24 * 8 }, runId: ctx.runId });
    return { ga: out<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] }>(ga), gaWhy: why(ga), pay: out<RzpPayment[]>(pay), payWhy: why(pay) };
  });
  if (!d.ga || !d.pay) return { skipped: true, reason: `Needs GA4 and Razorpay. GA4: ${d.gaWhy || "ok"}; Razorpay: ${d.payWhy || "ok"}` };
  return ctx.step("compare", async () => {
    const byDay = new Map<string, number>();
    for (const p of d.pay!.filter((x) => x.status === "captured")) {
      const ip = toIstParts(new Date(p.created_at * 1000));
      const key = `${ip.year}${String(ip.month).padStart(2, "0")}${String(ip.day).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const rows = (d.ga!.rows ?? []).map((r) => ({ day: r.dimensionValues[0].value, ga: Number(r.metricValues[0].value), real: byDay.get(r.dimensionValues[0].value) ?? 0 }));
    const issues = rows.filter((r) => r.real + r.ga > 0 && Math.abs(r.ga - r.real) / Math.max(r.real, 1) > 0.15);
    const md = [`# GA4 purchase tracking audit`, "", "| Day | GA4 purchases | Captured payments | Gap |", "|---|---|---|---|", ...rows.map((r) => `| ${r.day} | ${r.ga} | ${r.real} | ${r.real ? `${Math.round(((r.ga - r.real) / r.real) * 100)}%` : r.ga ? "GA4 only" : "0"} |`), "", issues.length ? `**${issues.length} day(s) differ by more than 15%.** ${issues.some((i) => i.ga > i.real) ? "GA4 > payments suggests duplicate purchase events." : ""} ${issues.some((i) => i.ga < i.real) ? "GA4 < payments suggests missing purchase events (e.g. Magic Checkout success not firing the tag, consent, ad-blockers)." : ""}` : "GA4 purchases are within 15% of captured payments every day.", "", "_Payments include marketplace-independent web orders only. Small gaps are normal (consent, blockers, timezone edges)._"].join("\n");
    const art = await saveReport("GA4 tracking audit", md);
    if (issues.length) {
      await createTask({ title: "Investigate GA4 purchase tracking gap", objective: md, source: "workflow", trigger: "ga4-audit", ownerAgentCode: "D04", priority: 2, dedupeKey: `ga4-gap:${new Date().toISOString().slice(0, 10)}`, acceptanceCriteria: ["Cause identified with evidence", "Fix proposed (tag/event change via PR)"], actor: "workflow:ga4-audit" });
    }
    return { days: rows.length, issues: issues.length, reportId: art.id };
  });
}, { description: "Compare GA4 purchases with captured payments" });

// ───────────── Workflow 4: Daily marketing manager ─────────────
defineWorkflow("daily-marketing", async (ctx) => {
  const data = await ctx.step("fetch", async () => {
    const g = await executeTool({ agentCode: "D03", toolKey: "gads.read", params: { preset: "campaigns_yesterday" }, runId: ctx.runId });
    const m = await executeTool({ agentCode: "D02", toolKey: "meta.read", params: { level: "campaign", datePreset: "yesterday" }, runId: ctx.runId });
    const rev = await db.businessMetric.findMany({ where: { key: "revenue_web_captured_inr", source: "razorpay", periodStart: { gte: new Date(Date.now() - 2 * 86400_000) } }, orderBy: { capturedAt: "desc" }, take: 5 });
    return { google: out<unknown>(g), googleWhy: why(g), meta: out<unknown>(m), metaWhy: why(m), verifiedRevenue: rev.map((r) => ({ value: r.value, at: r.capturedAt })) };
  });
  if (!data.google && !data.meta) return { skipped: true, reason: `No ad platform connected. Google: ${data.googleWhy}; Meta: ${data.metaWhy}` };
  const task = await ctx.step("task", async () => (await createTask({
    title: `Daily marketing review · ${formatIst(new Date(), false)}`, objective: "Review yesterday's Google and Meta performance against verified commercial outcomes; flag anomalies; recommend actions with measurement plans. Budget/status changes must be proposed as actions (they require founder approval).",
    source: "schedule", ownerAgentCode: "D01", riskLevel: 0, priority: 2, dedupeKey: `daily-marketing:${new Date().toISOString().slice(0, 10)}`,
    acceptanceCriteria: ["Separates platform-reported conversions from verified revenue", "Each recommendation has expected benefit, risk and measurement"], actor: "workflow:daily-marketing",
  })).task.id);
  const analysis = await ctx.step("analyse", () => runAgentOnTask(task, { workflowRunId: ctx.runId, evidence: [{ ref: "google_ads:yesterday", data: data.google ?? { unavailable: data.googleWhy } }, { ref: "meta_ads:yesterday", data: data.meta ?? { unavailable: data.metaWhy } }, { ref: "verified_revenue", data: data.verifiedRevenue }] }));
  const actions = await ctx.step("actions", async () => (await processProposedActions(task, "D01", analysis.proposedActions, ctx.runId)).map((r) => ({ tool: r.action.tool, status: r.result.status })));
  return ctx.step("report", async () => {
    const md = [`# Daily marketing review`, "", analysis.summary, "", `**What changed:** ${analysis.whatChanged}`, `**Why it matters:** ${analysis.whyItMatters}`, `**Data reliability:** ${analysis.dataReliability}`, `**Root-cause hypothesis:** ${analysis.rootCauseHypothesis}`, `**Recommendation:** ${analysis.recommendation}`, `**Expected benefit:** ${analysis.expectedBenefit}`, `**Risks:** ${analysis.risks.join("; ") || "—"}`, `**Measurement:** ${analysis.measurement}`, "", "## Proposed actions", ...(actions.length ? actions.map((a) => `- ${a.tool}: ${a.status}`) : ["None"]), analysis.simulated ? "\n_SIMULATED analysis — connect an AI provider for real analysis._" : ""].join("\n");
    const art = await saveReport("Daily marketing review", md, task);
    return { reportId: art.id, actions };
  });
}, { description: "Google + Meta daily review vs verified revenue" });

// ───────────── Workflow 6: Marketplace listing auditor ─────────────
defineWorkflow("marketplace-audit", async (ctx) => {
  const r = await ctx.step("fetch", async () => {
    const a = await executeTool({ agentCode: "F02", toolKey: "amazon.read", params: { what: "listings" }, runId: ctx.runId });
    const m = await executeTool({ agentCode: "F05", toolKey: "merchant.read", params: {}, runId: ctx.runId });
    return { amazon: out<{ items?: { sku: string; summaries?: { status?: string[]; itemName?: string }[]; issues?: { code: string; message: string; severity: string }[] }[] }>(a), amazonWhy: why(a), merchant: out<{ products?: { offerId: string; productStatus?: { destinationStatuses?: { disapprovedCountries?: string[] }[]; itemLevelIssues?: { description: string; severity: string }[] } }[] }>(m), merchantWhy: why(m) };
  });
  return ctx.step("report", async () => {
    const lines = ["# Marketplace listing audit", ""];
    let problems = 0;
    if (r.amazon) {
      lines.push("## Amazon");
      for (const it of r.amazon.items ?? []) {
        const errs = (it.issues ?? []).filter((i) => i.severity === "ERROR");
        const buyable = it.summaries?.[0]?.status?.includes("BUYABLE");
        if (errs.length || !buyable) problems++;
        lines.push(`- ${it.sku} · ${it.summaries?.[0]?.itemName ?? ""} · ${buyable ? "BUYABLE" : "NOT BUYABLE"}${errs.length ? ` · ${errs.map((e) => e.message).join("; ")}` : ""}`);
      }
    } else lines.push(`## Amazon\nNot checked: ${r.amazonWhy}`);
    if (r.merchant) {
      lines.push("", "## Google Merchant Center");
      for (const p of r.merchant.products ?? []) {
        const dis = (p.productStatus?.destinationStatuses ?? []).some((d) => (d.disapprovedCountries ?? []).length);
        if (dis) problems++;
        lines.push(`- ${p.offerId}: ${dis ? "DISAPPROVED" : "ok"}${(p.productStatus?.itemLevelIssues ?? []).length ? ` · ${(p.productStatus?.itemLevelIssues ?? []).map((i) => i.description).join("; ")}` : ""}`);
      }
    } else lines.push("", `## Google Merchant Center\nNot checked: ${r.merchantWhy}`);
    lines.push("", "## Flipkart / Nykaa", "Checked through human-assisted browser tasks (no assumed API access).");
    const art = await saveReport("Marketplace listing audit", lines.join("\n"));
    if (problems) await raiseAlert({ severity: "SEV3", title: `${problems} marketplace listing problem(s)`, detail: `See report ${art.id}`, source: "workflow:marketplace-audit", dedupeKey: `marketplace:${new Date().toISOString().slice(0, 10)}` });
    if (toIstParts(new Date()).weekday === 1) {
      for (const portal of ["Flipkart", "Nykaa"]) {
        await createTask({ title: `Weekly ${portal} listing check`, objective: `Log in to the ${portal} seller portal and confirm for each Rootellect SKU: live, in stock, price correct, no policy flags. Attach screenshots.`, source: "schedule", ownerAgentCode: portal === "Flipkart" ? "F03" : "F04", dedupeKey: `assisted:${portal}:${new Date().toISOString().slice(0, 10)}`, acceptanceCriteria: ["Screenshot per SKU attached"], actor: "workflow:marketplace-audit" });
      }
    }
    return { reportId: art.id, problems };
  });
}, { description: "Amazon + Merchant Center listing health; Flipkart/Nykaa assisted checks" });

// ───────────── Workflow 5: SEO control centre ─────────────
defineWorkflow("seo-control", async (ctx) => {
  const d = await ctx.step("fetch", async () => {
    const q = await executeTool({ agentCode: "D06", toolKey: "gsc.read", params: { days: 28, dimension: "query" }, runId: ctx.runId });
    const p = await executeTool({ agentCode: "D06", toolKey: "gsc.read", params: { days: 28, dimension: "page" }, runId: ctx.runId });
    const qa = await db.testResult.findMany({ where: { suite: "storefront", status: { in: ["FAIL", "WARN"] }, check: { in: ["Meta description", "Homepage <title>", "Canonical link", "Product structured data", "sitemap.xml", "robots.txt", "Open Graph image", "Product image tag"] }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, take: 50 });
    return { queries: out<unknown>(q), pages: out<unknown>(p), why: why(q), technical: qa.map((r) => ({ check: r.check, target: r.target, status: r.status, detail: r.detail })) };
  });
  const task = await ctx.step("task", async () => (await createTask({ title: `SEO control centre · week of ${formatIst(new Date(), false)}`, objective: "Find queries/pages with impressions but weak CTR or position, and technical SEO issues; propose prioritized fixes with expected impact and how progress will be measured.", source: "schedule", ownerAgentCode: "D06", dedupeKey: `seo:${new Date().toISOString().slice(0, 10)}`, acceptanceCriteria: ["Opportunities ranked with evidence", "Technical issues assigned"], actor: "workflow:seo-control" })).task.id);
  const a = await ctx.step("analyse", () => runAgentOnTask(task, { workflowRunId: ctx.runId, evidence: [{ ref: "gsc:queries", data: d.queries ?? { unavailable: d.why } }, { ref: "gsc:pages", data: d.pages ?? { unavailable: d.why } }, { ref: "qa:technical-seo", data: d.technical }] }));
  return ctx.step("report", async () => ({ reportId: (await saveReport("SEO control centre", `# SEO control centre\n\n${a.summary}\n\n${a.findings.map((f) => `- **${f.title}** — ${f.detail}`).join("\n")}\n\n**Recommendation:** ${a.recommendation}\n\n**Measurement:** ${a.measurement}`, task)).id }));
}, { description: "Search Console + technical SEO weekly review" });

// ───────────── Workflow 9: Executive brief (deterministic — numbers come from records, not models) ─────────────
defineWorkflow("executive-brief", async (ctx) => {
  return ctx.step("brief", async () => {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [completed, pending, incidents, alerts, blocked, aiCost, revenue, calendar, failedRuns] = await Promise.all([
      db.task.findMany({ where: { completedAt: { gte: since } }, include: { owner: true }, take: 30 }),
      db.approvalRequest.findMany({ where: { status: { in: ["PENDING", "DEFERRED"] } }, orderBy: { createdAt: "asc" } }),
      db.incident.findMany({ where: { status: { not: "RESOLVED" } } }),
      db.alert.findMany({ where: { status: "OPEN", createdAt: { gte: since } } }),
      db.task.findMany({ where: { status: { in: ["BLOCKED", "FAILED", "NEEDS_REWORK"] } }, take: 20 }),
      db.modelUsage.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: since } } }),
      db.businessMetric.findFirst({ where: { key: "revenue_web_captured_inr" }, orderBy: { capturedAt: "desc" } }),
      db.calendarEvent.findMany({ where: { startsAt: { gte: new Date(), lte: new Date(Date.now() + 36 * 3600_000) } }, orderBy: { startsAt: "asc" } }),
      db.workflowRun.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    ]);
    const md = [
      `# Rootellect executive brief — ${formatIst(new Date())}`, "",
      `**${completed.length}** tasks completed · **${pending.length}** need your approval · **${incidents.length}** open incident(s) · AI spend (24h) ${formatInr(aiCost._sum.costInr ?? 0, 2)}`, "",
      "## Decisions waiting for you", ...(pending.length ? pending.map((p) => `- **${p.shortCode}** ${p.title} — risk ${p.riskLevel}, ${p.agentCode}, expires ${formatIst(p.expiresAt)}`) : ["None"]), "",
      "## Incidents & alerts", ...(incidents.length || alerts.length ? [...incidents.map((i) => `- [${i.severity}] ${i.title} (${i.status})`), ...alerts.filter((a) => !a.incidentId).map((a) => `- [${a.severity}] ${a.title}${a.count > 1 ? ` ×${a.count}` : ""}`)] : ["None"]), "",
      "## Completed (24h)", ...(completed.length ? completed.map((t) => `- ${t.title} (${t.owner?.code ?? "—"})`) : ["None"]), "",
      "## Blocked / needs rework", ...(blocked.length ? blocked.map((t) => `- ${t.title} [${t.status}] ${t.statusReason ?? ""}`) : ["None"]), "",
      "## Revenue (verified)", revenue ? `- Web captured payments today: ${formatInr(revenue.value)} (source: ${revenue.source}, ${formatIst(revenue.capturedAt)})` : "- No verified revenue data yet (connect Razorpay).", "",
      "## Upcoming", ...(calendar.length ? calendar.map((c) => `- ${formatIst(c.startsAt)} · ${c.title}`) : ["Nothing scheduled in the next 36h"]),
      failedRuns ? `\n_${failedRuns} workflow run(s) failed in the last 24h — see Task Command Center._` : "",
    ].join("\n");
    const art = await saveReport(`Executive brief · ${formatIst(new Date())}`, md);
    await notifyFounder({ severity: "REPORT", subject: `Rootellect brief: ${pending.length} approval(s), ${incidents.length} incident(s)`, body: md.slice(0, 3500), dedupeKey: `brief:${ctx.runId}` });
    return { reportId: art.id, pending: pending.length, incidents: incidents.length, completed: completed.length };
  });
}, { description: "Morning/evening executive brief from verified records" });

// ───────────── Workflow 10: Weekly strategic review ─────────────
defineWorkflow("weekly-review", async (ctx) => {
  const facts = await ctx.step("facts", async () => {
    const since = new Date(Date.now() - 7 * 86400_000);
    const [done, failed, incidents, approvals, cost, metrics, debates] = await Promise.all([
      db.task.count({ where: { completedAt: { gte: since } } }),
      db.task.count({ where: { status: { in: ["FAILED", "NEEDS_REWORK"] }, updatedAt: { gte: since } } }),
      db.incident.findMany({ where: { createdAt: { gte: since } } }),
      db.approvalRequest.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: since } } }),
      db.modelUsage.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: since } } }),
      db.businessMetric.findMany({ where: { capturedAt: { gte: since } }, orderBy: { capturedAt: "desc" }, take: 60 }),
      db.debate.findMany({ where: { createdAt: { gte: since } }, select: { question: true, outcome: true, recommendation: true } }),
    ]);
    return { done, failed, incidents: incidents.map((i) => `${i.severity} ${i.title} ${i.status}`), approvals, aiCostInr: cost._sum.costInr ?? 0, metrics: metrics.map((m) => ({ key: m.key, value: m.value, verified: m.verified, source: m.source })), debates };
  });
  const task = await ctx.step("task", async () => (await createTask({ title: `Weekly strategic review · ${formatIst(new Date(), false)}`, objective: "Identify the most important opportunities and threats from this week's verified records; recommend next week's priorities; flag decisions that warrant a five-round debate (set needsDebate).", source: "schedule", ownerAgentCode: "A01", priority: 2, dedupeKey: `weekly:${new Date().toISOString().slice(0, 10)}`, acceptanceCriteria: ["Priorities tied to evidence", "Each priority has an owner"], actor: "workflow:weekly-review" })).task.id);
  const a = await ctx.step("analyse", () => runAgentOnTask(task, { workflowRunId: ctx.runId, evidence: [{ ref: "week:facts", data: facts }] }));
  return ctx.step("report", async () => {
    const md = `# Weekly strategic review\n\n${a.summary}\n\n## Findings\n${a.findings.map((f) => `- **${f.title}** — ${f.detail}`).join("\n")}\n\n## Recommended priorities\n${a.recommendation}\n\n## Facts used\n\`\`\`json\n${JSON.stringify(facts, null, 2).slice(0, 4000)}\n\`\`\``;
    return { reportId: (await saveReport("Weekly strategic review", md, task)).id, needsDebate: a.needsDebate };
  });
}, { description: "Weekly opportunities/threats review by the Chief of Staff" });

export const _keep = j;
