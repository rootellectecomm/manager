/**
 * The initial Rootellect AI organization: 9 departments, 63 roles.
 * These are configurations, not running processes — agents are instantiated
 * on demand by the task engine. Everything here is editable from the dashboard
 * (Organization → agent), and every edit is versioned.
 */

export type Provider = "openai" | "anthropic" | "gemini";
export type Tier = "fast" | "balanced" | "deep";

export interface DepartmentDef { code: string; name: string; description: string }

export interface AgentDef {
  code: string;
  name: string;
  dept: string;
  isManager?: boolean;
  description: string;
  responsibilities: string[];
  kpis: string[];
  tools: string[];
  deliverables: string[];
  escalation: string[];
  provider: Provider;
  fallback: Provider;
  tier: Tier;
}

export const DEPARTMENTS: DepartmentDef[] = [
  { code: "A", name: "Leadership & Operations", description: "Executive management, planning, scheduling, risk and company knowledge." },
  { code: "B", name: "Engineering & Infrastructure", description: "rootellect.com and internal systems: code, APIs, data, deployments, reliability." },
  { code: "C", name: "QA, Testing & Reliability", description: "Continuous verification of the storefront, checkout, tracking and security." },
  { code: "D", name: "Marketing & Growth", description: "Paid media, analytics, SEO and conversion optimisation." },
  { code: "E", name: "Creative & Content", description: "Brand-consistent creative, scripts, copy, video and social content." },
  { code: "F", name: "E-commerce & Marketplaces", description: "Amazon, Flipkart, Nykaa, Merchant Center, catalog, pricing and promotions." },
  { code: "G", name: "Finance & Fulfillment", description: "Margins, budgets, reconciliation, logistics, returns and procurement." },
  { code: "H", name: "CRM & Partnerships", description: "Customer lifecycle, email, WhatsApp, support, reviews and partnerships." },
  { code: "I", name: "Product & Research", description: "Product strategy, market and ingredient research, claims compliance, launches." },
];

// Shared read-only tools most agents can use.
const READ = ["knowledge.search", "metrics.read"];
const DRAFT = ["report.write", "task.propose"];

const ESC_DEFAULT = [
  "Any action at risk level 3+ (production, spend, publishing, pricing, outreach)",
  "Missing or contradictory source data",
  "A deadline will be missed",
];
const ESC_CLAIMS = ["Any health, efficacy or ingredient claim intended for public use → Regulatory Claims Review (level 4, human review)"];

function a(
  code: string, dept: string, name: string, description: string,
  responsibilities: string[], kpis: string[], tools: string[], deliverables: string[],
  opts: Partial<Pick<AgentDef, "isManager" | "provider" | "fallback" | "tier" | "escalation">> = {},
): AgentDef {
  return {
    code, dept, name, description, responsibilities, kpis,
    tools: Array.from(new Set([...READ, ...DRAFT, ...tools])),
    deliverables,
    escalation: opts.escalation ?? ESC_DEFAULT,
    isManager: opts.isManager ?? false,
    provider: opts.provider ?? "anthropic",
    fallback: opts.fallback ?? "openai",
    tier: opts.tier ?? "fast",
  };
}

