/**
 * Connector definitions. Each one: the credentials it needs, a health check, and the
 * operations tools may call. Versions live in config with dated defaults so the
 * API Integration Engineer can upgrade without code changes.
 *
 * Status of each connector is reported honestly by its health check; nothing here
 * is assumed to work until an authenticated call has succeeded.
 */
import nodemailer from "nodemailer";
import { basic, call, ConnectorError, type ConnectorStatus } from "./http";
import { refreshTokenAccess, serviceAccountToken } from "./google-auth";

export type Cfg = Record<string, string>;
export interface Field { name: string; label: string; secret?: boolean; required?: boolean; help?: string; placeholder?: string }
export interface Health { status: ConnectorStatus; detail: string }

export interface ConnectorDef {
  key: string;
  name: string;
  category: "Development" | "Marketing" | "E-commerce" | "Communication" | "Finance" | "Research";
  description: string;
  docs: string;
  fields: Field[];
  capabilities: string[];
  mode: "api" | "browser-assisted";
  health(cfg: Cfg): Promise<Health>;
}

const ok = (detail: string): Health => ({ status: "CONNECTED", detail });

// ───────────────────── Development ─────────────────────

export const github = {
  base: "https://api.github.com",
  headers(cfg: Cfg) {
    return { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "rootellect-ai-os" };
  },
  async repo(cfg: Cfg) {
    return call<{ full_name: string; default_branch: string; permissions?: { push?: boolean } }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}`, { headers: this.headers(cfg) });
  },
  async listPulls(cfg: Cfg) {
    return call<{ number: number; title: string; html_url: string; state: string }[]>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/pulls?state=open&per_page=20`, { headers: this.headers(cfg) });
  },
  async recentCommits(cfg: Cfg, n = 10) {
    return call<{ sha: string; commit: { message: string; author: { date: string } } }[]>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/commits?per_page=${n}`, { headers: this.headers(cfg) });
  },
  /** Creates a branch from base, commits files, opens a PR. Never merges. */
  async createPullRequest(cfg: Cfg, p: { branch: string; title: string; body: string; files?: { path: string; content: string }[] }) {
    const h = { ...this.headers(cfg), "Content-Type": "application/json" };
    const repoInfo = await this.repo(cfg);
    const base = cfg.baseBranch || repoInfo.default_branch;
    const ref = await call<{ object: { sha: string } }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${base}`, { headers: h });
    try {
      await call("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/git/refs`, { method: "POST", headers: h, body: JSON.stringify({ ref: `refs/heads/${p.branch}`, sha: ref.object.sha }) });
    } catch (e) {
      if (!(e instanceof ConnectorError && e.httpStatus === 422)) throw e; // 422 = branch exists (idempotent re-run)
    }
    for (const f of p.files ?? []) {
      let sha: string | undefined;
      try {
        const existing = await call<{ sha: string }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(f.path)}?ref=${p.branch}`, { headers: h });
        sha = existing.sha;
      } catch { /* new file */ }
      await call("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(f.path)}`, {
        method: "PUT", headers: h, body: JSON.stringify({ message: p.title, content: Buffer.from(f.content).toString("base64"), branch: p.branch, sha }),
      });
    }
    const existingPrs = await call<{ number: number; html_url: string }[]>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/pulls?head=${cfg.owner}:${p.branch}&state=open`, { headers: h });
    if (existingPrs[0]) return { number: existingPrs[0].number, url: existingPrs[0].html_url, reused: true };
    const pr = await call<{ number: number; html_url: string }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/pulls`, {
      method: "POST", headers: h, body: JSON.stringify({ title: p.title, head: p.branch, base, body: p.body, draft: true }),
    });
    return { number: pr.number, url: pr.html_url, reused: false };
  },
  async combinedStatus(cfg: Cfg, ref: string) {
    const h = this.headers(cfg);
    const [status, checks] = await Promise.all([
      call<{ state: string; total_count: number }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/commits/${encodeURIComponent(ref)}/status`, { headers: h }),
      call<{ total_count: number; check_runs: { name: string; status: string; conclusion: string | null }[] }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/commits/${encodeURIComponent(ref)}/check-runs`, { headers: h }),
    ]);
    const runs = checks.check_runs ?? [];
    const failed = runs.filter((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion));
    const pending = runs.filter((r) => r.status !== "completed");
    const state = failed.length || status.state === "failure" || status.state === "error" ? "failure" : pending.length || (status.state === "pending" && status.total_count > 0) ? "pending" : runs.length || status.total_count ? "success" : "none";
    return { state, checks: runs.map((r) => `${r.name}: ${r.conclusion ?? r.status}`) };
  },
  async mergePullRequest(cfg: Cfg, number: number, expectedHeadSha?: string) {
    return call<{ merged: boolean; sha: string }>("github", `${this.base}/repos/${cfg.owner}/${cfg.repo}/pulls/${number}/merge`, {
      method: "PUT", headers: { ...this.headers(cfg), "Content-Type": "application/json" }, body: JSON.stringify({ merge_method: "squash", ...(expectedHeadSha ? { sha: expectedHeadSha } : {}) }),
    });
  },
};

