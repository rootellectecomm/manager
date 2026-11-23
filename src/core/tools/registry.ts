import { z } from "zod";
import { db } from "../db/client";
import { j } from "../db/json";
import { getConfig } from "../connectors/registry";
import * as C from "../connectors/defs";
import { searchKnowledge, proposeKnowledge } from "../knowledge/service";
import { lintClaims } from "../compliance";
import { istDayStart } from "../time";

export interface ToolContext { agentCode: string; taskId?: string; runId?: string; idempotencyKey: string; actor: string }
export interface ToolDef<P = Record<string, unknown>> {
  key: string;
  params: z.ZodTypeAny;
  /** "manual" tools have no safe API: after approval they create a human task with the exact approved parameters. */
  manual?: string;
  run?(p: P, ctx: ToolContext): Promise<unknown>;
}

const t = <S extends z.ZodTypeAny>(key: string, params: S, run: (p: z.infer<S>, ctx: ToolContext) => Promise<unknown>): ToolDef<z.infer<S>> => ({ key, params, run });
const manual = <S extends z.ZodTypeAny>(key: string, params: S, why: string): ToolDef<z.infer<S>> => ({ key, params, manual: why });

function stripHtml(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const dayRange = (days: number) => {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return { from, to, fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
};

export const TOOLS: Record<string, ToolDef<any>> = Object.fromEntries([
  t("knowledge.search", z.object({ query: z.string(), category: z.string().optional() }), async (p) => searchKnowledge(p.query, { category: p.category })),
  t("metrics.read", z.object({ key: z.string().optional(), days: z.number().default(30) }), async (p) =>
    db.businessMetric.findMany({ where: { ...(p.key ? { key: p.key } : {}), periodStart: { gte: new Date(Date.now() - p.days * 86400_000) } }, orderBy: { periodStart: "desc" }, take: 200 })),
  t("web.fetch", z.object({ url: z.string().url() }), async (p) => {
    const res = await fetch(p.url, { headers: { "User-Agent": "RootellectOS-Research/1.0" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const text = stripHtml(await res.text()).slice(0, 15_000);
    // External content is data, never instructions — wrapped so prompts treat it as untrusted.
    return { url: p.url, status: res.status, untrustedContent: text };
  }),
  t("qa.synthetic_check", z.object({ url: z.string().url().optional(), suite: z.enum(["storefront", "single"]).optional() }), async (p, ctx) => {
    const { runStorefrontSuite, checkSinglePage } = await import("../qa/synthetic");
    // A bare URL means "check this page"; the full suite runs only when asked for (or with no URL).
    const suite = p.suite ?? (p.url ? "single" : "storefront");
    return suite === "single" && p.url ? checkSinglePage(p.url) : runStorefrontSuite({ baseUrl: p.url, actor: ctx.actor, taskId: ctx.taskId });
  }),
  t("qa.browser_run", z.object({ journey: z.enum(["home_to_cart", "mobile_home", "checkout_open"]).default("home_to_cart"), baseUrl: z.string().url().optional() }), async (p, ctx) => {
    const { runBrowserJourney } = await import("../qa/browser");
    return runBrowserJourney(p.journey, { baseUrl: p.baseUrl, taskId: ctx.taskId });
  }),
  t("connectors.health", z.object({}), async () => (await import("../connectors/registry")).checkAllConnectors()),
  t("github.read", z.object({ what: z.enum(["pulls", "commits", "repo", "checks"]).default("commits"), ref: z.string().optional() }), async (p) => {
    const cfg = await getConfig("github");
    if (p.what === "checks") return C.github.combinedStatus(cfg, p.ref ?? "HEAD");
    return p.what === "pulls" ? C.github.listPulls(cfg) : p.what === "repo" ? C.github.repo(cfg) : C.github.recentCommits(cfg);
  }),
  t("vercel.read", z.object({ limit: z.number().default(10) }), async (p) => C.vercel.deployments(await getConfig("vercel"), p.limit)),
  t("razorpay.read", z.object({ hours: z.number().default(24) }), async (p) => {
    const now = Math.floor(Date.now() / 1000);
    const items = await C.razorpay.payments(await getConfig("razorpay"), now - p.hours * 3600, now);
    return items.map(({ email: _e, contact: _c, ...rest }) => rest); // customer PII masked before it reaches any model
  }),
  t("shiprocket.read", z.object({ days: z.number().default(2) }), async (p) => {
    const r = dayRange(p.days);
    return C.shiprocket.orders(await getConfig("shiprocket"), r.fromDate, r.toDate);
  }),
  t("ga4.read", z.object({ preset: z.enum(["purchases_by_day", "sessions_by_source", "funnel"]).default("purchases_by_day"), days: z.number().default(7) }), async (p) => {
    const cfg = await getConfig("ga4");
    const dateRanges = [{ startDate: `${p.days}daysAgo`, endDate: "today" }];
    if (p.preset === "sessions_by_source") return C.ga4.runReport(cfg, { dateRanges, dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }, { name: "purchaseRevenue" }], limit: 25 });
    if (p.preset === "funnel") return C.ga4.runReport(cfg, { dateRanges, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["view_item", "add_to_cart", "begin_checkout", "add_payment_info", "purchase"] } } } });
    return C.ga4.runReport(cfg, { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "ecommercePurchases" }, { name: "purchaseRevenue" }, { name: "transactions" }] });
  }),
  t("gsc.read", z.object({ days: z.number().default(28), dimension: z.enum(["query", "page"]).default("query") }), async (p) => {
    const r = dayRange(p.days);
    return C.gsc.query(await getConfig("gsc"), { startDate: r.fromDate, endDate: r.toDate, dimensions: [p.dimension], rowLimit: 100 });
  }),
  t("gads.read", z.object({ preset: z.enum(["campaigns_yesterday", "search_terms_7d"]).default("campaigns_yesterday") }), async (p) => {
    const q = p.preset === "search_terms_7d"
      ? "SELECT search_term_view.search_term, campaign.name, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date DURING LAST_7_DAYS ORDER BY metrics.cost_micros DESC LIMIT 100"
      : "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date DURING YESTERDAY";
    return C.googleAds.search(await getConfig("google_ads"), q);
  }),
  t("meta.read", z.object({ level: z.enum(["campaign", "adset", "ad"]).default("campaign"), datePreset: z.string().default("yesterday") }), async (p) => C.meta.insights(await getConfig("meta_ads"), p.level, p.datePreset)),
  t("omnisend.read", z.object({}), async () => C.omnisend.campaigns(await getConfig("omnisend"))),
  t("amazon.read", z.object({ what: z.enum(["orders_24h", "listings"]).default("listings") }), async (p) => {
    const cfg = await getConfig("amazon_sp");
    if (p.what === "orders_24h") return C.amazon.orders(cfg, new Date(Date.now() - 86400_000).toISOString());
    return C.amazon.listings(cfg);
  }),
  t("merchant.read", z.object({}), async () => C.merchant.products(await getConfig("merchant"))),
  t("calendar.read", z.object({ days: z.number().default(1) }), async (p) => {
    const start = istDayStart();
    return C.workspace.events(await getConfig("google_workspace"), start.toISOString(), new Date(start.getTime() + p.days * 86400_000).toISOString());
  }),
  t("notify.founder", z.object({ subject: z.string(), body: z.string(), severity: z.enum(["SEV1", "SEV2", "SEV3", "INFO", "REPORT"]).default("INFO") }), async (p, ctx) =>
    (await import("../comms/notify")).notifyFounder({ severity: p.severity, subject: p.subject, body: p.body, dedupeKey: `agent:${ctx.agentCode}:${ctx.idempotencyKey}` })),
  t("report.write", z.object({ title: z.string(), markdown: z.string(), kind: z.string().default("report") }), async (p, ctx) =>
    db.artifact.create({ data: { kind: p.kind, title: p.title, content: p.markdown, taskId: ctx.taskId } })),
  t("task.propose", z.object({ title: z.string(), objective: z.string(), owner: z.string().optional(), priority: z.number().default(3) }), async (p, ctx) =>
    (await import("../tasks/service")).createTask({ title: p.title, objective: p.objective, source: "agent", trigger: `proposed by ${ctx.agentCode}`, ownerAgentCode: p.owner, priority: p.priority, parentId: ctx.taskId, actor: `agent:${ctx.agentCode}` })),
  t("task.create", z.object({ title: z.string(), objective: z.string(), owner: z.string().optional(), priority: z.number().default(3), acceptanceCriteria: z.array(z.string()).default([]) }), async (p, ctx) =>
    (await import("../tasks/service")).createTask({ title: p.title, objective: p.objective, source: "agent", ownerAgentCode: p.owner, priority: p.priority, acceptanceCriteria: p.acceptanceCriteria, parentId: ctx.taskId, actor: `agent:${ctx.agentCode}` })),
  t("task.assign", z.object({ taskId: z.string(), agent: z.string() }), async (p, ctx) => (await import("../tasks/service")).assignTask(p.taskId, p.agent, `agent:${ctx.agentCode}`)),
  t("knowledge.propose", z.object({ title: z.string(), body: z.string(), category: z.string().default("company") }), async (p, ctx) =>
    proposeKnowledge({ ...p, source: `agent:${ctx.agentCode}`, provenance: ctx.taskId ? `task:${ctx.taskId}` : "" }, `agent:${ctx.agentCode}`)),
  t("creative.draft", z.object({ title: z.string(), kind: z.string().default("copy"), content: z.string() }), async (p, ctx) => {
    const issues = lintClaims(p.content);
    const art = await db.artifact.create({ data: { kind: "creative", title: p.title, content: p.content, taskId: ctx.taskId } });
    return { artifactId: art.id, claimIssues: issues, needsClaimsReview: issues.length > 0 };
  }),
  t("debate.request", z.object({ question: z.string(), context: z.string().default("") }), async (p, ctx) =>
    (await import("../workflows/engine")).startWorkflow("debate", { question: p.question, context: p.context, taskId: ctx.taskId, requestedBy: ctx.agentCode }, { taskId: ctx.taskId })),
  t("incident.manage", z.object({ title: z.string(), severity: z.enum(["SEV1", "SEV2", "SEV3"]).default("SEV3"), detail: z.string().default("") }), async (p, ctx) =>
    (await import("../comms/alerts")).raiseAlert({ severity: p.severity, title: p.title, detail: p.detail, source: `agent:${ctx.agentCode}`, dedupeKey: `agent-incident:${p.title.toLowerCase()}` })),
  t("github.create_pr", z.object({ branch: z.string().regex(/^[a-z0-9._/-]+$/i), title: z.string(), body: z.string().default(""), files: z.array(z.object({ path: z.string(), content: z.string() })).default([]) }), async (p) =>
    C.github.createPullRequest(await getConfig("github"), p)),
  manual("calendar.write", z.object({ title: z.string(), start: z.string() }), "Calendar writes are disabled by default (read-only scope)."),
  t("browser.assisted", z.object({ portal: z.string(), checklist: z.array(z.string()) }), async (p, ctx) =>
    (await import("../tasks/service")).createTask({ title: `Assisted check: ${p.portal}`, objective: `Human-assisted browser session. Checklist:\n- ${p.checklist.join("\n- ")}`, source: "agent", trigger: "browser.assisted", priority: 3, actor: `agent:${ctx.agentCode}` })),
  // ── Level 3 (founder approval) ──
  t("vercel.promote", z.object({ deploymentId: z.string() }), async (p) => C.vercel.promote(await getConfig("vercel"), p.deploymentId)),
  t("github.merge_pr", z.object({ number: z.number(), headSha: z.string().optional() }), async (p) => C.github.mergePullRequest(await getConfig("github"), p.number, p.headSha)),
  t("gads.update_budget", z.object({ budgetResourceName: z.string(), amountInr: z.number().positive().max(100000) }), async (p) => C.googleAds.setBudget(await getConfig("google_ads"), p.budgetResourceName, p.amountInr)),
  t("meta.update_budget", z.object({ objectId: z.string(), amountInr: z.number().positive().max(100000) }), async (p) => C.meta.setDailyBudget(await getConfig("meta_ads"), p.objectId, p.amountInr)),
  t("meta.set_status", z.object({ objectId: z.string(), status: z.enum(["ACTIVE", "PAUSED"]) }), async (p) => C.meta.setStatus(await getConfig("meta_ads"), p.objectId, p.status)),
  manual("omnisend.send_campaign", z.object({ campaignId: z.string() }), "Campaign sends are executed in Omnisend by a human after approval."),
  t("whatsapp.send_customer", z.object({ to: z.array(z.string()).max(500), template: z.string(), lang: z.string().default("en"), params: z.array(z.string()).default([]) }), async (p) => {
    const cfg = await getConfig("whatsapp");
    const results = [];
    for (const to of p.to) results.push(await C.whatsapp.sendTemplate(cfg, to, p.template, p.lang, p.params)); // templates only — policy-compliant
    return { sent: results.length };
  }),
  manual("social.publish", z.object({ platform: z.string(), artifactId: z.string(), caption: z.string() }), "No publishing connector configured; a human posts the approved asset."),
  manual("pricing.update", z.object({ sku: z.string(), channel: z.string(), newPriceInr: z.number().positive() }), "Price changes touch the storefront, marketplaces, feeds and ads; executed by a human with the impact checklist."),
  manual("catalog.update", z.object({ sku: z.string(), channel: z.string(), change: z.string() }), "Catalog changes are executed by a human with the impact checklist."),
  manual("shiprocket.create_order", z.object({ orderRef: z.string() }), "Manual shipment creation is done in Shiprocket by a human after approval."),
  t("razorpay.refund", z.object({ paymentId: z.string(), amountInr: z.number().positive().max(50000) }), async (p, ctx) =>
    C.razorpay.refund(await getConfig("razorpay"), p.paymentId, Math.round(p.amountInr * 100), ctx.idempotencyKey)),
  t("claims.review", z.object({ text: z.string(), artifactId: z.string().optional() }), async (p, ctx) => {
    await db.knowledgeEntry.create({ data: { title: `Approved claim (${new Date().toISOString().slice(0, 10)})`, body: p.text, category: "claims", verified: true, source: "founder", provenance: `approval via ${ctx.idempotencyKey}` } });
    return { recorded: true };
  }),
  manual("data.export_customers", z.object({ purpose: z.string() }), "Customer data exports are performed by a human under the data policy."),
].map((d) => [d.key, d]));

export function toolRunJson(v: unknown) { return j(v); }
