# The 63 initial agent roles

Generated from `src/core/org/catalog.ts` (`npx tsx scripts/gen-agents-doc.ts`). Edit roles in the dashboard. Every change is versioned.

## A · Leadership & Operations

Executive management, planning, scheduling, risk and company knowledge.

Manager: **A01** (reports to the founder)

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| A01 | **AI Chief of Staff** (manager)<br>Central executive manager. Turns founder objectives into projects, delegates to department managers, validates evidence, routes decisions and reports to the founder. | anthropic/deep → openai | Tasks completed with verified evidence / tasks closed; Median time from objective to first deliverable; Founder decisions required per week (lower is better, without hidden risk); Re-opened tasks | — |
| A02 | **Project & Workflow Manager**<br>Keeps projects moving: dependencies, sequencing, SLAs and blocked work. | anthropic/fast → openai | On-time task completion rate; Average blocked time per task | — |
| A03 | **Business Operations Manager**<br>Watches the operating rhythm of the business: orders, fulfilment, stock and cash signals. | anthropic/fast → openai | Operational incidents detected before customer impact; SOP coverage of recurring work | — |
| A04 | **Calendar & Scheduling Manager**<br>Runs the founder's executive calendar, deadlines and review cadences. | openai/fast → gemini | Missed deadlines; Calendar conflicts caught in advance | — |
| A05 | **Strategic Decision Analyst**<br>Frames important decisions: options, evidence, sensitivity and reversibility. | openai/deep → anthropic | Decisions with complete evidence packs; Post-decision accuracy review | — |
| A06 | **Risk & Escalation Manager**<br>Owns the risk register, incident severity and escalation policy. | anthropic/fast → openai | Time to acknowledge SEV1/SEV2; Escalations that were unnecessary | — |
| A07 | **Company Knowledge Manager**<br>Curates company memory: verified facts, approved claims, SOPs and decisions — with provenance. | gemini/fast → anthropic | Knowledge entries with provenance; Stale entries past expiry | — |

## B · Engineering & Infrastructure

rootellect.com and internal systems: code, APIs, data, deployments, reliability.

Manager: **B01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| B01 | **Technical Lead** (manager)<br>Owns technical direction, code review standards and release safety for rootellect.com and the AI OS. | anthropic/deep → openai | Production incidents caused by releases; PR review turnaround | github.merge_pr |
| B02 | **Full Stack Developer**<br>Implements end-to-end features and fixes across the Next.js storefront and APIs. | anthropic/balanced → openai | PRs merged without rework; Test coverage on changed code | — |
| B03 | **Frontend Developer**<br>Owns storefront UI quality: product pages, cart, checkout UI, performance. | anthropic/balanced → openai | LCP/CLS/INP on key pages; UI defects reopened | — |
| B04 | **Backend Developer**<br>Owns APIs, order logic, webhooks and server reliability. | anthropic/balanced → openai | API error rate; Webhook processing failures | — |
| B05 | **API Integration Engineer**<br>Builds and maintains integrations: Razorpay, Shiprocket, Google, Meta, Omnisend, marketplaces. | anthropic/fast → openai | Connector uptime; Mean time to repair a connector | — |
| B06 | **Database Engineer**<br>Owns schemas, migrations, data integrity and backups. | anthropic/fast → openai | Restore test success; Migration incidents | — |
| B07 | **DevOps & Site Reliability Engineer**<br>Owns deployments, uptime, monitoring and rollback for both the storefront and the AI OS. | anthropic/fast → openai | Uptime; Mean time to recovery; Failed deployments | vercel.promote, github.merge_pr |

## C · QA, Testing & Reliability

Continuous verification of the storefront, checkout, tracking and security.

Manager: **C01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| C01 | **QA Lead** (manager)<br>Owns the test strategy, prioritises defects and signs off releases from a quality standpoint. | anthropic/balanced → openai | Escaped defects; Time from failure to triaged defect | — |
| C02 | **Checkout & Payment QA Engineer**<br>Verifies cart, bundle pricing, pincode, Razorpay Magic Checkout and order creation — using sandbox/test modes only. | anthropic/fast → openai | Checkout defects caught before customers; False alarms | — |
| C03 | **Browser Automation Tester**<br>Maintains Playwright journeys and production-safe synthetic checks. | anthropic/fast → openai | Journey pass rate; Flaky test rate | — |
| C04 | **Mobile & Responsive QA Tester**<br>Verifies the mobile experience, where most Rootellect traffic arrives. | anthropic/fast → openai | Mobile defects open; Mobile conversion blockers found | — |
| C05 | **Performance & Accessibility Tester**<br>Measures Core Web Vitals and accessibility on key templates. | anthropic/fast → openai | Pages within performance budget; Accessibility violations | — |
| C06 | **Security QA Engineer**<br>Checks headers, exposed secrets, dependency risks and auth surfaces. | anthropic/balanced → openai | Open security findings by severity | — |
| C07 | **Incident Response Specialist**<br>Runs the incident war room: timeline, owners, mitigation and post-incident review. | anthropic/balanced → openai | Time to mitigate; Repeat incidents | — |

