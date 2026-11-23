import { env } from "@/core/env";
import { runWatchdogCheck } from "@/core/watchdog";

export const dynamic = "force-dynamic";

/** Called by Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  return Response.json(await runWatchdogCheck("vercel-cron"));
}
