import { getConfig, isConfigured } from "@/core/connectors/registry";
import { processWhatsappInbound, verifyWhatsappSignature } from "@/core/comms/whatsapp-inbound";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";

/** Meta webhook verification handshake. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") !== "subscribe" || !(await isConfigured("whatsapp"))) return new Response("forbidden", { status: 403 });
  const cfg = await getConfig("whatsapp");
  if (u.searchParams.get("hub.verify_token") !== cfg.verifyToken) return new Response("forbidden", { status: 403 });
  return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

/** Signed deliveries only; duplicates are ignored by message id. Always 200 quickly so Meta doesn't retry-storm. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyWhatsappSignature(raw, req.headers.get("x-hub-signature-256")))) {
    await audit({ actor: "webhook:whatsapp", action: "webhook.bad_signature", entityType: "webhook", entityId: "whatsapp" });
    return new Response("invalid signature", { status: 401 });
  }
  try {
    await processWhatsappInbound(JSON.parse(raw));
  } catch (e) {
    await audit({ actor: "webhook:whatsapp", action: "webhook.error", entityType: "webhook", entityId: "whatsapp", data: { error: (e as Error).message } });
  }
  return new Response("ok");
}