export const vercel = {
  base: "https://api.vercel.com",
  q(cfg: Cfg) { return cfg.teamId ? `teamId=${encodeURIComponent(cfg.teamId)}` : ""; },
  h(cfg: Cfg) { return { Authorization: `Bearer ${cfg.token}` }; },
  async project(cfg: Cfg) {
    return call<{ name: string; id: string }>("vercel", `${this.base}/v9/projects/${cfg.projectId}?${this.q(cfg)}`, { headers: this.h(cfg) });
  },
  async deployments(cfg: Cfg, limit = 10) {
    return call<{ deployments: { uid: string; url: string; state?: string; readyState?: string; target?: string | null; created: number; meta?: Record<string, string> }[] }>(
      "vercel", `${this.base}/v6/deployments?projectId=${cfg.projectId}&limit=${limit}&${this.q(cfg)}`, { headers: this.h(cfg) });
  },
  async promote(cfg: Cfg, deploymentId: string) {
    return call("vercel", `${this.base}/v10/projects/${cfg.projectId}/promote/${deploymentId}?${this.q(cfg)}`, { method: "POST", headers: this.h(cfg) });
  },
};

// ───────────────────── Finance / commerce ─────────────────────

export interface RzpPayment { id: string; amount: number; currency: string; status: string; order_id: string | null; method: string; email?: string; contact?: string; created_at: number; notes?: Record<string, string> }

export const razorpay = {
  base: "https://api.razorpay.com/v1",
  h(cfg: Cfg) { return { Authorization: basic(cfg.keyId, cfg.keySecret) }; },
  async payments(cfg: Cfg, fromUnix: number, toUnix: number): Promise<RzpPayment[]> {
    const out: RzpPayment[] = [];
    for (let skip = 0; skip < 2000; skip += 100) {
      const r = await call<{ items: RzpPayment[] }>("razorpay", `${this.base}/payments?from=${fromUnix}&to=${toUnix}&count=100&skip=${skip}`, { headers: this.h(cfg) });
      out.push(...r.items);
      if (r.items.length < 100) break;
    }
    return out;
  },
  async refund(cfg: Cfg, paymentId: string, amountPaise: number, idempotencyKey: string) {
    return call<{ id: string; status: string }>("razorpay", `${this.base}/payments/${paymentId}/refund`, {
      method: "POST", headers: { ...this.h(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, receipt: idempotencyKey.slice(0, 40), notes: { source: "rootellect-ai-os", approval: idempotencyKey } }),
    });
  },
};

