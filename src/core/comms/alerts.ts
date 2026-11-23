import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";

export type Severity = "SEV1" | "SEV2" | "SEV3" | "INFO";

/**
 * Raises (or re-raises) an alert. Deduplicated by dedupeKey: repeats bump a counter
 * instead of spamming. SEV1/SEV2 open an incident and notify the founder through the
 * escalation policy (comms/notify.ts).
 */
export async function raiseAlert(a: { severity: Severity; title: string; detail?: string; source: string; dedupeKey?: string }) {
  if (a.dedupeKey) {
    const existing = await db.alert.findUnique({ where: { dedupeKey: a.dedupeKey } });
    if (existing && existing.status !== "RESOLVED") {
      return db.alert.update({ where: { id: existing.id }, data: { count: { increment: 1 }, lastSeenAt: new Date(), detail: a.detail ?? existing.detail } });
    }
    if (existing) await db.alert.update({ where: { id: existing.id }, data: { dedupeKey: `${a.dedupeKey}#${existing.id}` } });
  }
  let incidentId: string | undefined;
  if (a.severity === "SEV1" || a.severity === "SEV2") {
    const inc = await db.incident.create({ data: { title: a.title, severity: a.severity, summary: a.detail ?? "", timeline: j([{ at: new Date().toISOString(), actor: a.source, note: "Incident opened from alert" }]), owners: j(["A06", "C07"]) } });
    incidentId = inc.id;
  }
  const alert = await db.alert.create({ data: { severity: a.severity, title: a.title, detail: a.detail ?? "", source: a.source, dedupeKey: a.dedupeKey, incidentId } });
  await audit({ actor: a.source, action: "alert.raise", entityType: "alert", entityId: alert.id, data: { severity: a.severity, title: a.title } });
  if (a.severity !== "INFO") {
    const { notifyFounder } = await import("./notify");
    await notifyFounder({ severity: a.severity, subject: `[${a.severity}] ${a.title}`, body: `${a.title}\n\n${a.detail ?? ""}\n\nSource: ${a.source}`, dedupeKey: `alert:${alert.id}`, alertId: alert.id });
  }
  return alert;
}

export async function ackAlert(id: string, actor: string) {
  await db.alert.update({ where: { id }, data: { status: "ACKED", ackedAt: new Date() } });
  await db.notification.updateMany({ where: { alertId: id, ackedAt: null }, data: { ackedAt: new Date() } });
  await audit({ actor, action: "alert.ack", entityType: "alert", entityId: id });
}

export async function resolveAlert(id: string, actor: string) {
  await db.alert.update({ where: { id }, data: { status: "RESOLVED" } });
  await audit({ actor, action: "alert.resolve", entityType: "alert", entityId: id });
}

export async function addIncidentNote(incidentId: string, actor: string, note: string, patch: { status?: string; rootCause?: string } = {}) {
  const inc = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
  const timeline = [...parseJson<{ at: string; actor: string; note: string }[]>(inc.timeline, []), { at: new Date().toISOString(), actor, note }];
  await db.incident.update({ where: { id: incidentId }, data: { timeline: j(timeline), ...patch, ...(patch.status === "RESOLVED" ? { resolvedAt: new Date() } : {}) } });
  await audit({ actor, action: "incident.update", entityType: "incident", entityId: incidentId, data: { note, ...patch } });
}
