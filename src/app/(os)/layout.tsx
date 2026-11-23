import { cookies } from "next/headers";
import { db } from "@/core/db/client";
import { getSetting, SETTING_KEYS } from "@/core/settings";
import { env } from "@/core/env";
import { secondsSince } from "@/core/time";
import { requireFounder } from "../lib/session";
import { commandAction, logoutAction, safetySwitchAction } from "../actions";
import { CommandBar, Sidebar, ThemeToggle } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireFounder();
  const [approvals, incidents, emergency, paused, theme, hb] = await Promise.all([
    db.approvalRequest.count({ where: { status: { in: ["PENDING", "DEFERRED"] } } }),
    db.incident.count({ where: { status: { not: "RESOLVED" } } }),
    getSetting(SETTING_KEYS.emergencyStop, "false"),
    getSetting(SETTING_KEYS.productionWritesPaused, "false"),
    cookies().then((c) => (c.get("ros_theme")?.value === "dark" ? "dark" : "light")),
    db.heartbeat.findUnique({ where: { component: "worker" } }),
  ]);
  const workerAge = hb ? secondsSince(hb.beatAt) : Infinity;
  return (
    <div className="min-h-screen">
      <Sidebar counts={{ "/approvals": approvals, "/incidents": incidents }} />
      <div className="lg:pl-64">
        {emergency === "true" && (
          <form action={safetySwitchAction} className="flex items-center justify-between gap-3 bg-plum-700 px-6 py-2 text-sm text-white">
            <span><strong>Emergency stop is ON.</strong> Workflows are halted; agents can only read.</span>
            <input type="hidden" name="key" value={SETTING_KEYS.emergencyStop} /><input type="hidden" name="value" value="false" />
            <button className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25">Turn off</button>
          </form>
        )}
        {paused === "true" && emergency !== "true" && (
          <form action={safetySwitchAction} className="flex items-center justify-between gap-3 bg-gold-100 px-6 py-2 text-sm text-gold-700 dark:bg-[#2a2310] dark:text-gold-300">
            <span><strong>Production-changing actions are paused.</strong> Monitoring and drafts continue.</span>
            <input type="hidden" name="key" value={SETTING_KEYS.productionWritesPaused} /><input type="hidden" name="value" value="false" />
            <button className="rounded-md px-3 py-1 ring-1 ring-current">Resume</button>
          </form>
        )}
        {workerAge > env.watchdogStaleSeconds && (
          <div className="bg-plum-50 px-6 py-2 text-sm text-plum-700 dark:bg-plum-900 dark:text-plum-100">
            <strong>Worker offline</strong> — {Number.isFinite(workerAge) ? `last heartbeat ${Math.round(workerAge / 60)} min ago` : "never started"}. Schedules, monitoring and notifications are not running. Start it with <code>npm run worker</code>.
          </div>
        )}
        <header className="line sticky top-0 z-10 flex items-center gap-3 border-b bg-[var(--bg)]/90 px-4 py-3 pl-16 backdrop-blur lg:px-8">
          <CommandBar action={commandAction} />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle initial={theme} />
            <form action={logoutAction}><button className="surface whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs" title={user.email}>Sign out</button></form>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
