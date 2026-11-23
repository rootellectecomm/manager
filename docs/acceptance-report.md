# Acceptance report — 20 Nov 2026

Verification run on the build host: `npm run verify` → **typecheck ✓ · lint ✓ · 39/39 tests ✓ · production build ✓**. The dashboard was also exercised in a real browser (sign-in, command bar, website audit, approval decision, dark mode, mobile width, unauthenticated access refused).

**Legend:** ✅ working and covered by automated tests · 🟡 implemented against current official API docs, **not yet tested against your live account** · 🔵 runs on the *simulated* AI provider until you add keys (outputs are labelled SIMULATED) · ✋ manual by design (a human executes the approved action) · ⏳ pending

## Acceptance scenario (master prompt §26)

`tests/acceptance/website-audit.test.ts`. Real: HTTP checks against a local storefront, a Playwright browser journey with screenshots and trace, the workflow engine, gateway, approvals and audit log. Mocked: the GitHub REST API (fetch interception) and the AI models (simulated).

| # | Step | Status |
|---|---|---|
| 1 | Founder requests audit from the dashboard command bar | ✅ |
| 2 | Chief of Staff creates a project; assigns QA (C01) and Engineering (B02) | ✅ |
| 3 | Browser service runs authorised tests | ✅ synthetic suite + Playwright journey |
| 4 | Results, traces, screenshots stored | ✅ (files verified on disk) |
| 5 | Detected issue becomes a tracked task (most severe first) | ✅ |
| 6 | Agents investigate and recommend a fix | ✅ 🔵 |
| 7 | Manager validates | ✅ 🔵 (deterministic checks are real) |
| 8 | Five-round, three-provider debate when important | ✅ 🔵 (a simulated panel can never be "Consensus Supported") |
| 9 | Code fix prepared as a branch + draft PR | ✅ (GitHub mocked) · 🟡 live |
| 10 | Automated tests run (CI status read from GitHub checks) | ✅ (mocked) · 🟡 live |
| 11 | Production approval request reaches the founder | ✅ dashboard + email queue |
| 12 | Founder approves/rejects through an authenticated control | ✅ both paths tested |
| 13 | Deployment only after approval | ✅ merge executes exactly once, only after approval |
| 14 | Production behaviour verified after release | ✅ re-run of the failing check |
| 15 | Evidence-based report generated | ✅ |
| 16 | Founder notified | ✅ queued; 🟡 actual delivery needs SMTP/WhatsApp |
| 17 | Everything searchable; audit chain intact | ✅ |

## Failure cases

| Case | Test | Status |
|---|---|---|
| One model provider unavailable | debate → `REDUCED_PANEL` | ✅ |
| Founder rejects the proposal | acceptance (rejection) + gateway | ✅ nothing merged; task → NEEDS_REWORK |
| Worker restarts mid-task | engine: retry without re-running completed steps; expired lease resumed by another worker | ✅ |
| API token expires | connector → TOKEN_EXPIRED + alert + repair task | ✅ |
| Browser automation fails | journey against a dead host → FAIL recorded as evidence | ✅ |
| Notification cannot be delivered | 5 attempts, then FAILED (visible in Comms) | ✅ |
| Tool exceeds permissions | denied + audited | ✅ |
| Duplicate webhook | WhatsApp message-ID dedupe | ✅ |
| Approved action's parameters change | parameter-hash mismatch → refused | ✅ |
| Spending budget exceeded | run parks WAITING (budget), alert, auto-resume when allowed | ✅ |
| *Extra:* interrupted external action | flagged for manual verification, never retried | ✅ |
| *Extra:* shadow-mode agent with an approved action | cannot execute | ✅ |
| *Extra:* level 4 without a named reviewer | refused | ✅ |
| *Extra:* audit-row tampering | detected by chain verification | ✅ |

## Required deliverables (§25)

