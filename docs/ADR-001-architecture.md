# ADR-001 — Architecture of Rootellect AI OS

**Status:** Accepted · 20 Nov 2026
**Deciders:** Founder (Partik), Technical Lead (B01)

## Context

The master prompt asks for a continuously running AI organisation (63 roles, three model providers, five-round debates, durable approvals, browser QA, WhatsApp/email/voice) that one founder can afford and trust. Today Rootellect has low web traffic, sells mostly on Amazon, and runs a Next.js + Prisma storefront on Vercel. Reliability and auditability matter more than throughput.

## Decision matrix (1 = poor, 5 = strong)

| Option | Reliability | Maintainability | Security | Total cost | Scalability | Effort now | Notes |
|---|---|---|---|---|---|---|---|
| n8n only | 3 | 2 | 2 | 4 | 3 | 5 | Fast wiring; governance (param-hash approvals, audit chain) would live outside it |
| LangGraph only | 3 | 3 | 3 | 4 | 3 | 3 | Good agent state; still needs scheduling, leases, approvals, audit |
| Temporal + LangGraph + dashboard | 5 | 3 | 4 | 2 | 5 | 1 | Best long-term durability; needs a Temporal cluster (self-host or Cloud ≈ US$100+/mo) and two runtimes |
| **Custom TypeScript control plane with a DB-backed durable engine (chosen for Phases 1–3)** | 4 | 4 | 5 | 5 | 3 | 3 | One language, one DB, zero extra infrastructure; Temporal-style semantics |

## Decision

1. **One TypeScript codebase**, two deployment units: the **dashboard** (Next.js, server components + authenticated server actions) and the **worker** (long-running Node process). Plus a separate **watchdog** process. The storefront is untouched.
2. **Durable workflow engine on the control-plane database** (`src/core/workflows/engine.ts`) with Temporal's core semantics:
   - replay with per-step checkpoints (`ctx.step`), so completed steps never re-run;
   - leases (`lockedBy` / `lockedUntil`) renewed while running, so a dead worker's run is resumed by another;
   - `ctx.waitForApproval()` parks a run until the founder decides; `ctx.sleepUntil()` is a durable timer;
   - exponential backoff, maximum attempts, failure alerts; deduplicated starts.
   - **Migration path:** workflow functions only use `ctx.step / waitForApproval / sleepUntil`. These map 1:1 to Temporal activities, signals and timers, so moving to Temporal later means changing the engine, not the workflows. Revisit when we need more than about 5 workers, sub-second scheduling, or cross-region failover.
3. **No LangGraph.** Agent "state" is the task record plus checkpoints. Agent reasoning is a structured JSON contract (`AgentOutput` in `src/core/ai/schemas.ts`) validated with Zod, plus one read-only tool follow-up. This keeps every model output inspectable and testable. LangGraph can be added inside an agent runner later if a role needs long multi-step tool loops.
4. **Provider adapters over raw REST** (OpenAI Responses API, Anthropic Messages API, Gemini `generateContent`). Model IDs are discovered at runtime and chosen per tier in Settings, so nothing deprecated is hardcoded. The router enforces budgets *before* each call, rate-limits per provider, falls back to the agent's secondary provider, and meters cost (marked *estimate* when no price is configured).
5. **Approval enforcement in the tool gateway**, not prompts: risk levels 0–4, agent allowlists, shadow mode, standing approvals with caps, parameter-hash matching, idempotency, "interrupted ≠ retried".
6. **Database:** **Neon Postgres** via Prisma 7 + `@prisma/adapter-pg` (node-postgres), per Neon's guidance for Vercel Fluid compute (`attachDatabasePool`). Pooled `DATABASE_URL` for traffic, `DATABASE_URL_UNPOOLED` for migrations. The audit chain takes a Postgres advisory lock so concurrent writers on different hosts can't fork it. *(Updated 20 Nov 2026: replaces the initial SQLite build.)*
7. **Audit log:** append-only, SHA-256 hash-chained (`AuditEvent.prevHash/hash`), verifiable from the dashboard.
8. **Secrets:** AES-256-GCM with `MASTER_KEY` (env), separate `APPROVAL_LINK_SECRET` for HMAC-signed approval links. Credentials are never returned to the browser, put in prompts, or logged.
9. **Knowledge:** versioned entries with provenance, verified vs unverified flag, expiry, and keyword ranking. A vector index can sit behind `searchKnowledge()` later. It isn't needed at the current corpus size.
10. **Browser:** API first → Playwright (read-only journeys; no payments) → assisted human tasks. Remote browser services (Browserbase etc.) can replace `chromium.launch()` with `connectOverCDP()` without changing journeys.

## Consequences

- ✅ Runs today on one laptop or one small VM; one database to back up.
- ✅ Every rule the founder cares about (no silent approval, exact params, no blind retries, evidence before completion) is a tested code path.
- ⚠️ SQLite handles one worker host well. For several worker hosts, move to Postgres first (row-level contention is fine; leases already use conditional updates).
- ⚠️ The in-process rate limiter is per worker. With several workers, set each provider's limit to its share.
- ⚠️ The dashboard should not be deployed to serverless (Vercel) while the DB is SQLite. Use Postgres if you want the dashboard on Vercel and the worker on a VM.

## Deployment topology (recommended next step)

| Unit | Where | Why |
|---|---|---|
| Storefront | Vercel (unchanged) | Isolation from AI failures |
| Dashboard | Vercel *or* the same VM as the worker | Short-lived requests only |
| Worker + watchdog | Small persistent VM / Railway / Render / Fly (≥1 GB RAM if Playwright runs there) | Long-running loops must not live in serverless functions |
| Database | Neon Postgres (production) | Point-in-time restore, shared by dashboard and worker |
| Artifacts | Local disk now; S3/R2 later (`ARTIFACTS_DIR`) | Screenshots, traces, reports |

Run the watchdog on a **different host** from the worker if you can, so it still alerts you when that host dies.

## Hosting

See `docs/deploy.md`: Vercel (dashboard + cron watchdog), Neon (database), Railway (worker in `Dockerfile.worker`).