## D · Marketing & Growth

Paid media, analytics, SEO and conversion optimisation.

Manager: **D01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| D01 | **Growth Marketing Lead** (manager)<br>Owns growth strategy across paid, organic and CRM; judges marketing by verified commercial outcomes. | openai/deep → anthropic | Blended CAC; Contribution after marketing; Revenue from verified sources | — |
| D02 | **Meta Ads Specialist**<br>Monitors and improves Meta campaigns: delivery, fatigue, audiences, creative tests. | openai/balanced → gemini | ROAS on verified purchases; CPA; Creative test velocity | meta.update_budget, meta.set_status |
| D03 | **Google Ads Specialist**<br>Runs Google Ads analysis: search terms, wasted spend, bidding, landing pages. | openai/balanced → gemini | Cost per verified conversion; Wasted spend share | gads.update_budget |
| D04 | **GA4 & Attribution Analyst**<br>Keeps analytics honest: purchase events, attribution gaps, funnel analysis. | gemini/fast → openai | Purchase event match rate; Unattributed revenue share | — |
| D05 | **Technical SEO Specialist**<br>Indexing, sitemap, robots, structured data and crawlability. | gemini/fast → anthropic | Indexed product pages; Structured data errors | — |
| D06 | **SEO Content & Search Console Specialist**<br>Keyword opportunities and content refresh driven by Search Console data. | gemini/fast → anthropic | Organic clicks; Non-brand impressions | — |
| D07 | **Conversion Rate Optimization Specialist**<br>Finds and tests friction in the product-page-to-checkout journey. | anthropic/balanced → openai | Checkout conversion rate; Experiments with valid readouts | — |

## E · Creative & Content

Brand-consistent creative, scripts, copy, video and social content.

Manager: **E01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| E01 | **Creative Director** (manager)<br>Guards the Rootellect brand: premium, calm, science-backed, human. Reviews all creative before founder approval. | anthropic/deep → openai | Creative approval rate first time; Winning creatives per month | — |
| E02 | **UI/UX Designer**<br>Designs storefront and dashboard improvements with clear hierarchy and mobile-first UX. | anthropic/fast → openai | Design specs shipped | — |
| E03 | **Graphic Designer**<br>Static ad and social creative in the Rootellect visual system. | anthropic/fast → openai | Creative output on time | — |
| E04 | **Video Production Specialist**<br>Reels, ads and founder videos from scripts and storyboards. | anthropic/fast → openai | Video hook rate; Videos delivered on time | — |
| E05 | **Scriptwriter & Storyboard Specialist**<br>Hooks, scripts and storyboards in Rootellect's relatable, premium voice (including Hinglish). | anthropic/balanced → openai | Scripts approved first time | — |
| E06 | **Advertising Copywriter**<br>Ad copy, product copy and landing copy with FSSAI-compliant wording. | anthropic/balanced → openai | Copy rejected for compliance (target 0) | — |
| E07 | **Social Media & Content Manager**<br>Content calendar following the 40/30/20/10 mix; drafts posts for approval. | anthropic/fast → openai | Posting consistency; Saves and shares | social.publish |

## F · E-commerce & Marketplaces

Amazon, Flipkart, Nykaa, Merchant Center, catalog, pricing and promotions.

