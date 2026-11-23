/**
 * Rootellect AI OS worker — a long-running process, separate from the dashboard.
 * Loop: heartbeat → schedules → claim & execute workflow runs → deliver notifications.
 * Run several with distinct WORKER_ID values for more throughput; leases prevent double work.
 */
import { db } from "../core/db/client";
import { env } from "../core/env";
import { j } from "../core/db/json";
import { isEmergencyStopped } from "../core/settings";
import { tickSchedules } from "../core/workflows/schedules";
import { claimNext, executeRun } from "../core/workflows";
import { deliverQueued } from "../core/comms/notify";

const MAX_CONCURRENT = Number(process.env.WORKER_CONCURRENCY ?? 2);
let running = 0;
let stopping = false;

async function beat(state: string) {
  await db.heartbeat.upsert({ where: { component: "worker" }, create: { component: "worker", beatAt: new Date(), info: j({ id: env.workerId, state, running }) }, update: { beatAt: new Date(), info: j({ id: env.workerId, state, running }) } });
}

async function loop() {
  console.log(`[worker ${env.workerId}] started · concurrency ${MAX_CONCURRENT}`);
  while (!stopping) {
    try {
      const stopped = await isEmergencyStopped();
      await beat(stopped ? "emergency-stop" : "ok");
      if (!stopped) {
        const started = await tickSchedules();
        if (started.length) console.log(`[worker] scheduled: ${started.join(", ")}`);
        while (running < MAX_CONCURRENT) {
          const run = await claimNext();
          if (!run) break;
          running++;
          console.log(`[worker] ▶ ${run.workflowType} ${run.id} (attempt ${run.attempts})`);
          void executeRun(run.id).then((s) => console.log(`[worker] ■ ${run.workflowType} ${run.id} → ${s}`)).catch((e) => console.error(`[worker] ✖ ${run.id}`, e)).finally(() => { running--; });
        }
      }
      const sent = await deliverQueued();
      if (sent.length) console.log(`[worker] notifications: ${sent.map((s) => s.status).join(", ")}`);
    } catch (e) {
      console.error("[worker] loop error", e);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    stopping = true;
    console.log(`[worker] ${sig} — finishing ${running} run(s); unfinished runs resume from checkpoints on next start`);
    await beat("stopping").catch(() => undefined);
    setTimeout(() => process.exit(0), 3_000);
  });
}

void loop();