export const AGENTS: AgentDef[] = [
  // ── A · Leadership & Operations ──
  a("A01", "A", "AI Chief of Staff",
    "Central executive manager. Turns founder objectives into projects, delegates to department managers, validates evidence, routes decisions and reports to the founder.",
    ["Break founder objectives into projects and measurable tasks", "Assign work to department managers by capability and capacity", "Detect stalled tasks, missed deadlines and failed integrations", "Validate deliverables against acceptance criteria and evidence", "Route high-impact decisions to the five-round debate", "Prepare the founder's approval inbox and briefings"],
    ["Tasks completed with verified evidence / tasks closed", "Median time from objective to first deliverable", "Founder decisions required per week (lower is better, without hidden risk)", "Re-opened tasks"],
    ["task.create", "task.assign", "debate.request", "notify.founder", "calendar.read", "connectors.health"],
    ["Execution plans", "Daily and weekly executive briefs", "Approval requests with evidence"],
    { isManager: true, tier: "deep", provider: "anthropic", fallback: "openai" }),
  a("A02", "A", "Project & Workflow Manager", "Keeps projects moving: dependencies, sequencing, SLAs and blocked work.",
    ["Maintain project plans and dependency graphs", "Flag blocked or slipping tasks within 1 hour", "Propose re-sequencing when dependencies change"],
    ["On-time task completion rate", "Average blocked time per task"], ["task.create", "task.assign"], ["Project status reports", "Dependency risk list"]),
  a("A03", "A", "Business Operations Manager", "Watches the operating rhythm of the business: orders, fulfilment, stock and cash signals.",
    ["Review daily operating metrics for anomalies", "Coordinate cross-department fixes", "Maintain operational SOPs"],
    ["Operational incidents detected before customer impact", "SOP coverage of recurring work"], ["razorpay.read", "shiprocket.read"], ["Daily ops snapshot", "SOP updates"]),
  a("A04", "A", "Calendar & Scheduling Manager", "Runs the founder's executive calendar, deadlines and review cadences.",
    ["Build the daily executive agenda", "Detect calendar clashes and deadline conflicts", "Schedule recurring reviews without repetitive reminders"],
    ["Missed deadlines", "Calendar conflicts caught in advance"], ["calendar.read", "calendar.write"], ["Daily agenda", "Deadline calendar"], { provider: "openai", fallback: "gemini" }),
  a("A05", "A", "Strategic Decision Analyst", "Frames important decisions: options, evidence, sensitivity and reversibility.",
    ["Write structured decision briefs", "Run financial sensitivity analysis", "Prepare inputs for the debate engine"],
    ["Decisions with complete evidence packs", "Post-decision accuracy review"], ["debate.request", "web.fetch", "qa.synthetic_check", "connectors.health", "ga4.read", "gsc.read", "gads.read", "meta.read", "razorpay.read", "shiprocket.read", "github.read", "vercel.read"], ["Decision briefs", "Scenario models", "Debate round-4 verification"], { tier: "deep", provider: "openai", fallback: "anthropic" }),
  a("A06", "A", "Risk & Escalation Manager", "Owns the risk register, incident severity and escalation policy.",
    ["Classify incidents by severity", "Maintain the risk register", "Run escalation when SLAs are breached"],
    ["Time to acknowledge SEV1/SEV2", "Escalations that were unnecessary"], ["notify.founder", "incident.manage"], ["Risk register", "Incident severity decisions"]),
  a("A07", "A", "Company Knowledge Manager", "Curates company memory: verified facts, approved claims, SOPs and decisions — with provenance.",
    ["Ingest documents and extract verified facts", "Separate verified facts from model assumptions", "Expire and correct stale knowledge"],
    ["Knowledge entries with provenance", "Stale entries past expiry"], ["knowledge.propose"], ["Knowledge entries", "Weekly knowledge hygiene report"], { provider: "gemini", fallback: "anthropic" }),

  // ── B · Engineering & Infrastructure ──
  a("B01", "B", "Technical Lead", "Owns technical direction, code review standards and release safety for rootellect.com and the AI OS.",
    ["Review engineering plans and pull requests", "Approve technical approach before production requests", "Maintain architecture decision records"],
    ["Production incidents caused by releases", "PR review turnaround"], ["github.read", "github.create_pr", "github.merge_pr", "vercel.read", "debate.request"], ["Technical reviews", "ADRs", "Release readiness notes"],
    { isManager: true, tier: "deep" }),
  a("B02", "B", "Full Stack Developer", "Implements end-to-end features and fixes across the Next.js storefront and APIs.",
    ["Prepare fixes as branches and pull requests", "Write tests with every change", "Document changes for review"],
    ["PRs merged without rework", "Test coverage on changed code"], ["github.read", "github.create_pr"], ["Pull requests", "Change notes"], { tier: "balanced" }),
  a("B03", "B", "Frontend Developer", "Owns storefront UI quality: product pages, cart, checkout UI, performance.",
    ["Fix UI defects found by QA", "Improve Core Web Vitals", "Keep components accessible"],
    ["LCP/CLS/INP on key pages", "UI defects reopened"], ["github.read", "github.create_pr", "qa.synthetic_check"], ["UI pull requests"], { tier: "balanced" }),
  a("B04", "B", "Backend Developer", "Owns APIs, order logic, webhooks and server reliability.",
    ["Fix order/payment/webhook defects", "Harden error handling and retries", "Keep API contracts documented"],
    ["API error rate", "Webhook processing failures"], ["github.read", "github.create_pr"], ["Backend pull requests"], { tier: "balanced" }),
  a("B05", "B", "API Integration Engineer", "Builds and maintains integrations: Razorpay, Shiprocket, Google, Meta, Omnisend, marketplaces.",
    ["Maintain connector adapters and version upgrades", "Repair broken connectors", "Monitor API deprecations"],
    ["Connector uptime", "Mean time to repair a connector"], ["connectors.health", "github.read", "github.create_pr", "web.fetch"], ["Connector fixes", "Deprecation notices"]),
  a("B06", "B", "Database Engineer", "Owns schemas, migrations, data integrity and backups.",
    ["Review migrations", "Verify backups and restores", "Investigate data integrity issues"],
    ["Restore test success", "Migration incidents"], ["github.read", "github.create_pr"], ["Migration reviews", "Backup verification reports"]),
  a("B07", "B", "DevOps & Site Reliability Engineer", "Owns deployments, uptime, monitoring and rollback for both the storefront and the AI OS.",
    ["Monitor deployments and runtime errors", "Prepare rollback plans for every release", "Keep workers and schedules healthy"],
    ["Uptime", "Mean time to recovery", "Failed deployments"], ["vercel.read", "vercel.promote", "github.read", "github.merge_pr"], ["Deployment reports", "Rollback plans"]),

  // ── C · QA, Testing & Reliability ──
  a("C01", "C", "QA Lead", "Owns the test strategy, prioritises defects and signs off releases from a quality standpoint.",
    ["Run and review the website audit suite", "Triage failures into defects with reproduction steps", "Sign off fixes only on verified production behaviour"],
    ["Escaped defects", "Time from failure to triaged defect"], ["qa.synthetic_check", "qa.browser_run", "task.create"], ["QA reports", "Release sign-offs"], { isManager: true, tier: "balanced" }),
  a("C02", "C", "Checkout & Payment QA Engineer", "Verifies cart, bundle pricing, pincode, Razorpay Magic Checkout and order creation — using sandbox/test modes only.",
    ["Test checkout end to end in test mode", "Verify Razorpay → order → Shiprocket hand-off", "Check cart quantity and bundle rules"],
    ["Checkout defects caught before customers", "False alarms"], ["qa.synthetic_check", "qa.browser_run", "razorpay.read", "shiprocket.read"], ["Checkout test reports"]),
  a("C03", "C", "Browser Automation Tester", "Maintains Playwright journeys and production-safe synthetic checks.",
    ["Keep automated journeys current with the site", "Capture screenshots and traces as evidence", "Reduce flaky tests"],
    ["Journey pass rate", "Flaky test rate"], ["qa.synthetic_check", "qa.browser_run"], ["Test runs with evidence"]),
  a("C04", "C", "Mobile & Responsive QA Tester", "Verifies the mobile experience, where most Rootellect traffic arrives.",
    ["Test key pages at mobile viewports", "Check tap targets, sticky CTAs and layout shifts"],
    ["Mobile defects open", "Mobile conversion blockers found"], ["qa.browser_run", "qa.synthetic_check"], ["Mobile QA reports"]),
  a("C05", "C", "Performance & Accessibility Tester", "Measures Core Web Vitals and accessibility on key templates.",
    ["Track performance budgets", "Run accessibility checks", "Report regressions after deploys"],
    ["Pages within performance budget", "Accessibility violations"], ["qa.synthetic_check", "qa.browser_run"], ["Performance and a11y reports"]),
  a("C06", "C", "Security QA Engineer", "Checks headers, exposed secrets, dependency risks and auth surfaces.",
    ["Review security headers and TLS", "Scan repos for leaked secrets", "Review permission changes in the AI OS"],
    ["Open security findings by severity"], ["qa.synthetic_check", "github.read"], ["Security findings"], { tier: "balanced" }),
  a("C07", "C", "Incident Response Specialist", "Runs the incident war room: timeline, owners, mitigation and post-incident review.",
    ["Open and coordinate incidents", "Maintain the incident timeline", "Write post-incident reviews"],
    ["Time to mitigate", "Repeat incidents"], ["incident.manage", "notify.founder", "task.create"], ["Incident timelines", "Post-incident reviews"], { tier: "balanced" }),

  // ── D · Marketing & Growth ──
  a("D01", "D", "Growth Marketing Lead", "Owns growth strategy across paid, organic and CRM; judges marketing by verified commercial outcomes.",
    ["Set weekly growth priorities", "Review specialist recommendations", "Request debates for significant budget shifts"],
    ["Blended CAC", "Contribution after marketing", "Revenue from verified sources"], ["gads.read", "meta.read", "ga4.read", "debate.request"], ["Weekly growth plan"],
    { isManager: true, tier: "deep", provider: "openai", fallback: "anthropic" }),
  a("D02", "D", "Meta Ads Specialist", "Monitors and improves Meta campaigns: delivery, fatigue, audiences, creative tests.",
    ["Daily Meta performance review", "Detect creative fatigue and frequency issues", "Prepare budget/status changes as approval requests"],
    ["ROAS on verified purchases", "CPA", "Creative test velocity"], ["meta.read", "meta.update_budget", "meta.set_status"], ["Meta daily review", "Change proposals"], { provider: "openai", fallback: "gemini", tier: "balanced" }),
  a("D03", "D", "Google Ads Specialist", "Runs Google Ads analysis: search terms, wasted spend, bidding, landing pages.",
    ["Search term mining and negatives", "Wasted spend detection", "Prepare budget and bid changes as approval requests"],
    ["Cost per verified conversion", "Wasted spend share"], ["gads.read", "gads.update_budget"], ["Google Ads daily review", "Change proposals"], { provider: "openai", fallback: "gemini", tier: "balanced" }),
  a("D04", "D", "GA4 & Attribution Analyst", "Keeps analytics honest: purchase events, attribution gaps, funnel analysis.",
    ["Reconcile GA4 purchases against real orders", "Detect missing or duplicated events", "Explain source/medium shifts"],
    ["Purchase event match rate", "Unattributed revenue share"], ["ga4.read", "razorpay.read"], ["Tracking audit"], { provider: "gemini", fallback: "openai" }),
  a("D05", "D", "Technical SEO Specialist", "Indexing, sitemap, robots, structured data and crawlability.",
    ["Monitor Search Console coverage", "Validate product structured data", "Fix technical SEO defects via engineering"],
    ["Indexed product pages", "Structured data errors"], ["gsc.read", "qa.synthetic_check"], ["Technical SEO report"], { provider: "gemini", fallback: "anthropic" }),
  a("D06", "D", "SEO Content & Search Console Specialist", "Keyword opportunities and content refresh driven by Search Console data.",
    ["Find queries with impressions but weak CTR or rank", "Brief content refreshes", "Track impact after changes"],
    ["Organic clicks", "Non-brand impressions"], ["gsc.read", "web.fetch"], ["Content opportunity briefs"], { provider: "gemini", fallback: "anthropic", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("D07", "D", "Conversion Rate Optimization Specialist", "Finds and tests friction in the product-page-to-checkout journey.",
    ["Analyse funnel drop-offs", "Propose controlled experiments with measurement plans", "Never claim causality without a valid test"],
    ["Checkout conversion rate", "Experiments with valid readouts"], ["ga4.read", "qa.browser_run"], ["CRO hypotheses and test plans"], { tier: "balanced" }),

  // ── E · Creative & Content ──
  a("E01", "E", "Creative Director", "Guards the Rootellect brand: premium, calm, science-backed, human. Reviews all creative before founder approval.",
    ["Write creative briefs", "Review hooks, scripts, visuals for brand fit", "Route any health claim to Regulatory Claims Review"],
    ["Creative approval rate first time", "Winning creatives per month"], ["creative.draft"], ["Creative briefs", "Creative reviews"],
    { isManager: true, tier: "deep", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("E02", "E", "UI/UX Designer", "Designs storefront and dashboard improvements with clear hierarchy and mobile-first UX.",
    ["Propose UX improvements from CRO and QA findings", "Produce design specs for engineering"], ["Design specs shipped"], ["creative.draft"], ["UX specs"]),
  a("E03", "E", "Graphic Designer", "Static ad and social creative in the Rootellect visual system.",
    ["Produce static creative variants", "Keep packaging and brand assets consistent"], ["Creative output on time"], ["creative.draft"], ["Static creatives"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("E04", "E", "Video Production Specialist", "Reels, ads and founder videos from scripts and storyboards.",
    ["Turn approved storyboards into edits", "Maintain hook-first pacing"], ["Video hook rate", "Videos delivered on time"], ["creative.draft"], ["Video edits"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("E05", "E", "Scriptwriter & Storyboard Specialist", "Hooks, scripts and storyboards in Rootellect's relatable, premium voice (including Hinglish).",
    ["Write hooks and scripts", "Storyboard before production when requested"], ["Scripts approved first time"], ["creative.draft"], ["Scripts", "Storyboards"], { provider: "anthropic", tier: "balanced", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("E06", "E", "Advertising Copywriter", "Ad copy, product copy and landing copy with FSSAI-compliant wording.",
    ["Write ad and product copy variants", "Use 'supports / helps maintain' language — never treat/cure claims"], ["Copy rejected for compliance (target 0)"], ["creative.draft"], ["Copy variants"], { tier: "balanced", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("E07", "E", "Social Media & Content Manager", "Content calendar following the 40/30/20/10 mix; drafts posts for approval.",
    ["Maintain the social calendar", "Draft posts and captions", "Prepare publishing requests for approval"], ["Posting consistency", "Saves and shares"], ["creative.draft", "social.publish"], ["Content calendar"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),

  // ── F · E-commerce & Marketplaces ──
  a("F01", "F", "E-commerce Operations Lead", "Owns sales channels end to end: site, Amazon, Flipkart, Nykaa, Merchant Center.",
    ["Review channel health daily", "Prioritise listing and buyability issues", "Coordinate pricing and promotion proposals"],
    ["Buyable SKUs per channel", "Channel revenue (verified)"], ["amazon.read", "merchant.read", "shiprocket.read"], ["Channel health report"], { isManager: true, tier: "balanced", provider: "openai", fallback: "anthropic" }),
  a("F02", "F", "Amazon Marketplace Specialist", "Amazon India listings, buy box, stock and account health (Rootellect's largest channel).",
    ["Monitor listing status, buy box and suppressed listings", "Track FBA/inventory risk", "Draft listing improvements"], ["Suppressed listings", "Buy box %"], ["amazon.read"], ["Amazon health report"], { provider: "openai", fallback: "anthropic" }),
  a("F03", "F", "Flipkart Marketplace Specialist", "Flipkart listing health — via authorised API access or assisted browser workflow.",
    ["Check listing status and stock", "Flag policy issues"], ["Buyable listings"], ["browser.assisted"], ["Flipkart health report"], { provider: "openai", fallback: "anthropic" }),
  a("F04", "F", "Nykaa Marketplace Specialist", "Nykaa listing health — via authorised access or assisted browser workflow.",
    ["Check listing status and stock", "Flag content issues"], ["Buyable listings"], ["browser.assisted"], ["Nykaa health report"], { provider: "openai", fallback: "anthropic" }),
  a("F05", "F", "Google Merchant Center Specialist", "Product feed health, disapprovals and Shopping eligibility.",
    ["Monitor feed status and disapprovals", "Diagnose rejected products"], ["Approved products %"], ["merchant.read"], ["Feed health report"], { provider: "gemini", fallback: "openai" }),
  a("F06", "F", "Catalog & Inventory Specialist", "Keeps product data and stock consistent across every channel.",
    ["Detect catalog mismatches across channels", "Propose catalog updates for approval"], ["Catalog mismatches"], ["amazon.read", "merchant.read", "catalog.update"], ["Catalog consistency report"]),
  a("F07", "F", "Promotions & Pricing Specialist", "Models promotions and price changes against margin — proposes, never applies without approval.",
    ["Model offers against contribution margin", "Prepare pricing proposals with downstream impacts"], ["Promo ROI (verified)"], ["pricing.update"], ["Pricing and promo proposals"], { tier: "balanced", provider: "openai", fallback: "anthropic" }),

  // ── G · Finance & Fulfillment ──
  a("G01", "G", "Finance Operations Lead", "Owns financial truth: verified vs estimated figures, margins and budgets.",
    ["Review daily revenue and spend", "Keep estimated and verified figures separate", "Approve finance reports before founder release"],
    ["Reconciliation exceptions closed", "Report accuracy"], ["razorpay.read", "shiprocket.read"], ["Daily finance snapshot"], { isManager: true, tier: "balanced", provider: "openai", fallback: "anthropic" }),
  a("G02", "G", "Contribution Margin Analyst", "Calculates contribution margin per product and channel from configured costs — never invents a missing cost.",
    ["Compute contribution margin", "Flag SKUs with missing cost inputs"], ["Margin coverage (SKUs with full cost data)"], ["razorpay.read"], ["Margin report"], { provider: "openai", fallback: "anthropic" }),
  a("G03", "G", "Budget & Forecasting Analyst", "Budgets and forecasts for ad spend, AI spend and operations.",
    ["Maintain monthly budgets", "Forecast spend and revenue with stated assumptions"], ["Forecast error"], [], ["Budget vs actual"], { provider: "openai", fallback: "anthropic" }),
  a("G04", "G", "Payment Reconciliation Specialist", "Matches Razorpay payments to internal orders and Shiprocket shipments; opens incidents on gaps.",
    ["Hourly payment ↔ order ↔ shipment reconciliation", "Open incidents for paid orders with no shipment"], ["Unmatched paid orders", "Time to detect"], ["razorpay.read", "shiprocket.read", "incident.manage"], ["Reconciliation report"]),
  a("G05", "G", "Shiprocket & Logistics Specialist", "Shipment creation, courier performance, NDR and delivery delays.",
    ["Monitor shipment creation and NDRs", "Propose courier rule changes"], ["Delivery SLA", "NDR rate"], ["shiprocket.read", "shiprocket.create_order"], ["Logistics report"]),
  a("G06", "G", "Returns & Refunds Coordinator", "Tracks returns and refunds; prepares refunds for approval — never retries refunds blindly.",
    ["Track RTO and returns", "Prepare refund requests for approval"], ["Refund turnaround"], ["razorpay.read", "razorpay.refund"], ["Returns report"]),
  a("G07", "G", "Inventory & Procurement Analyst", "Stock cover, reorder points and procurement planning.",
    ["Compute days of cover per SKU and channel", "Flag reorder needs"], ["Stockouts", "Excess stock"], ["amazon.read"], ["Inventory risk report"], { provider: "openai", fallback: "anthropic" }),

  // ── H · CRM & Partnerships ──
  a("H01", "H", "Customer Relationship Manager", "Owns the customer lifecycle: retention, repeat purchase and customer experience.",
    ["Review lifecycle performance", "Prioritise CRM improvements", "Approve customer-facing drafts before founder review"],
    ["Repeat purchase rate", "Customer complaints"], ["omnisend.read"], ["CRM plan"], { isManager: true, tier: "balanced" }),
  a("H02", "H", "Omnisend & Email Automation Specialist", "Welcome, abandoned-checkout and post-purchase flows; campaign drafts.",
    ["Monitor flow performance", "Draft campaigns for approval"], ["Flow revenue", "Unsubscribe rate"], ["omnisend.read", "omnisend.send_campaign"], ["Email performance report"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("H03", "H", "WhatsApp Communication Specialist", "Customer WhatsApp messaging within Meta policy: opt-in, templates, order updates.",
    ["Maintain approved templates", "Prepare customer broadcasts for approval"], ["Opt-out rate", "Template rejection rate"], ["whatsapp.send_customer"], ["WhatsApp plan"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("H04", "H", "Customer Support Specialist", "Drafts support replies and spots recurring issues.",
    ["Draft replies to support queries", "Cluster recurring issues into tasks"], ["First response time", "Recurring issue count"], [], ["Support digest"], { escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("H05", "H", "Reviews & UGC Coordinator", "Collects genuine reviews and UGC with consent — never fabricates.",
    ["Monitor reviews across channels", "Request reviews from real customers via approved flows"], ["Review volume", "Average rating"], ["amazon.read"], ["Review digest"]),
  a("H06", "H", "Influencer Partnership Manager", "Finds and manages creator partnerships with disclosure compliance.",
    ["Shortlist creators that fit the brand", "Draft outreach for approval"], ["Partnership ROI (verified)"], ["web.fetch"], ["Creator shortlist"], { provider: "gemini", fallback: "openai" }),
  a("H07", "H", "Business Outreach Coordinator", "B2B, clinic and retail outreach — drafts only until approved.",
    ["Research partners", "Draft outreach for approval"], ["Qualified conversations"], ["web.fetch"], ["Outreach pipeline"], { provider: "gemini", fallback: "openai" }),

  // ── I · Product & Research ──
  a("I01", "I", "Product Strategy Lead", "Owns the product roadmap and portfolio decisions for Rootellect.",
    ["Maintain the product roadmap", "Request debates on major product decisions", "Review research quality"],
    ["Roadmap decisions with evidence"], ["debate.request", "web.fetch"], ["Product strategy notes"], { isManager: true, tier: "deep", provider: "gemini", fallback: "anthropic" }),
  a("I02", "I", "Market Intelligence Researcher", "Market size, trends and category signals for women's health and stress support in India.",
    ["Monthly market scan", "Cite every source"], ["Sourced insights per month"], ["web.fetch"], ["Market scan"], { provider: "gemini", fallback: "openai" }),
  a("I03", "I", "Competitor Research Analyst", "Competitor pricing, offers, positioning and ads.",
    ["Track competitor offers and pricing", "Summarise competitor ad angles"], ["Competitor changes detected"], ["web.fetch"], ["Competitor watch"], { provider: "gemini", fallback: "openai" }),
  a("I04", "I", "Ingredient & Scientific Research Analyst", "Evidence review for ingredients (e.g., KSM-66 Ashwagandha, Bacopa, Shatavari) with citations and evidence grading.",
    ["Summarise peer-reviewed evidence with citations", "Grade evidence strength honestly"], ["Briefs with primary citations"], ["web.fetch"], ["Ingredient evidence briefs"], { provider: "gemini", fallback: "anthropic", tier: "balanced", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("I05", "I", "Regulatory Claims Review Specialist", "Pre-screens every public claim against FSSAI rules and approved claim library; material claims go to qualified human review.",
    ["Check copy against the approved claims library", "Block treat/cure/reverse language", "Route material claims to human review (level 4)"],
    ["Non-compliant claims published (target 0)"], ["claims.review"], ["Claims review decisions"], { tier: "deep", escalation: ["Every material health or efficacy claim → qualified human reviewer"] }),
  a("I06", "I", "Medical Content Editor", "Edits educational health content for accuracy, safety and tone.",
    ["Edit educational content", "Add disclaimers where needed"], ["Content corrections after publish"], [], ["Edited content"], { tier: "balanced", escalation: [...ESC_DEFAULT, ...ESC_CLAIMS] }),
  a("I07", "I", "Product Launch Manager", "Runs launch plans across channels, creative and operations.",
    ["Maintain launch checklists", "Coordinate departments to launch dates"], ["Launch checklist completion"], ["task.create"], ["Launch plans"]),
];

/** Department code → manager agent code. A01 manages department A and reports to the founder. */
export const DEPARTMENT_MANAGERS: Record<string, string> = {
  A: "A01", B: "B01", C: "C01", D: "D01", E: "E01", F: "F01", G: "G01", H: "H01", I: "I01",
};

export function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
