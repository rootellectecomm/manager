import { db } from "../db/client";
import { audit } from "../audit";
import { nextCron } from "./cron";
import { startWorkflow } from "./engine";

/** Default operating rhythm (IST). Frequencies are editable in Settings → Schedules. */
export const DEFAULT_SCHEDULES = [
  { name: "connector-health", workflowType: "connector-health", cron: "*/30 * * * *", description: "Integration health checks and repair workflow" },
  { name: "storefront-synthetic", workflowType: "storefront-check", cron: "*/15 * * * *", description: "Production-safe storefront availability checks" },
  { name: "payment-reconciliation", workflowType: "reconciliation", cron: "5 * * * *", description: "Razorpay ↔ orders ↔ Shiprocket reconciliation" },
  { name: "daily-marketing", workflowType: "daily-marketing", cron: "30 8 * * *", description: "Google + Meta daily review with verified outcomes" },
  { name: "ga4-tracking-audit", workflowType: "ga4-audit", cron: "45 8 * * *", description: "GA4 purchases vs real payments" },
  { name: "website-audit", workflowType: "website-audit", cron: "0 7 * * *", description: "Full website audit by QA (daily)" },
  { name: "executive-brief-morning", workflowType: "executive-brief", cron: "15 9 * * *", description: "Morning executive brief" },
  { name: "executive-brief-evening", workflowType: "executive-brief", cron: "0 20 * * *", description: "Evening summary" },
  { name: "marketplace-audit", workflowType: "marketplace-audit", cron: "0 10 * * *", description: "Amazon / Merchant Center listing audit" },
  { name: "seo-control", workflowType: "seo-control", cron: "0 11 * * 1", description: "Weekly SEO control centre" },
  { name: "weekly-strategic-review", workflowType: "weekly-review", cron: "0 18 * * 5", description: "Weekly strategic review" },
  { name: "housekeeping", workflowType: "housekeeping", cron: "*/10 * * * *", description: "Expire approvals, detect stalled tasks, wake decided runs" },
];

export async function seedSchedules() {
  for (const s of DEFAULT_SCHEDULES) {
    await db.schedule.upsert({ where: { name: s.name }, create: { ...s, nextRunAt: nextCron(s.cron) }, update: {} });
  }
}

/**
 * Starts due schedules. Each fire time is deduplicated (two workers can't double-start it).
 * If the worker was down and fires were missed, it runs once (no backfill storm) and reports it.
 */
export async function tickSchedules(now = new Date()) {
  const due = await db.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });
  const started: string[] = [];
  for (const s of due) {
    const fireAt = s.nextRunAt!;
    const next = nextCron(s.cron, now);
    const missedBy = now.getTime() - fireAt.getTime();
    const claim = await db.schedule.updateMany({ where: { id: s.id, nextRunAt: fireAt }, data: { nextRunAt: next, lastRunAt: now } });
    if (claim.count !== 1) continue;
    await startWorkflow(s.workflowType, JSON.parse(s.input || "{}"), { dedupeKey: `sched:${s.name}:${fireAt.toISOString()}`, actor: "system:scheduler" });
    started.push(s.name);
    if (missedBy > 30 * 60_000) {
      await audit({ actor: "system:scheduler", action: "schedule.missed", entityType: "schedule", entityId: s.name, data: { minutesLate: Math.round(missedBy / 60_000) } });
      const { raiseAlert } = await import("../comms/alerts");
      await raiseAlert({ severity: "SEV3", title: `Schedule ran late: ${s.name}`, detail: `Fired ${Math.round(missedBy / 60_000)} minutes late — the worker was probably offline.`, source: "system:scheduler", dedupeKey: `missed:${s.name}:${now.toISOString().slice(0, 13)}` });
    }
  }
  return started;
}

export async function updateSchedule(name: string, patch: { cron?: string; enabled?: boolean }, actor: string) {
  if (patch.cron) nextCron(patch.cron); // validate
  const s = await db.schedule.update({ where: { name }, data: { ...patch, ...(patch.cron ? { nextRunAt: nextCron(patch.cron) } : {}) } });
  await audit({ actor, action: "schedule.update", entityType: "schedule", entityId: name, data: patch });
  return s;
}
