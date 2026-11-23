/**
 * Default risk levels per tool. Stored in the ToolPolicy table at seed time and
 * enforced by the tool gateway (src/core/tools/gateway.ts) — not by prompts.
 *
 *  0 Read only            — runs automatically within granted permissions
 *  1 Draft / sandbox      — runs automatically (drafts, PRs, reports, tests)
 *  2 Pre-authorised       — runs only under a founder standing approval with caps
 *  3 Founder approval     — production, spend, publishing, pricing, outreach, money movement
 *  4 Specialist approval  — legal/regulatory/medical claims, customer data export, irreversible
 */
export interface ToolPolicyDef { key: string; risk: 0 | 1 | 2 | 3 | 4; title: string; external: boolean }

export const TOOL_POLICIES: ToolPolicyDef[] = [
  // Level 0 — read only
  { key: "knowledge.search", risk: 0, title: "Search company knowledge", external: false },
  { key: "metrics.read", risk: 0, title: "Read business metrics", external: false },
  { key: "web.fetch", risk: 0, title: "Fetch a public web page", external: false },
  { key: "qa.synthetic_check", risk: 0, title: "Run production-safe synthetic site checks", external: false },
  { key: "qa.browser_run", risk: 0, title: "Run a read-only browser journey (no orders, no payments)", external: false },
  { key: "connectors.health", risk: 0, title: "Check integration health", external: false },
  { key: "github.read", risk: 0, title: "Read GitHub repository, issues, PRs", external: false },
  { key: "vercel.read", risk: 0, title: "Read Vercel deployments and logs", external: false },
  { key: "razorpay.read", risk: 0, title: "Read Razorpay payments", external: false },
  { key: "shiprocket.read", risk: 0, title: "Read Shiprocket orders and shipments", external: false },
  { key: "ga4.read", risk: 0, title: "Run GA4 reports", external: false },
  { key: "gsc.read", risk: 0, title: "Query Search Console", external: false },
  { key: "gads.read", risk: 0, title: "Query Google Ads", external: false },
  { key: "meta.read", risk: 0, title: "Read Meta Ads insights", external: false },
  { key: "omnisend.read", risk: 0, title: "Read Omnisend data", external: false },
  { key: "amazon.read", risk: 0, title: "Read Amazon SP-API data", external: false },
  { key: "merchant.read", risk: 0, title: "Read Merchant Center product status", external: false },
  { key: "calendar.read", risk: 0, title: "Read calendar", external: false },
  { key: "notify.founder", risk: 0, title: "Notify the founder", external: false },
  // Level 1 — drafts / sandbox
  { key: "report.write", risk: 1, title: "Write a report artifact", external: false },
  { key: "task.propose", risk: 1, title: "Propose a follow-up task", external: false },
  { key: "task.create", risk: 1, title: "Create a task", external: false },
  { key: "task.assign", risk: 1, title: "Assign a task", external: false },
  { key: "knowledge.propose", risk: 1, title: "Propose a knowledge entry (unverified)", external: false },
  { key: "creative.draft", risk: 1, title: "Draft creative or copy", external: false },
  { key: "debate.request", risk: 1, title: "Request a five-round debate", external: false },
  { key: "incident.manage", risk: 1, title: "Open/update an incident", external: false },
  { key: "github.create_pr", risk: 1, title: "Create a branch and pull request (no merge)", external: true },
  { key: "calendar.write", risk: 1, title: "Create a calendar hold", external: true },
  { key: "browser.assisted", risk: 1, title: "Prepare a human-assisted browser session", external: false },
  // Level 3 — founder approval
  { key: "vercel.promote", risk: 3, title: "Promote a deployment to production", external: true },
  { key: "github.merge_pr", risk: 3, title: "Merge a pull request to the production branch", external: true },
  { key: "gads.update_budget", risk: 3, title: "Change a Google Ads campaign budget", external: true },
  { key: "meta.update_budget", risk: 3, title: "Change a Meta ad set/campaign budget", external: true },
  { key: "meta.set_status", risk: 3, title: "Pause or activate a Meta campaign", external: true },
  { key: "omnisend.send_campaign", risk: 3, title: "Send an email campaign", external: true },
  { key: "whatsapp.send_customer", risk: 3, title: "Send WhatsApp messages to customers", external: true },
  { key: "social.publish", risk: 3, title: "Publish social content", external: true },
  { key: "pricing.update", risk: 3, title: "Change a product price", external: true },
  { key: "catalog.update", risk: 3, title: "Change catalog or inventory data", external: true },
  { key: "shiprocket.create_order", risk: 3, title: "Create a Shiprocket order manually", external: true },
  { key: "razorpay.refund", risk: 3, title: "Issue a refund", external: true },
  // Level 4 — specialist / human expert
  { key: "claims.review", risk: 4, title: "Approve a health/efficacy claim for public use", external: false },
  { key: "data.export_customers", risk: 4, title: "Export customer personal data", external: true },
];

export const POLICY_BY_KEY = Object.fromEntries(TOOL_POLICIES.map((p) => [p.key, p]));