const shiprocketTokens = new Map<string, { token: string; exp: number }>();
export interface SrOrder { id: number; channel_order_id: string; status: string; created_at: string; total: string | number; payment_method: string; shipments?: { awb?: string; status?: string }[] }

export const shiprocket = {
  base: "https://apiv2.shiprocket.in/v1/external",
  async token(cfg: Cfg): Promise<string> {
    const hit = shiprocketTokens.get(cfg.email);
    if (hit && hit.exp > Date.now()) return hit.token;
    const r = await call<{ token: string }>("shiprocket", `${this.base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: cfg.email, password: cfg.password }),
    });
    shiprocketTokens.set(cfg.email, { token: r.token, exp: Date.now() + 8 * 24 * 3600_000 }); // tokens last ~10 days
    return r.token;
  },
  async orders(cfg: Cfg, fromDate: string, toDate: string): Promise<SrOrder[]> {
    const t = await this.token(cfg);
    const out: SrOrder[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await call<{ data: SrOrder[]; meta?: { pagination?: { total_pages?: number } } }>("shiprocket", `${this.base}/orders?per_page=100&page=${page}&from=${fromDate}&to=${toDate}`, { headers: { Authorization: `Bearer ${t}` } });
      out.push(...(r.data ?? []));
      if (!r.meta?.pagination?.total_pages || page >= r.meta.pagination.total_pages) break;
    }
    return out;
  },
};

// ───────────────────── Google ─────────────────────

export const ga4 = {
  async runReport(cfg: Cfg, body: object) {
    const t = await serviceAccountToken("ga4", cfg.serviceAccountJson, ["https://www.googleapis.com/auth/analytics.readonly"]);
    return call<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; rowCount?: number }>(
      "ga4", `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`,
      { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  },
};

export const gsc = {
  async query(cfg: Cfg, body: object) {
    const t = await serviceAccountToken("gsc", cfg.serviceAccountJson, ["https://www.googleapis.com/auth/webmasters.readonly"]);
    return call<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
      "gsc", `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}/searchAnalytics/query`,
      { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  },
  async site(cfg: Cfg) {
    const t = await serviceAccountToken("gsc", cfg.serviceAccountJson, ["https://www.googleapis.com/auth/webmasters.readonly"]);
    return call<{ siteUrl: string; permissionLevel: string }>("gsc", `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}`, { headers: { Authorization: `Bearer ${t}` } });
  },
};

export const googleAds = {
  async headers(cfg: Cfg) {
    const t = await refreshTokenAccess("google_ads", cfg.clientId, cfg.clientSecret, cfg.refreshToken);
    return { Authorization: `Bearer ${t}`, "developer-token": cfg.developerToken, "Content-Type": "application/json", ...(cfg.loginCustomerId ? { "login-customer-id": cfg.loginCustomerId.replace(/-/g, "") } : {}) };
  },
  url(cfg: Cfg, path: string) { return `https://googleads.googleapis.com/${cfg.apiVersion || "v26"}/customers/${cfg.customerId.replace(/-/g, "")}/${path}`; },
  async search(cfg: Cfg, query: string) {
    return call<{ results?: Record<string, Record<string, unknown>>[] }>("google_ads", this.url(cfg, "googleAds:search"), { method: "POST", headers: await this.headers(cfg), body: JSON.stringify({ query }) });
  },
  async setBudget(cfg: Cfg, budgetResourceName: string, amountInr: number) {
    return call("google_ads", this.url(cfg, "campaignBudgets:mutate"), {
      method: "POST", headers: await this.headers(cfg),
      body: JSON.stringify({ operations: [{ update: { resourceName: budgetResourceName, amountMicros: String(Math.round(amountInr * 1e6)) }, updateMask: "amount_micros" }] }),
    });
  },
};

