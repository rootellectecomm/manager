/**
 * WhatsApp webhook handling. Signature verified with the app secret (X-Hub-Signature-256),
 * duplicate deliveries ignored by message id, and only the founder's registered number
 * may issue commands. Level 3+ approvals are refused over WhatsApp (dashboard link instead).
 */
import { db } from "../db/client";
import { audit } from "../audit";
import { verifyHmacSha256 } from "../crypto";
import { getConfig, isConfigured } from "../connectors/registry";
import { whatsapp } from "../connectors/defs";
import { getSetting, SETTING_KEYS } from "../settings";

interface WaPayload { entry?: { changes?: { value?: { messages?: { id: string; from: string; type: string; text?: { body: string } }[]; statuses?: { id: string; status: string }[] } }[] }[] }

export async function verifyWhatsappSignature(rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  if (!(await isConfigured("whatsapp"))) return false;
  const cfg = await getConfig("whatsapp");
  return verifyHmacSha256(cfg.appSecret, rawBody, header.slice(7));
}

export async function processWhatsappInbound(payload: WaPayload, opts: { reply?: boolean } = {}) {
  const founder = (await getSetting(SETTING_KEYS.founderWhatsapp)).replace(/[^\d]/g, "");
  const results: { id: string; outcome: string }[] = [];
  for (const entry of payload.entry ?? []) for (const ch of entry.changes ?? []) {
    for (const st of ch.value?.statuses ?? []) {
      await audit({ actor: "whatsapp", action: "whatsapp.status", entityType: "message", entityId: st.id, data: { status: st.status } });
    }
    for (const m of ch.value?.messages ?? []) {
      const key = `wa-in:${m.id}`;
      const seen = await db.idempotencyRecord.findUnique({ where: { key } });
      if (seen) { results.push({ id: m.id, outcome: "duplicate-ignored" }); continue; }
      await db.idempotencyRecord.create({ data: { key, scope: "whatsapp.inbound", status: "DONE" } });
      if (!founder || m.from.replace(/[^\d]/g, "") !== founder) {
        await audit({ actor: `whatsapp:${m.from}`, action: "whatsapp.ignored_sender", entityType: "message", entityId: m.id });
        results.push({ id: m.id, outcome: "ignored-unknown-sender" });
        continue;
      }
      const user = await db.user.findFirst({ where: { role: "FOUNDER" } });
      if (!user || m.type !== "text" || !m.text?.body) { results.push({ id: m.id, outcome: "ignored" }); continue; }
      const { runCommand } = await import("../command");
      const res = await runCommand(m.text.body, `founder:${user.id}`, "whatsapp");
      if (opts.reply !== false && (await isConfigured("whatsapp"))) {
        await whatsapp.sendText(await getConfig("whatsapp"), m.from, `${res.message}${res.link ? `\n${res.link}` : ""}`).catch(() => undefined);
      }
      results.push({ id: m.id, outcome: res.kind });
    }
  }
  return results;
}
