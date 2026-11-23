import { db } from "./db/client";
import { audit } from "./audit";

export const SETTING_KEYS = {
  emergencyStop: "emergency_stop", // "true" halts every non-read-only tool call and all workflows
  productionWritesPaused: "production_writes_paused", // "true" blocks risk ≥ 2 actions
  quietHours: "quiet_hours", // "22:00-07:30" IST — non-critical notifications held
  founderEmail: "founder_email",
  founderWhatsapp: "founder_whatsapp",
  founderPhone: "founder_phone",
  storefrontUrl: "storefront_url",
  stagingUrl: "staging_url",
  debateRiskThreshold: "debate_risk_threshold", // tasks at/above this risk trigger 5-round debate
} as const;

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string, actor: string): Promise<void> {
  const prev = await db.setting.findUnique({ where: { key } });
  await db.setting.upsert({ where: { key }, create: { key, value, updatedBy: actor }, update: { value, updatedBy: actor } });
  await audit({ actor, action: "setting.update", entityType: "setting", entityId: key, data: { from: prev?.value ?? null, to: value } });
}

export async function isEmergencyStopped(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.emergencyStop, "false")) === "true";
}

export async function areProductionWritesPaused(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.productionWritesPaused, "false")) === "true";
}