export const merchant = {
  async products(cfg: Cfg, pageToken?: string) {
    const t = await serviceAccountToken("merchant", cfg.serviceAccountJson, ["https://www.googleapis.com/auth/content"]);
    return call<{ products?: { name: string; offerId: string; productStatus?: { destinationStatuses?: { reportingContext: string; approvedCountries?: string[]; disapprovedCountries?: string[] }[]; itemLevelIssues?: { code: string; severity: string; description: string }[] } }[]; nextPageToken?: string }>(
      "merchant", `https://merchantapi.googleapis.com/products/v1/accounts/${cfg.merchantId}/products?pageSize=250${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: { Authorization: `Bearer ${t}` } });
  },
};

export const workspace = {
  async token(cfg: Cfg) { return refreshTokenAccess("google_workspace", cfg.clientId, cfg.clientSecret, cfg.refreshToken); },
  async events(cfg: Cfg, timeMin: string, timeMax: string) {
    const t = await this.token(cfg);
    return call<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] }>(
      "google_workspace", `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
      { headers: { Authorization: `Bearer ${t}` } });
  },
};

// ───────────────────── Meta ─────────────────────

export const meta = {
  v(cfg: Cfg) { return cfg.apiVersion || "v26.0"; },
  act(cfg: Cfg) { return cfg.adAccountId.startsWith("act_") ? cfg.adAccountId : `act_${cfg.adAccountId}`; },
  async insights(cfg: Cfg, level: "campaign" | "adset" | "ad", datePreset = "yesterday") {
    const fields = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,action_values,purchase_roas";
    return call<{ data: Record<string, unknown>[] }>("meta_ads", `https://graph.facebook.com/${this.v(cfg)}/${this.act(cfg)}/insights?level=${level}&date_preset=${datePreset}&fields=${fields}&limit=200&access_token=${encodeURIComponent(cfg.accessToken)}`);
  },
  async setDailyBudget(cfg: Cfg, objectId: string, amountInr: number) {
    // Meta budgets are in the account currency's minor unit (paise for INR).
    return call("meta_ads", `https://graph.facebook.com/${this.v(cfg)}/${objectId}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ daily_budget: String(Math.round(amountInr * 100)), access_token: cfg.accessToken }),
    });
  },
  async setStatus(cfg: Cfg, objectId: string, status: "ACTIVE" | "PAUSED") {
    return call("meta_ads", `https://graph.facebook.com/${this.v(cfg)}/${objectId}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ status, access_token: cfg.accessToken }),
    });
  },
};

export const whatsapp = {
  v(cfg: Cfg) { return cfg.apiVersion || "v26.0"; },
  async sendText(cfg: Cfg, to: string, body: string) {
    return call<{ messages: { id: string }[] }>("whatsapp", `https://graph.facebook.com/${this.v(cfg)}/${cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "text", text: { preview_url: false, body: body.slice(0, 4000) } }),
    });
  },
  /** Business-initiated messages outside the 24h window must use an approved template. */
  async sendTemplate(cfg: Cfg, to: string, template: string, lang: string, params: string[]) {
    return call<{ messages: { id: string }[] }>("whatsapp", `https://graph.facebook.com/${this.v(cfg)}/${cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/[^\d]/g, ""), type: "template", template: { name: template, language: { code: lang }, components: params.length ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t.slice(0, 1000) })) }] : [] } }),
    });
  },
};

// ───────────────────── Marketplaces ─────────────────────

