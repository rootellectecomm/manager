# Controlled rollout (Phase 8)

All 63 agents are configured on day one and **start in shadow mode**: they can read, analyse, draft and propose, but their level 2+ proposals can't execute even if approved. You promote an agent to **Active** on its page once its track record justifies it.

## Stage 1: Foundation & monitoring (week 1)
- Connect AI providers, GitHub (read + PR), Vercel (read), SMTP, WhatsApp.
- Active: **A01 Chief of Staff, A02 Project & Workflow, C01 QA Lead, C03 Browser Automation Tester, B05 API Integration Engineer**.
- Watch: website audit, storefront heartbeat, connector health, executive brief.
- Exit when audits produce no false SEV1s for 5 days and briefs match reality.

## Stage 2: Protect revenue & checkout (weeks 2–3)
- Connect Razorpay (test key → live read key), Shiprocket, GA4, storefront ops endpoint.
- Active: **G01, G04 Payment Reconciliation, C02 Checkout QA, D04 GA4 Analyst, B01 Technical Lead, B02 Full Stack Developer, B07 DevOps**.
- Allow B01/B07 to execute **approved** merges/promotions. Every one still needs your click.
- Exit when reconciliation runs hourly with no unexplained gaps and one real fix has gone audit → PR → approval → verified.

## Stage 3: Marketing & business intelligence (weeks 3–5)
- Connect Google Ads, Meta Ads, Search Console, Merchant Center, Amazon SP-API, Omnisend.
- Active: **D01–D07, F01, F02, F05**. Keep budget/status changes at level 3 (your approval).
- Optional: give a standing approval (level 2) for small, reversible changes, e.g. Meta budget changes ≤ ₹300 per action and ≤ ₹1,000/day. Only after 2 weeks of correct proposals.

## Stage 4: Expand the workforce (week 6+)
- Creative (E), CRM (H), Product & Research (I), remaining Finance/Commerce roles.
- Claims, medical content and anything public stay behind **I05 Regulatory Claims Review** plus a named human reviewer (level 4).

## Promotion checklist for any agent
- [ ] ≥ 10 proposals reviewed, ≥ 90% you'd have approved as written
- [ ] No unsupported "verified" findings flagged by its manager
- [ ] No compliance (claims linter) issues in the last 2 weeks
- [ ] Cost per task within its monthly budget
- [ ] Its manager is Active

## Before enabling any consequential autonomy
- [ ] `npm run verify` green on the host
- [ ] Failure drills done once: stop the worker mid-audit and restart; expire a token; reject an approval; trigger emergency stop
- [ ] Backup + restore tested
- [ ] Two-factor sign-in on
- [ ] Watchdog running on a separate host or service
