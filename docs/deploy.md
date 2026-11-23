# Going live: Vercel + Neon + Railway

```
 you (browser / WhatsApp)
        │
        ▼
 ┌──────────────┐  pooled SQL   ┌─────────────────────┐
 │ Vercel       │──────────────▶│ Neon Postgres       │
 │ dashboard    │               │ project raspy-bird  │
 │ + cron       │               │ branch: production  │
 │  watchdog    │               └─────────────────────┘
 └──────────────┘                         ▲
                                          │ pooled SQL
                                 ┌────────┴─────────┐
                                 │ Railway worker   │  schedules, workflows, notifications,
                                 │ (Docker +        │  Playwright browser QA
                                 │  Playwright)     │
                                 └──────────────────┘
```

| Piece | Runs on | Why there |
|---|---|---|
| Dashboard, approvals, office view, webhooks, cron watchdog | **Vercel** (Pro) | Short requests; Fluid compute + `attachDatabasePool` for Neon |
| Database | **Neon** | Serverless Postgres, branching, point-in-time restore |
| Worker (always-on loop + Chromium) | **Railway** (Docker) | Long-running process; Vercel functions can't hold a 24/7 loop or run Playwright |
| Watchdog | **Vercel Cron** every 5 min | A different host from the worker, so it can still alert you if Railway goes down |

## 0 · One-time: secrets you generate once and reuse everywhere

Run `npm run init` locally. This creates `.env` with `MASTER_KEY`, `APPROVAL_LINK_SECRET` and `CRON_SECRET`. **Vercel and Railway must use the same `MASTER_KEY` and `APPROVAL_LINK_SECRET`.** Credentials encrypted by the dashboard are decrypted by the worker. Save all three in your password manager.

## 1 · Neon (done for project `raspy-bird-22849780`)

- `neon init` has already linked the repo (`.neon`, `neon.ts`).
- Connection strings go in `.env.local` (gitignored):
  - `DATABASE_URL` is the **pooled** string (host contains `-pooler`), used by the app.
  - `DATABASE_URL_UNPOOLED` is the **direct** string, used for migrations and `pg_dump`.
  - With the Neon CLI signed in (`neon login`), `neon env pull` writes both for you.
- Schema: `npx prisma migrate deploy` then `npm run db:seed`. Both are idempotent, and the Vercel build runs them on every deploy.
- Development: `neon checkout dev --create` gives you a throwaway copy of production (auto-expires in 7 days per `neon.ts`). Point a local `.env.local` at it.
- The database is in **AWS Sydney (ap-southeast-2)**, so the Vercel functions are pinned to `syd1` in `vercel.json` to sit next to it.

## 2 · Push the code to GitHub

Create a **private** repo (e.g. `rootellect/rootellect-os`) and push this folder. `.env`, `.env.local` and `data/` are gitignored. Check `git status` before the first commit.

## 3 · Vercel (dashboard)

1. New Project → import the repo. Framework is detected as Next.js; the build command comes from `vercel.json` (`npm run vercel-build` = generate → migrate → seed → build).
2. Settings → Functions: confirm **Fluid compute** is on (default for new projects).
3. Environment variables (Production + Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled string |
| `DATABASE_URL_UNPOOLED` | Neon direct string |
| `MASTER_KEY` | from your `.env` |
| `APPROVAL_LINK_SECRET` | from your `.env` |
| `CRON_SECRET` | from your `.env` |
| `APP_URL` | `https://<your-domain>` (e.g. `https://os.rootellect.com`) |
| `ALLOW_SIMULATED_PROVIDER` | `false` |

   Easiest path: install the **Neon integration** from the Vercel Marketplace and link project `raspy-bird-22849780`. It injects `DATABASE_URL` / `DATABASE_URL_UNPOOLED` and can create a Neon branch per preview deployment.
4. Deploy. Then Settings → Domains → add `os.rootellect.com`, and add the CNAME it shows at your DNS provider.
5. Create your login once against production. Locally, with `.env.local` pointing at Neon production, run `npm run founder:create`. Then sign in and turn on two-factor (Settings).
6. Optional hardening: Settings → Deployment Protection → protect **Preview** deployments. Keep Production public, because WhatsApp webhooks and the cron must reach it. The app has its own login and 2FA.

## 4 · Railway (worker)

1. New Project → Deploy from GitHub repo (same repo). Railway reads `railway.json` → builds `Dockerfile.worker` (Playwright image with Chromium) → runs `npm run worker`.
2. Variables: the same `DATABASE_URL`, `MASTER_KEY`, `APPROVAL_LINK_SECRET`, `APP_URL`, plus `WORKER_ID=railway-1`, `ALLOW_SIMULATED_PROVIDER=false`, `WATCHDOG_STALE_SECONDS=180`.
3. Size: 1 GB RAM is comfortable with Playwright. Keep **1 replica** (leases allow more later).
4. Check: `https://<your-domain>/api/health` shows `workerHealthy: true` within a minute, and the office banner says "worker online".

Alternatives with the same Dockerfile: Render Background Worker, Fly.io, or any small VM (`docker build -f Dockerfile.worker . && docker run --env-file .env …`).

## 5 · Point integrations at production

- WhatsApp webhook URL: `https://<your-domain>/api/webhooks/whatsapp`
- `APP_URL` is used in approval links. It must be the public domain.
- Re-enter AI provider keys and connector credentials in the **production** dashboard. They're encrypted with the production `MASTER_KEY`.

## Cost expectations (check current pricing)

- **Vercel Pro** is required. Hobby is non-commercial only, and its cron runs at most once a day (the 5-minute watchdog would fail to deploy).
- **Neon:** the worker polls every 5 s, so the compute never scales to zero. Expect it to run continuously at the minimum size (0.25 CU ≈ 182 CU-hours/month). That's above the Free plan's 100 CU-hours per project, so plan on the paid Launch plan (usage-based).
- **Railway Hobby:** a monthly fee that includes usage credit, plus metered RAM/CPU for the worker.

## Rollback

- App: Vercel → Deployments → previous → Promote (instant).
- Database: Neon → Branches → Restore (point in time). Test it on a branch first.
- Worker: Railway → Deployments → redeploy previous.
