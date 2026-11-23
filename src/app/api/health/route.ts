import { db } from "@/core/db/client";

export const dynamic = "force-dynamic";

/** Liveness for uptime monitors. Reveals nothing beyond component freshness. */
export async function GET() {
  try {
    const beats = await db.heartbeat.findMany();
    const age = (c: string) => { const b = beats.find((x) => x.component === c); return b ? Math.round((Date.now() - b.beatAt.getTime()) / 1000) : null; };
    const workerAge = age("worker");
    return Response.json({ ok: true, db: "ok", workerHeartbeatSeconds: workerAge, watchdogHeartbeatSeconds: age("watchdog"), workerHealthy: workerAge !== null && workerAge < 180 });
  } catch {
    return Response.json({ ok: false, db: "error" }, { status: 503 });
  }
}
