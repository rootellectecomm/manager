# Operational runbook

All times IST. "OS" = Rootellect AI OS. Every action below is audited.

## Daily rhythm (default schedules: Settings → Operating schedules)

| When | What |
|---|---|
| every 10 min | housekeeping: expire approvals, wake decided runs, resume budget-paused work, escalate unacknowledged SEV1, stalled-work digest |
| every 15 min | storefront heartbeat (two consecutive failures → SEV1) |
| every 30 min | connector health (a broken connector → alert + repair task for B05) |
| hourly :05 | Razorpay ↔ Shiprocket reconciliation (paid order with no shipment after 2 h → SEV2) |
| 07:00 | full website audit |
| 08:30 / 08:45 | daily marketing review / GA4 tracking audit |
| 09:15 / 20:00 | executive brief (email + dashboard) |
| 10:00 | marketplace listing audit (Mon: Flipkart/Nykaa assisted checks) |
| Mon 11:00 | SEO control centre |
| Fri 18:00 | weekly strategic review |

## Start / stop

```bash
npm start          # dashboard (after npm run build)
npm run worker     # Ctrl-C finishes in-flight steps; unfinished runs resume from checkpoints
npm run watchdog
```

Check health: `GET /api/health` returns worker and watchdog heartbeat ages.

## Emergency stop

Dashboard banner, **Settings → Emergency stop**, or type "emergency stop" in the command bar. Effect: the worker stops claiming runs and schedules, and the gateway allows only read-only tools. The watchdog keeps running. Turning it off resumes everything from checkpoints. Nothing is lost.

**Pause production-changing actions** is the lighter switch. It blocks risk level ≥ 2 while monitoring, drafts and reports continue.

## Scenarios

### Worker down (watchdog alert / red banner)
1. Check the worker terminal or service logs.
2. Restart with `npm run worker`. Runs whose lease expired are picked up automatically and resume after their last completed step.
3. Scheduled jobs that were missed run **once** (no backfill storm), and a "Schedule ran late" SEV3 records it.

### "Interrupted external action needs verification" (SEV2)
An approved payment, refund, message, merge, deploy or budget change started but its completion wasn't recorded (crash or network cut mid-call). **The OS will not retry it.**
1. Check the provider (Razorpay dashboard, Meta Ads Manager, GitHub, etc.) to see whether it happened.
2. If it did, mark the alert resolved and note it in the incident. If it didn't, create a fresh approval request. Don't reuse the old one.

### Connector TOKEN_EXPIRED / PERMISSION_REQUIRED
A repair task is assigned to B05. Rotate the credential in **Integration Hub → Update credentials** (secret fields left blank keep their old value) and click **Test now**.

### Budget exhausted
Model calls stop and the affected runs park as WAITING (budget). Raise the limit in **AI Cost Center** (or wait for the IST day/month to roll over). Housekeeping resumes them automatically.

### Paid order without shipment (SEV2)
Open Razorpay and Shiprocket for the payment ID in the alert. Matching keys used: Razorpay `order_id`, payment id, and notes `order_id` / `receipt` / `merchant_order_id` against Shiprocket `channel_order_id`. If your Magic Checkout → Shiprocket mapping uses a different key, tell the Payment Reconciliation Specialist via the agent's instructions, or adjust `reconciliation` in `business-workflows.ts`.

### Storefront down (SEV1)
WhatsApp and email go out immediately; a voice call follows after 10 minutes if no one acknowledges and a phone number is set. Acknowledge in the War Room to stop escalation. Engineering tasks are created by the audit; production fixes still need your approval.

## Backups & restore

- `npm run db:backup` writes `backups/rootellect-os-<timestamp>.db` while the app runs, then opens the copy to prove it's readable. Schedule it daily with Windows Task Scheduler or cron, and copy `backups/` off the machine.
- **Restore:** stop the dashboard and worker, copy the backup over `data/rootellect-os.db`, then start again. Run **Audit & Security → Verify chain integrity**.
- Keep `MASTER_KEY` in a password manager. Restoring a DB without its key means re-entering all credentials.
- Production (Neon): use point-in-time restore. Test a restore into a branch monthly.

## Rotating secrets

- **Provider/connector keys:** paste the new key in Settings / Integration Hub. The old one is overwritten.
- **APPROVAL_LINK_SECRET:** change in `.env` and restart. Old approval links stop working; approvals themselves are unaffected.
- **MASTER_KEY:** changing it makes stored credentials unreadable. Plan: export nothing, set the new key, re-enter credentials.

## Audit integrity

**Audit & Security → Verify chain integrity** recomputes every hash. A break means a row was edited or deleted outside the app. Treat that as a security incident: restore from backup and investigate who had file access.

## Retention

Audit events and approval records are kept indefinitely (they are the legal record of who approved what). Test results, executions and notifications can be pruned after 180 days with SQL if the DB grows. No customer PII is stored except what is in reconciliation alerts (payment IDs only; emails and phones are masked before reaching models).
