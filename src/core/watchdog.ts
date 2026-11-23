/**
 * Watchdog check, shared by the standalone process (npm run watchdog) and the Vercel Cron route
 * (/api/cron/watchdog). It alerts out-of-band — straight to email/WhatsApp, not via the worker's
 * queue — because the worker is the thing that may be down. Re-alerts at most once an hour.
 */
import { db } from "./db/client";
import { env } from "./env";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";
import { getConfig, isConfigured } from "./connectors/registry";
import { smtp, whatsapp } from "./connectors/defs";

export async function runWatchdogCheck(source: string) {
  const hb = await db.heartbeat.findUnique({ where: { component: "worker" } });
  const ageSec = hb ? (Date.now() - hb.beatAt.getTime()) / 1000 : Infinity;
  await db.heartbeat.upsert({ where: { component: "watchdog" }, create: { component: "watchdog", beatAt: new Date(), info: JSON.stringify({ source }) }, update: { beatAt: new Date(), info: JSON.stringify({ source }) } });
  const stale = ageSec > env.watchdogStaleSeconds;
  const lastAlert = Number(await getSetting("watchdog_last_alert_ms", "0"));
  if (!stale) {
    if (lastAlert) await setSetting("watchdog_last_alert_ms", "0", "system:watchdog");
    return { stale: false, workerAgeSeconds: Math.round(ageSec), alerted: false };
  }
  if (Date.now() - lastAlert < 3600_000) return { stale: true, workerAgeSeconds: Math.round(ageSec), alerted: false };
  const msg = `Rootellect AI OS worker has not reported for ${Number.isFinite(ageSec) ? `${Math.round(ageSec / 60)} min` : "ever"}. Schedules, monitoring and notifications are stopped until it restarts. Check the worker service (Railway) logs — see docs/runbook.md → "Worker down".`;
  const sent: string[] = [];
  const email = await getSetting(SETTING_KEYS.founderEmail);
  const wa = await getSetting(SETTING_KEYS.founderWhatsapp);
  if (email && (await isConfigured("smtp"))) {
    await smtp.send(await getConfig("smtp"), email, "[SEV1] Rootellect AI OS worker is down", msg).then(() => sent.push("email")).catch(() => undefined);
  }
  if (wa && (await isConfigured("whatsapp"))) {
    const cfg = await getConfig("whatsapp");
    await (cfg.alertTemplate ? whatsapp.sendTemplate(cfg, wa, cfg.alertTemplate, cfg.templateLang || "en", [msg.slice(0, 900)]) : whatsapp.sendText(cfg, wa, msg)).then(() => sent.push("whatsapp")).catch(() => undefined);
  }
  await setSetting("watchdog_last_alert_ms", String(Date.now()), "system:watchdog");
  return { stale: true, workerAgeSeconds: Math.round(ageSec), alerted: true, channels: sent };
}
