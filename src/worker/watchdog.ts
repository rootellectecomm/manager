/** Standalone watchdog process. In production the Vercel Cron route does the same job from a different host. */
import { env } from "../core/env";
import { runWatchdogCheck } from "../core/watchdog";

console.log(`[watchdog] watching worker heartbeat (stale after ${env.watchdogStaleSeconds}s)`);
const tick = () => runWatchdogCheck("process").then((r) => { if (r.stale) console.error("[watchdog]", r); }).catch((e) => console.error("[watchdog]", e));
setInterval(tick, 60_000);
void tick();
