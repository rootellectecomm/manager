import { db } from "../db/client";
import { audit } from "../audit";
import { getSetting, SETTING_KEYS } from "../settings";
import { toIstParts } from "../time";
import { getConfig, isConfigured } from "../connectors/registry";
import { exotel, smtp, whatsapp } from "../connectors/defs";
import type { Severity } from "./alerts";

/**
 * Escalation policy (configurable in code, documented in docs/runbook.md):
 *   SEV1 → WhatsApp + email immediately; voice call if not acknowledged within 10 min.
 *   SEV2 → WhatsApp + email (held during quiet hours unless unacknowledged for 60 min).
 *   SEV3 / INFO / approvals → email + dashboard; WhatsApp for approvals outside quiet hours.
 * Deduplicated by dedupeKey per channel. Silence is never treated as approval.
 */
export async function notifyFounder(n: { severity: Severity | "APPROVAL" | "REPORT"; subject: string; body: string; dedupeKey: string; alertId?: string; approvalId?: string }) {
  const email = await getSetting(SETTING_KEYS.founderEmail);
  const wa = await getSetting(SETTING_KEYS.founderWhatsapp);
  const channels: { channel: string; recipient: string }[] = [{ channel: "dashboard", recipient: "founder" }];
  if (email) channels.push({ channel: "email", recipient: email });
  if (wa && (n.severity === "SEV1" || n.severity === "SEV2" || n.severity === "APPROVAL")) channels.push({ channel: "whatsapp", recipient: wa });
  const created = [];
  for (const c of channels) {
    const dedupeKey = `${n.dedupeKey}:${c.channel}`;
    const exists = await db.notification.findUnique({ where: { dedupeKey } });
    if (exists) continue;
    created.push(await db.notification.create({ data: { channel: c.channel, recipient: c.recipient, subject: n.subject, body: n.body, severity: n.severity, dedupeKey, alertId: n.alertId, approvalId: n.approvalId, status: c.channel === "dashboard" ? "SENT" : "QUEUED", sentAt: c.channel === "dashboard" ? new Date() : null } }));
  }
  return created;
}

export async function inQuietHours(now = new Date()): Promise<boolean> {
  const spec = await getSetting(SETTING_KEYS.quietHours, "");
  const m = spec.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const p = toIstParts(now);
  const cur = p.hour * 60 + p.minute;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** Delivers queued notifications. Called by the worker; each send is attempted at most 5 times. */
export async function deliverQueued(limit = 25) {
  const quiet = await inQuietHours();
  const queued = await db.notification.findMany({ where: { status: "QUEUED", attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: limit });
  const results: { id: string; status: string; error?: string }[] = [];
  for (const n of queued) {
    const holdable = n.severity !== "SEV1" && n.severity !== "APPROVAL";
    const ageMin = (Date.now() - n.createdAt.getTime()) / 60_000;
    if (quiet && holdable && !(n.severity === "SEV2" && ageMin > 60)) continue;
    try {
      if (n.channel === "email") {
        if (!(await isConfigured("smtp"))) throw new Error("Email (SMTP) not connected");
        await smtp.send(await getConfig("smtp"), n.recipient, n.subject, n.body);
      } else if (n.channel === "whatsapp") {
        if (!(await isConfigured("whatsapp"))) throw new Error("WhatsApp not connected");
        const cfg = await getConfig("whatsapp");
        // Outside the 24h customer-service window, only approved templates are delivered.
        if (cfg.alertTemplate) await whatsapp.sendTemplate(cfg, n.recipient, cfg.alertTemplate, cfg.templateLang || "en", [n.subject.slice(0, 900)]);
        else await whatsapp.sendText(cfg, n.recipient, `${n.subject}\n\n${n.body}`.slice(0, 3900));
      } else if (n.channel === "voice") {
        if (!(await isConfigured("exotel"))) throw new Error("Exotel not connected");
        await exotel.callFounder(await getConfig("exotel"), n.recipient);
      }
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
      results.push({ id: n.id, status: "SENT" });
    } catch (e) {
      const msg = (e as Error).message;
      const attempts = n.attempts + 1;
      await db.notification.update({ where: { id: n.id }, data: { attempts, error: msg, status: attempts >= 5 ? "FAILED" : "QUEUED" } });
      results.push({ id: n.id, status: attempts >= 5 ? "FAILED" : "RETRY", error: msg });
      if (attempts >= 5) await audit({ actor: "system:notifier", action: "notification.failed", entityType: "notification", entityId: n.id, data: { channel: n.channel, error: msg } });
    }
  }
  return results;
}

/** SEV1 alerts not acknowledged within 10 minutes escalate to a voice call (once). */
export async function escalateUnacknowledged() {
  const phone = await getSetting(SETTING_KEYS.founderPhone);
  if (!phone) return 0;
  const cutoff = new Date(Date.now() - 10 * 60_000);
  const open = await db.alert.findMany({ where: { severity: "SEV1", status: "OPEN", createdAt: { lt: cutoff } } });
  let n = 0;
  for (const a of open) {
    const key = `alert:${a.id}:voice`;
    if (await db.notification.findUnique({ where: { dedupeKey: key } })) continue;
    await db.notification.create({ data: { channel: "voice", recipient: phone, subject: `[SEV1] ${a.title}`, body: a.detail, severity: "SEV1", dedupeKey: key, alertId: a.id } });
    n++;
  }
  return n;
}