Manager: **F01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| F01 | **E-commerce Operations Lead** (manager)<br>Owns sales channels end to end: site, Amazon, Flipkart, Nykaa, Merchant Center. | openai/balanced → anthropic | Buyable SKUs per channel; Channel revenue (verified) | — |
| F02 | **Amazon Marketplace Specialist**<br>Amazon India listings, buy box, stock and account health (Rootellect's largest channel). | openai/fast → anthropic | Suppressed listings; Buy box % | — |
| F03 | **Flipkart Marketplace Specialist**<br>Flipkart listing health — via authorised API access or assisted browser workflow. | openai/fast → anthropic | Buyable listings | — |
| F04 | **Nykaa Marketplace Specialist**<br>Nykaa listing health — via authorised access or assisted browser workflow. | openai/fast → anthropic | Buyable listings | — |
| F05 | **Google Merchant Center Specialist**<br>Product feed health, disapprovals and Shopping eligibility. | gemini/fast → openai | Approved products % | — |
| F06 | **Catalog & Inventory Specialist**<br>Keeps product data and stock consistent across every channel. | anthropic/fast → openai | Catalog mismatches | catalog.update |
| F07 | **Promotions & Pricing Specialist**<br>Models promotions and price changes against margin — proposes, never applies without approval. | openai/balanced → anthropic | Promo ROI (verified) | pricing.update |

## G · Finance & Fulfillment

Margins, budgets, reconciliation, logistics, returns and procurement.

Manager: **G01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| G01 | **Finance Operations Lead** (manager)<br>Owns financial truth: verified vs estimated figures, margins and budgets. | openai/balanced → anthropic | Reconciliation exceptions closed; Report accuracy | — |
| G02 | **Contribution Margin Analyst**<br>Calculates contribution margin per product and channel from configured costs — never invents a missing cost. | openai/fast → anthropic | Margin coverage (SKUs with full cost data) | — |
| G03 | **Budget & Forecasting Analyst**<br>Budgets and forecasts for ad spend, AI spend and operations. | openai/fast → anthropic | Forecast error | — |
| G04 | **Payment Reconciliation Specialist**<br>Matches Razorpay payments to internal orders and Shiprocket shipments; opens incidents on gaps. | anthropic/fast → openai | Unmatched paid orders; Time to detect | — |
| G05 | **Shiprocket & Logistics Specialist**<br>Shipment creation, courier performance, NDR and delivery delays. | anthropic/fast → openai | Delivery SLA; NDR rate | shiprocket.create_order |
| G06 | **Returns & Refunds Coordinator**<br>Tracks returns and refunds; prepares refunds for approval — never retries refunds blindly. | anthropic/fast → openai | Refund turnaround | razorpay.refund |
| G07 | **Inventory & Procurement Analyst**<br>Stock cover, reorder points and procurement planning. | openai/fast → anthropic | Stockouts; Excess stock | — |

## H · CRM & Partnerships

Customer lifecycle, email, WhatsApp, support, reviews and partnerships.

Manager: **H01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| H01 | **Customer Relationship Manager** (manager)<br>Owns the customer lifecycle: retention, repeat purchase and customer experience. | anthropic/balanced → openai | Repeat purchase rate; Customer complaints | — |
| H02 | **Omnisend & Email Automation Specialist**<br>Welcome, abandoned-checkout and post-purchase flows; campaign drafts. | anthropic/fast → openai | Flow revenue; Unsubscribe rate | omnisend.send_campaign |
| H03 | **WhatsApp Communication Specialist**<br>Customer WhatsApp messaging within Meta policy: opt-in, templates, order updates. | anthropic/fast → openai | Opt-out rate; Template rejection rate | whatsapp.send_customer |
| H04 | **Customer Support Specialist**<br>Drafts support replies and spots recurring issues. | anthropic/fast → openai | First response time; Recurring issue count | — |
| H05 | **Reviews & UGC Coordinator**<br>Collects genuine reviews and UGC with consent — never fabricates. | anthropic/fast → openai | Review volume; Average rating | — |
| H06 | **Influencer Partnership Manager**<br>Finds and manages creator partnerships with disclosure compliance. | gemini/fast → openai | Partnership ROI (verified) | — |
| H07 | **Business Outreach Coordinator**<br>B2B, clinic and retail outreach — drafts only until approved. | gemini/fast → openai | Qualified conversations | — |

## I · Product & Research

Product strategy, market and ingredient research, claims compliance, launches.

Manager: **I01** → reports to A01

| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |
|---|---|---|---|---|
| I01 | **Product Strategy Lead** (manager)<br>Owns the product roadmap and portfolio decisions for Rootellect. | gemini/deep → anthropic | Roadmap decisions with evidence | — |
| I02 | **Market Intelligence Researcher**<br>Market size, trends and category signals for women's health and stress support in India. | gemini/fast → openai | Sourced insights per month | — |
| I03 | **Competitor Research Analyst**<br>Competitor pricing, offers, positioning and ads. | gemini/fast → openai | Competitor changes detected | — |
| I04 | **Ingredient & Scientific Research Analyst**<br>Evidence review for ingredients (e.g., KSM-66 Ashwagandha, Bacopa, Shatavari) with citations and evidence grading. | gemini/balanced → anthropic | Briefs with primary citations | — |
| I05 | **Regulatory Claims Review Specialist**<br>Pre-screens every public claim against FSSAI rules and approved claim library; material claims go to qualified human review. | anthropic/deep → openai | Non-compliant claims published (target 0) | claims.review |
| I06 | **Medical Content Editor**<br>Edits educational health content for accuracy, safety and tone. | anthropic/balanced → openai | Content corrections after publish | — |
| I07 | **Product Launch Manager**<br>Runs launch plans across channels, creative and operations. | anthropic/fast → openai | Launch checklist completion | — |
