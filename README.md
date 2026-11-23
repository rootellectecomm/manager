# Rootellect AI OS

The founder control plane for Rootellect's AI organisation: **Founder → AI Chief of Staff → 9 department managers → 63 specialised agents**, with durable workflows, a three‑model debate engine, a tool gateway that enforces your approval policy in code, and a hash‑chained audit log.

It runs **separately from rootellect.com**. It reads from (and, only with your approval, writes to) the storefront and your accounts through scoped integrations, so a failure here can never take the store down.

> **Going live:** dashboard on Vercel, database on Neon, worker on Railway. Step-by-step in [`docs/deploy.md`](docs/deploy.md).
>
> **Status (20 Nov 2026):** Phases 1–8 are implemented and pass 39 automated tests, including the full 17‑step acceptance scenario. Integrations are built against current official APIs, but none has been tested against **your** live accounts yet. Every connector shows *Disconnected* until an authenticated call succeeds. See [`docs/acceptance-report.md`](docs/acceptance-report.md) for exactly what is working, simulated, manual-only, or pending.

---

## Quick start (Windows, macOS or Linux)

You need **Node.js 22.5+** and Git. From this folder:

You also need a Postgres database: your **Neon** project (`.env.local` holds its URLs, see [`docs/deploy.md`](docs/deploy.md)), or `npm run db:local` for a throwaway local Postgres.

```bash
npm install                     # also generates the database client
npm run setup                   # creates .env with fresh secrets, migrates the DB, seeds the 63 agents
npm run founder:create          # your login (email, WhatsApp number, password ≥ 12 chars)
npx playwright install chromium # optional: browser journeys, screenshots and traces
```

Then run the three processes, each in its own terminal:

```bash
npm run dev        # dashboard → http://localhost:3100
npm run worker     # schedules, workflows, notifications (must be running for anything to happen)
npm run watchdog   # alerts you out-of-band if the worker stops
```

For production use `npm run build && npm start` instead of `npm run dev`.

**Back up the `MASTER_KEY` from `.env`** (password manager). It encrypts every API key and credential. If you lose it you'll need to re-enter them.

### First 30 minutes in the dashboard

1. **Settings → AI Providers**: paste OpenAI, Anthropic and Gemini keys. Models are discovered live, so pick a model for each tier (fast / balanced / deep) and add prices if you want costs marked *verified* instead of *estimate*.
2. **Settings → Two-factor sign-in**: turn it on.
3. **Integration Hub**: connect in this order. GitHub and Vercel, then Razorpay (use the **test** key first) and Shiprocket, then GA4 and Search Console, then Meta Ads and Google Ads, then email (SMTP) and WhatsApp. Setup notes for each are in [`docs/integrations.md`](docs/integrations.md).
4. **Settings → Founder & storefront**: confirm the storefront URL and quiet hours.
5. Type **"Start a website audit"** in the command bar.
6. Leave every agent in **shadow mode** for the first 1–2 weeks. Read their proposals in the Approval Inbox. Promote an agent to *Active* only once its proposals have been consistently right (see [`docs/rollout.md`](docs/rollout.md)).

---

## What's inside

| Module | Where | What it does |
|---|---|---|
| Mission Control | `/` | KPIs, priority decisions, alerts, live work, objective box |
| HQ · Live Office | `/office` | 2D office driven by real records: agents walk to desks when assigned, queue at your door for approvals, meet in the boardroom for debates; click anyone for a standup report or to assign work |
| Approval Inbox | `/approvals` | Exact parameters, evidence, rollback, expiry; Approve / Reject / Request changes / Defer / Delegate |
| Task Command Center | `/tasks` | Lifecycle NEW → … → VERIFIED → COMPLETED; dependencies, overrides, workflow runs |
| AI Organization | `/organization` | 63 agents: responsibilities, KPIs, tools, models, budgets, versioned edits, duplicate/pause |
| Agent Debate Room | `/debates` | Five-round, three-provider deliberations with dissent and evidence scoring |
| Business / Marketing Intelligence | `/business`, `/marketing` | Verified vs estimated figures, reconciliation, margin inputs, ads/GA4/SEO reviews |
| Browser Operations | `/qa` | Synthetic checks, Playwright journeys, screenshots, traces, heartbeat |
| Incident War Room | `/incidents` | Shared timeline, root cause, owners, alert acknowledgement |
| Calendar & Comms | `/comms` | Agenda, deadlines, escalation policy, every notification with delivery status |
| Knowledge Center | `/knowledge` | Company memory with provenance; verified vs assumed; versioned corrections |
| Integration Hub | `/integrations` | 18 connectors, encrypted credentials, health and repair |
| AI Cost Center | `/costs` | Spend by provider/model/agent; company, debate and agent budgets |
| Audit & Security | `/audit` | Searchable hash-chained log; one-click integrity verification |
| Command bar | everywhere (Ctrl K) | "Show pending approvals", "Pause all production-changing actions", objectives, questions |

### The safety model in one paragraph

Agents never call APIs directly. Every action goes through **one tool gateway** (`src/core/tools/gateway.ts`), which checks emergency stop, the production pause, the agent's own tool allowlist, shadow mode, and the tool's risk level (0 read-only · 1 draft · 2 pre-authorised with caps · 3 founder approval · 4 named specialist reviewer). For level 3–4 the gateway requires an **approved request whose parameter hash matches exactly**, so an agent cannot change the amount after you approve. External side effects run once per idempotency key. An interrupted payment, refund, message or publish is **never retried automatically**; it is flagged for you to check. Only an authenticated founder session can decide approvals. No AI identity can approve anything, change its own permissions, or edit policies.

---

## Commands

| | |
|---|---|
| `npm run verify` | typecheck + lint + all tests + production build |
| `npm test` | 39 tests: foundation, gateway failure cases, durability, debate, notifications, acceptance |
| `npm run db:backup` | `pg_dump` backup (Neon also has point-in-time restore) |
| `npm run db:local` | throwaway local Postgres for development |
| `npm run qa:browser -- home_to_cart https://rootellect.com` | one Playwright journey from the CLI |

## Layout

```
src/core/            the operating system (framework-free, testable)
  org/               63-agent catalog + versioned registry
  tasks/             lifecycle state machine + task service
  ai/                provider adapters, router, budgets, agent runner, debate engine, simulated provider
  workflows/         durable engine, cron (IST), schedules, all workflow definitions
  tools/             risk policies, tool implementations, the gateway
  connectors/        18 integrations, Google auth, health/repair
  comms/             alerts, escalation, notifications, WhatsApp inbound
  qa/                synthetic checks, Playwright journeys
  knowledge/         company memory
src/app/             Next.js dashboard (server components + server actions, all auth-checked)
src/worker/          worker + independent watchdog
prisma/              schema, migrations, seed
tests/               unit, failure-case and acceptance tests
docs/                ADR, runbook, integrations, rollout, acceptance report
```

Read next: [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) · [`docs/runbook.md`](docs/runbook.md) · [`docs/acceptance-report.md`](docs/acceptance-report.md)