export const amazon = {
  async token(cfg: Cfg) {
    const r = await call<{ access_token: string }>("amazon_sp", "https://api.amazon.com/auth/o2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, client_id: cfg.lwaClientId, client_secret: cfg.lwaClientSecret }),
    });
    return r.access_token;
  },
  endpoint(cfg: Cfg) { return cfg.endpoint || "https://sellingpartnerapi-eu.amazon.com"; }, // India is served by the EU endpoint
  async get<T>(cfg: Cfg, path: string): Promise<T> {
    const t = await this.token(cfg);
    return call<T>("amazon_sp", `${this.endpoint(cfg)}${path}`, { headers: { "x-amz-access-token": t } });
  },
  async participations(cfg: Cfg) { return this.get<{ payload: { marketplace: { id: string; name: string } }[] }>(cfg, "/sellers/v1/marketplaceParticipations"); },
  async orders(cfg: Cfg, createdAfterIso: string) {
    return this.get<{ payload: { Orders: { AmazonOrderId: string; OrderStatus: string; OrderTotal?: { Amount: string; CurrencyCode: string }; PurchaseDate: string }[] } }>(
      cfg, `/orders/v0/orders?MarketplaceIds=${cfg.marketplaceId || "A21TJRUUN4KGV"}&CreatedAfter=${encodeURIComponent(createdAfterIso)}`);
  },
  async listings(cfg: Cfg) {
    return this.get<{ items?: { sku: string; summaries?: { status?: string[]; itemName?: string; asin?: string }[]; issues?: { code: string; message: string; severity: string }[] }[] }>(
      cfg, `/listings/2021-08-01/items/${cfg.sellerId}?marketplaceIds=${cfg.marketplaceId || "A21TJRUUN4KGV"}&includedData=summaries,issues&pageSize=20`);
  },
};

// ───────────────────── Email & voice ─────────────────────

export const smtp = {
  transport(cfg: Cfg) {
    return nodemailer.createTransport({ host: cfg.host, port: Number(cfg.port || 587), secure: Number(cfg.port) === 465, auth: { user: cfg.user, pass: cfg.pass } });
  },
  async send(cfg: Cfg, to: string, subject: string, text: string, html?: string) {
    const info = await this.transport(cfg).sendMail({ from: cfg.from, to, subject, text, html });
    return { messageId: info.messageId };
  },
};

export const exotel = {
  base(cfg: Cfg) { return `https://${cfg.subdomain || "api.exotel.com"}/v1/Accounts/${cfg.accountSid}`; },
  h(cfg: Cfg) { return { Authorization: basic(cfg.apiKey, cfg.apiToken) }; },
  /** Connects the founder's phone to an Exotel flow (IVR/voice message) configured in Exotel. */
  async callFounder(cfg: Cfg, founderPhone: string) {
    const body = new URLSearchParams({ From: founderPhone, CallerId: cfg.callerId, Url: `http://my.exotel.com/${cfg.accountSid}/exoml/start_voice/${cfg.flowId}`, CallType: "trans" });
    return call<{ Call?: { Sid: string } }>("exotel", `${this.base(cfg)}/Calls/connect.json`, { method: "POST", headers: { ...this.h(cfg), "Content-Type": "application/x-www-form-urlencoded" }, body });
  },
};

export const omnisend = {
  h(cfg: Cfg) { return { Authorization: `Omnisend-API-Key ${cfg.apiKey}`, "Omnisend-Version": cfg.apiVersion || "2026-03-15" }; },
  async contacts(cfg: Cfg, limit = 1) { return call<{ contacts?: unknown[] }>("omnisend", `https://api.omnisend.com/api/contacts?limit=${limit}`, { headers: this.h(cfg) }); },
  async campaigns(cfg: Cfg) { return call<{ campaigns?: { id: string; name: string; status: string }[] }>("omnisend", `https://api.omnisend.com/api/campaigns?limit=20`, { headers: this.h(cfg) }); },
};

// ───────────────────── Registry of definitions ─────────────────────

const req = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, required: true, ...extra });
const opt = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, required: false, ...extra });
const SA_HELP = "Paste the full service-account JSON key. Grant the service account read access in the product first.";

