import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { decryptSecret, encryptSecret } from "../crypto";
import { audit } from "../audit";
import { CONNECTORS, CONNECTOR_BY_KEY, type Cfg } from "./defs";
import { ConnectorError, type ConnectorStatus } from "./http";

export async function seedConnectors() {
  for (const c of CONNECTORS) {
    await db.connector.upsert({
      where: { key: c.key },
      create: { key: c.key, name: c.name, category: c.category, capabilities: j(c.capabilities), status: c.mode === "browser-assisted" ? "PERMISSION_REQUIRED" : "DISCONNECTED" },
      update: { name: c.name, category: c.category, capabilities: j(c.capabilities) },
    });
  }
}

export class NotConfiguredError extends Error {
  constructor(public connector: string) { super(`${connector} is not connected. Add credentials in Integrations.`); }
}

/** Decrypted config, or throws NotConfiguredError. Never logged, never sent to models. */
export async function getConfig(key: string): Promise<Cfg> {
  const row = await db.connector.findUnique({ where: { key } });
  if (!row?.encryptedConfig) throw new NotConfiguredError(key);
  return JSON.parse(decryptSecret(row.encryptedConfig)) as Cfg;
}

export async function isConfigured(key: string): Promise<boolean> {
  const row = await db.connector.findUnique({ where: { key } });
  return Boolean(row?.encryptedConfig);
}

/** Saves credentials. Blank secret fields keep their previous value so editing doesn't require re-entering secrets. */
export async function saveConfig(key: string, input: Cfg, actor: string) {
  if (!actor.startsWith("founder:")) throw new Error("Only the founder can change integration credentials.");
  const def = CONNECTOR_BY_KEY[key];
  if (!def) throw new Error(`Unknown connector ${key}`);
  let prev: Cfg = {};
  try { prev = await getConfig(key); } catch { /* first save */ }
  const cfg: Cfg = {};
  for (const f of def.fields) {
    const v = (input[f.name] ?? "").trim();
    cfg[f.name] = v || (f.secret ? prev[f.name] ?? "" : "");
    if (f.required && !cfg[f.name]) throw new Error(`${f.label} is required`);
  }
  if (cfg.serviceAccountJson) {
    try { const sa = JSON.parse(cfg.serviceAccountJson); if (!sa.client_email || !sa.private_key) throw new Error(); } catch { throw new Error("Service account JSON is not valid (needs client_email and private_key)."); }
  }
  const visible = def.fields.filter((f) => !f.secret && cfg[f.name]).map((f) => `${f.label}: ${cfg[f.name]}`).join(" · ");
  await db.connector.update({ where: { key }, data: { encryptedConfig: encryptSecret(JSON.stringify(cfg)), configHint: visible.slice(0, 200), status: "DISCONNECTED", lastError: null } });
  await audit({ actor, action: "connector.configure", entityType: "connector", entityId: key, data: { fields: def.fields.filter((f) => cfg[f.name]).map((f) => f.name) } });
  return checkConnector(key, actor);
}

export async function disconnect(key: string, actor: string) {
  if (!actor.startsWith("founder:")) throw new Error("Only the founder can disconnect integrations.");
  await db.connector.update({ where: { key }, data: { encryptedConfig: null, configHint: null, status: "DISCONNECTED", lastError: null } });
  await audit({ actor, action: "connector.disconnect", entityType: "connector", entityId: key });
}

export async function checkConnector(key: string, actor = "system:health"): Promise<{ status: ConnectorStatus; detail: string }> {
  const def = CONNECTOR_BY_KEY[key];
  const row = await db.connector.findUniqueOrThrow({ where: { key } });
  let result: { status: ConnectorStatus; detail: string };
  if (!row.encryptedConfig && def.mode === "api") {
    result = { status: "DISCONNECTED", detail: "Not configured" };
  } else {
    try {
      const cfg = row.encryptedConfig ? (JSON.parse(decryptSecret(row.encryptedConfig)) as Cfg) : {};
      result = await def.health(cfg);
    } catch (e) {
      result = e instanceof ConnectorError ? { status: e.status, detail: e.message } : { status: "DEGRADED", detail: (e as Error).message };
    }
  }
  const was = row.status as ConnectorStatus;
  await db.connector.update({ where: { key }, data: { status: result.status, lastCheckAt: new Date(), lastError: result.status === "CONNECTED" ? null : result.detail, configHint: row.configHint } });
  if (was !== result.status) {
    await audit({ actor, action: "connector.status", entityType: "connector", entityId: key, data: { from: was, to: result.status, detail: result.detail.slice(0, 300) } });
  }
  // A previously working connector breaking → repair workflow (alert + task for the API Integration Engineer).
  if (was === "CONNECTED" && result.status !== "CONNECTED") {
    const { raiseAlert } = await import("../comms/alerts");
    const { createTask } = await import("../tasks/service");
    await raiseAlert({ severity: result.status === "TOKEN_EXPIRED" ? "SEV2" : "SEV3", title: `${def.name} connector is ${result.status.replace("_", " ").toLowerCase()}`, detail: result.detail, source: `connector:${key}`, dedupeKey: `connector:${key}:${result.status}` });
    await createTask({
      title: `Repair ${def.name} connector`, objective: `Restore the ${def.name} integration (${result.status}). ${result.detail}`,
      source: "workflow", trigger: "connector.health", ownerAgentCode: "B05", priority: 2, riskLevel: 0,
      acceptanceCriteria: ["Health check returns CONNECTED", "Root cause recorded"], dedupeKey: `repair:${key}:${new Date().toISOString().slice(0, 10)}`, actor,
    });
  }
  return result;
}

export async function checkAllConnectors(actor = "system:health") {
  const rows = await db.connector.findMany();
  const out: Record<string, { status: ConnectorStatus; detail: string }> = {};
  for (const r of rows) {
    if (!r.encryptedConfig && CONNECTOR_BY_KEY[r.key]?.mode === "api") { out[r.key] = { status: "DISCONNECTED", detail: "Not configured" }; continue; }
    out[r.key] = await checkConnector(r.key, actor);
  }
  return out;
}

export function connectorCapabilities(row: { capabilities: string }) { return parseJson<string[]>(row.capabilities, []); }
