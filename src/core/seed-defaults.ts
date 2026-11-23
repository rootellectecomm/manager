import { db } from "./db/client";
import { SETTING_KEYS } from "./settings";

/** Defaults that are safe to re-run: only creates rows that don't exist yet. */
export async function seedDefaults() {
  const settings: Record<string, string> = {
    [SETTING_KEYS.emergencyStop]: "false",
    [SETTING_KEYS.productionWritesPaused]: "false",
    [SETTING_KEYS.quietHours]: "22:30-07:30",
    [SETTING_KEYS.storefrontUrl]: "https://rootellect.com",
    [SETTING_KEYS.stagingUrl]: "",
    [SETTING_KEYS.debateRiskThreshold]: "3",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  for (const provider of ["openai", "anthropic", "gemini"]) {
    await db.modelProvider.upsert({ where: { provider }, create: { provider }, update: {} });
  }

  const budgets = [
    { scope: "company", scopeRef: "*", period: "daily", limitInr: 1000 },
    { scope: "company", scopeRef: "*", period: "monthly", limitInr: 20000 },
    { scope: "provider", scopeRef: "debate", period: "monthly", limitInr: 5000 },
  ];
  for (const b of budgets) {
    await db.budget.upsert({ where: { scope_scopeRef_period: { scope: b.scope, scopeRef: b.scopeRef, period: b.period } }, create: b, update: {} });
  }

  for (const p of [
    { sku: "mind-calm", name: "Rootellect Mind Calm" },
    { sku: "women-balance", name: "Rootellect Women Balance" },
    { sku: "pcos-pcod-support", name: "Rootellect PCOS/PCOD Support" },
    { sku: "perimenopause-support", name: "Rootellect Perimenopause Support" },
  ]) {
    await db.productCost.upsert({ where: { sku: p.sku }, create: p, update: {} });
  }

  const { seedKnowledge } = await import("./knowledge/seed");
  await seedKnowledge();
  const { seedConnectors } = await import("./connectors/registry");
  await seedConnectors();
  const { seedSchedules } = await import("./workflows/schedules");
  await seedSchedules();
}