export const CONNECTORS: ConnectorDef[] = [
  { key: "github", name: "GitHub", category: "Development", mode: "api", docs: "https://docs.github.com/rest",
    description: "Read code and open fix pull requests on the storefront repo. Merging to production requires approval.",
    fields: [req("token", "Fine-grained token", { secret: true, help: "Scope it to the storefront repo: contents + pull requests read/write." }), req("owner", "Owner", { placeholder: "rootellect" }), req("repo", "Repository", { placeholder: "rootellect" }), opt("baseBranch", "Base branch", { placeholder: "main" })],
    capabilities: ["github.read", "github.create_pr", "github.merge_pr"],
    async health(c) { const r = await github.repo(c); return ok(`${r.full_name} · default branch ${r.default_branch}${r.permissions?.push ? "" : " · read-only token"}`); } },
  { key: "vercel", name: "Vercel", category: "Development", mode: "api", docs: "https://vercel.com/docs/rest-api",
    description: "Deployment status and logs; promotion to production requires approval.",
    fields: [req("token", "Access token", { secret: true }), req("projectId", "Project ID"), opt("teamId", "Team ID")],
    capabilities: ["vercel.read", "vercel.promote"],
    async health(c) { const p = await vercel.project(c); return ok(`Project ${p.name}`); } },
  { key: "rootellect_backend", name: "Rootellect storefront API", category: "E-commerce", mode: "api", docs: "docs/integrations.md#storefront",
    description: "Read-only order feed from rootellect.com (endpoint contract in docs/integrations.md). Used to reconcile payments and shipments.",
    fields: [req("baseUrl", "Storefront URL", { placeholder: "https://rootellect.com" }), req("ordersPath", "Orders endpoint path", { placeholder: "/api/ops/orders" }), req("token", "Read-only ops token", { secret: true })],
    capabilities: ["orders.read"],
    async health(c) { await call("rootellect_backend", `${c.baseUrl}${c.ordersPath}?limit=1`, { headers: { Authorization: `Bearer ${c.token}` } }); return ok("Orders endpoint responding"); } },
  { key: "razorpay", name: "Razorpay", category: "Finance", mode: "api", docs: "https://razorpay.com/docs/api/",
    description: "Payments for reconciliation; refunds only through approved requests.",
    fields: [req("keyId", "Key ID"), req("keySecret", "Key secret", { secret: true })],
    capabilities: ["razorpay.read", "razorpay.refund"],
    async health(c) { const now = Math.floor(Date.now() / 1000); await razorpay.payments(c, now - 86400, now); return ok(`Authenticated (${c.keyId.startsWith("rzp_test") ? "TEST mode" : "LIVE mode"})`); } },
  { key: "shiprocket", name: "Shiprocket", category: "E-commerce", mode: "api", docs: "https://apidocs.shiprocket.in/",
    description: "Orders and shipments for fulfilment monitoring and reconciliation.",
    fields: [req("email", "API user email", { help: "Create a dedicated API user in Shiprocket → Settings → API." }), req("password", "API user password", { secret: true })],
    capabilities: ["shiprocket.read", "shiprocket.create_order"],
    async health(c) { await shiprocket.token(c); return ok("Authenticated"); } },
  { key: "ga4", name: "Google Analytics 4", category: "Marketing", mode: "api", docs: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    description: "Funnel, source and purchase-event reporting.",
    fields: [req("propertyId", "Property ID", { placeholder: "123456789" }), req("serviceAccountJson", "Service account JSON", { secret: true, help: SA_HELP })],
    capabilities: ["ga4.read"],
    async health(c) { await ga4.runReport(c, { dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], metrics: [{ name: "sessions" }] }); return ok("Report API responding"); } },
  { key: "gsc", name: "Google Search Console", category: "Marketing", mode: "api", docs: "https://developers.google.com/webmaster-tools",
    description: "Search performance, queries and pages.",
    fields: [req("siteUrl", "Property", { placeholder: "sc-domain:rootellect.com" }), req("serviceAccountJson", "Service account JSON", { secret: true, help: SA_HELP })],
    capabilities: ["gsc.read"],
    async health(c) { const s = await gsc.site(c); return ok(`${s.siteUrl} · ${s.permissionLevel}`); } },
  { key: "google_ads", name: "Google Ads", category: "Marketing", mode: "api", docs: "https://developers.google.com/google-ads/api/docs/start",
    description: "Campaign performance, search terms and budgets (budget changes need approval).",
    fields: [req("customerId", "Customer ID", { placeholder: "123-456-7890" }), opt("loginCustomerId", "Manager (MCC) ID"), req("developerToken", "Developer token", { secret: true }), req("clientId", "OAuth client ID"), req("clientSecret", "OAuth client secret", { secret: true }), req("refreshToken", "OAuth refresh token", { secret: true }), opt("apiVersion", "API version", { placeholder: "v26" })],
    capabilities: ["gads.read", "gads.update_budget"],
    async health(c) { await googleAds.search(c, "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1"); return ok(`Customer ${c.customerId} reachable (${c.apiVersion || "v26"})`); } },
  { key: "merchant", name: "Google Merchant Center", category: "E-commerce", mode: "api", docs: "https://developers.google.com/merchant/api",
    description: "Product approval status and item issues (Merchant API v1).",
    fields: [req("merchantId", "Merchant ID"), req("serviceAccountJson", "Service account JSON", { secret: true, help: SA_HELP })],
    capabilities: ["merchant.read"],
    async health(c) { const r = await merchant.products(c); return ok(`${r.products?.length ?? 0} products visible`); } },
  { key: "meta_ads", name: "Meta Ads", category: "Marketing", mode: "api", docs: "https://developers.facebook.com/docs/marketing-apis",
    description: "Campaign/ad set/ad insights; budget and status changes need approval.",
    fields: [req("adAccountId", "Ad account ID", { placeholder: "act_1234567890" }), req("accessToken", "System user access token", { secret: true }), opt("apiVersion", "Graph API version", { placeholder: "v26.0" })],
    capabilities: ["meta.read", "meta.update_budget", "meta.set_status"],
    async health(c) { await meta.insights(c, "campaign", "yesterday"); return ok(`${meta.act(c)} insights readable (${meta.v(c)})`); } },
  { key: "omnisend", name: "Omnisend", category: "Communication", mode: "api", docs: "https://api-docs.omnisend.com/",
    description: "Contacts, campaigns and flows for CRM monitoring.",
    fields: [req("apiKey", "API key", { secret: true }), opt("apiVersion", "API version", { placeholder: "2026-03-15" })],
    capabilities: ["omnisend.read", "omnisend.send_campaign"],
    async health(c) { await omnisend.contacts(c, 1); return ok("Authenticated"); } },
  { key: "amazon_sp", name: "Amazon Selling Partner API", category: "E-commerce", mode: "api", docs: "https://developer-docs.amazon.com/sp-api/",
    description: "Amazon India orders, listings and issues.",
    fields: [req("sellerId", "Seller ID"), opt("marketplaceId", "Marketplace ID", { placeholder: "A21TJRUUN4KGV (India)" }), req("lwaClientId", "LWA client ID"), req("lwaClientSecret", "LWA client secret", { secret: true }), req("refreshToken", "Refresh token", { secret: true }), opt("endpoint", "Endpoint", { placeholder: "https://sellingpartnerapi-eu.amazon.com" })],
    capabilities: ["amazon.read"],
    async health(c) { const r = await amazon.participations(c); return ok(`Marketplaces: ${r.payload.map((p) => p.marketplace.name).join(", ")}`); } },
  { key: "flipkart", name: "Flipkart Seller", category: "E-commerce", mode: "browser-assisted", docs: "https://seller.flipkart.com/api-docs/",
    description: "Uses Flipkart's Marketplace Seller API if your account has been granted access; otherwise a human-assisted browser checklist.",
    fields: [opt("appId", "Seller API app ID"), opt("appSecret", "Seller API app secret", { secret: true })],
    capabilities: ["browser.assisted"],
    async health(c) {
      if (!c.appId || !c.appSecret) return { status: "PERMISSION_REQUIRED", detail: "No Seller API access configured — checks run as human-assisted browser tasks." };
      await call("flipkart", "https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api", { headers: { Authorization: basic(c.appId, c.appSecret) } });
      return ok("Seller API token issued");
    } },
  { key: "nykaa", name: "Nykaa", category: "E-commerce", mode: "browser-assisted", docs: "",
    description: "No public seller API is assumed. Listing checks run as human-assisted browser tasks.",
    fields: [opt("portalUrl", "Seller portal URL")],
    capabilities: ["browser.assisted"],
    async health() { return { status: "PERMISSION_REQUIRED", detail: "Manual / browser-assisted only." }; } },
  { key: "whatsapp", name: "WhatsApp Business Platform", category: "Communication", mode: "api", docs: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    description: "Founder alerts, approvals and commands; customer messages only through approved requests and templates.",
    fields: [req("phoneNumberId", "Phone number ID"), req("accessToken", "Permanent access token", { secret: true }), req("appSecret", "App secret (webhook signatures)", { secret: true }), req("verifyToken", "Webhook verify token", { secret: true }), opt("alertTemplate", "Approved alert template name", { help: "Needed for messages outside the 24-hour window." }), opt("templateLang", "Template language", { placeholder: "en" }), opt("apiVersion", "Graph API version", { placeholder: "v26.0" })],
    capabilities: ["notify.founder", "whatsapp.send_customer"],
    async health(c) { await call("whatsapp", `https://graph.facebook.com/${whatsapp.v(c)}/${c.phoneNumberId}?fields=display_phone_number,quality_rating`, { headers: { Authorization: `Bearer ${c.accessToken}` } }); return ok("Phone number reachable"); } },
  { key: "smtp", name: "Email (SMTP)", category: "Communication", mode: "api", docs: "",
    description: "Executive reports, incident emails and approval links. Works with Google Workspace, Zoho, SES, etc.",
    fields: [req("host", "SMTP host"), opt("port", "Port", { placeholder: "587" }), req("user", "Username"), req("pass", "Password / app password", { secret: true }), req("from", "From address", { placeholder: "Rootellect OS <ops@rootellect.com>" })],
    capabilities: ["notify.founder"],
    async health(c) { await smtp.transport(c).verify(); return ok("SMTP login succeeded"); } },
  { key: "exotel", name: "Exotel voice", category: "Communication", mode: "api", docs: "https://developer.exotel.com/api/",
    description: "Urgent incident calls (opt-in, calling hours, SEV1 only by default).",
    fields: [req("accountSid", "Account SID"), req("apiKey", "API key"), req("apiToken", "API token", { secret: true }), req("callerId", "ExoPhone (caller ID)"), req("flowId", "Voice flow (app) ID"), opt("subdomain", "API host", { placeholder: "api.exotel.com or api.in.exotel.com" })],
    capabilities: ["notify.founder"],
    async health(c) { await call("exotel", `${exotel.base(c)}.json`, { headers: exotel.h(c) }); return ok("Account reachable"); } },
  { key: "google_workspace", name: "Google Calendar & Gmail", category: "Communication", mode: "api", docs: "https://developers.google.com/calendar/api",
    description: "Executive agenda and deadline detection (read-only by default).",
    fields: [req("clientId", "OAuth client ID"), req("clientSecret", "OAuth client secret", { secret: true }), req("refreshToken", "Refresh token", { secret: true, help: "Scopes: calendar.readonly (gmail.readonly optional)." })],
    capabilities: ["calendar.read"],
    async health(c) { const now = new Date(); await workspace.events(c, now.toISOString(), new Date(now.getTime() + 86400_000).toISOString()); return ok("Calendar readable"); } },
];

export const CONNECTOR_BY_KEY = Object.fromEntries(CONNECTORS.map((c) => [c.key, c]));