| # | Deliverable | Where | Status |
|---|---|---|---|
| 1 | Architecture decision record | `docs/ADR-001-architecture.md` | ✅ |
| 2 | Working application source | `src/` | ✅ |
| 3 | Documented service structure | `README.md` | ✅ |
| 4 | Schema + migrations | `prisma/` (38 models) | ✅ |
| 5 | 63 configurable agent profiles | `src/core/org/catalog.ts`, `docs/agents.md` | ✅ |
| 6 | Three provider adapters | `src/core/ai/providers.ts` | 🟡 live calls untested until you add keys |
| 7 | Five-round debate engine | `src/core/ai/debate.ts` | ✅ 🔵 |
| 8 | Durable workflow + task engine | `src/core/workflows/engine.ts`, `src/core/tasks/` | ✅ |
| 9 | Approval enforcement + audit | `src/core/tools/gateway.ts`, `src/core/approvals.ts`, `src/core/audit.ts` | ✅ |
| 10 | Dashboard + founder controls | `src/app/` (all 14 modules + command bar) | ✅ |
| 11 | Integration framework + connectors | `src/core/connectors/` (18) | ✅ framework · 🟡 each live connector |
| 12 | Browser automation service | `src/core/qa/` | ✅ |
| 13 | Reporting + alerting | workflows, `src/core/comms/` | ✅ |
| 14 | Security + secrets | AES-256-GCM, HMAC links, scrypt, TOTP 2FA, lockout, security headers | ✅ |
| 15 | Automated + end-to-end tests | `tests/` | ✅ 39 (run against a real PostgreSQL 18) |
| 16 | Deployment configuration | ADR §Deployment, `npm` scripts | ✅ (no Dockerfile: Docker wasn't available to test one) |
| 17 | Env template without credentials | `.env.example` | ✅ |
| 18 | Setup + onboarding | `README.md` | ✅ |
| 19 | Runbook + recovery | `docs/runbook.md` | ✅ |
| 20 | This report | `docs/acceptance-report.md` | ✅ |

## Connectors (all 🟡 until your first successful "Test now")

GitHub · Vercel · Storefront ops API (needs the endpoint in `docs/integrations.md`) · Razorpay · Shiprocket · GA4 · Search Console · Google Ads v26 · Merchant API v1 · Meta Ads v26.0 · Omnisend 2026-03-15 · Amazon SP-API · Flipkart (only with granted Seller API access) · WhatsApp Cloud API v26.0 · SMTP · Exotel · Google Calendar. **Nykaa:** human-assisted only.

## Manual by design (✋)

After approval these create a human task carrying the exact approved parameters, because there is no safe API path today: social publishing, price changes, catalog/inventory changes, Omnisend campaign sends, manual Shiprocket order creation, customer-data export, calendar writes.

## Deliberate deviations from the master prompt

- **Temporal and LangGraph are not used yet.** A DB-backed durable engine with Temporal semantics is used instead (one runtime, no extra infrastructure, migration path documented in the ADR).
- **Knowledge search is keyword-ranked with provenance**; a vector index is deferred until the corpus is big enough to need it.

## Pending / partial (⏳)

| Item | State |
|---|---|
| Gmail action-item extraction (§13) | ⏳ calendar read only |
| Founder preference learning (§16G) | ⏳ not built; founder instructions per agent are the manual equivalent |
| Digital company twin (§16A) | partial: price/catalog changes carry an impact checklist; no live dependency graph |
| Self-audit (§16E) / opportunity discovery (§16H) | partial: manager review, stalled-work digest, weekly strategic review |
| AI-controlled browser for UIs without APIs | ⏳ assisted human tasks instead; Playwright journeys are deterministic |
| Remote cloud browsers (Browserbase etc.) | ⏳ local Chromium; swap is `connectOverCDP()` |
| Voice IVR content | ⏳ you create the Exotel flow; the OS triggers it for unacknowledged SEV1 |
| Multi-user roles beyond the founder | partial: schema supports roles; UI is founder-only |
| Hosted deployment | ⏳ runs locally; production topology in the ADR |

## Known issues

- `npm audit` reports 3 high-severity advisories in `effect` (ReDoS, GHSA-7589-6fvf-x4pw), pulled in by the **Prisma 7 CLI's config loader**. It only runs at setup/migration time on your own config file, not on any request path. npm's suggested fix downgrades Prisma to v6, which would break the build. Re-check after the next Prisma release (`npm update prisma @prisma/client @prisma/adapter-better-sqlite3`).
- Dev-only advisories in `vitest`/`tinypool` do not ship to production.

## Hosting update (20 Nov 2026)

- Database moved to **PostgreSQL / Neon**. All tests now run against a real embedded PostgreSQL 18, including a concurrency test for the audit chain.
- Screenshots and traces are stored in the database, so the Vercel dashboard can show evidence captured on the Railway worker.
- Watchdog runs as a **Vercel Cron** route (`/api/cron/watchdog`, protected by `CRON_SECRET`) on a different host from the worker.
- New **HQ · Live Office** (`/office`) tested in a real browser: agents render from live records, clicking opens a standup report, and assigning work starts a task and the agent walks to its desk.
