import Link from "next/link";
import { db } from "@/core/db/client";
import { formatInr, formatIst, istDayStart, msFromNow } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Stat, Button } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { newObjectiveAction, startWorkflowAction, alertAction } from "../actions";

export const metadata = { title: "Mission Control" };

export default async function MissionControl() {
  const today = istDayStart();
  const [completedToday, pending, incidents, alerts, agents, aiToday, connectors, runs, activity, revenue, simulatedProviders] = await Promise.all([
    db.task.count({ where: { completedAt: { gte: today } } }),
    db.approvalRequest.findMany({ where: { status: { in: ["PENDING", "DEFERRED"] } }, orderBy: [{ urgency: "desc" }, { createdAt: "asc" }], take: 4 }),
    db.incident.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.alert.findMany({ where: { status: "OPEN" }, orderBy: { lastSeenAt: "desc" }, take: 6 }),
    db.agent.groupBy({ by: ["status"], _count: true }),
    db.modelUsage.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: today } } }),
    db.connector.groupBy({ by: ["status"], _count: true }),
    db.workflowRun.findMany({ where: { status: { in: ["RUNNING", "PENDING", "WAITING"] }, nextRunAt: { lte: msFromNow(60_000) } }, orderBy: { updatedAt: "desc" }, take: 6 }),
    db.auditEvent.findMany({ where: { actor: { startsWith: "agent:" } }, orderBy: { seq: "desc" }, take: 10 }),
    db.businessMetric.findFirst({ where: { key: "revenue_web_captured_inr", capturedAt: { gte: today } }, orderBy: { capturedAt: "desc" } }),
    db.modelProvider.count({ where: { status: "CONNECTED" } }),
  ]);
  const count = (rows: { status: string; _count: number }[], s: string) => rows.find((r) => r.status === s)?._count ?? 0;
  const connected = count(connectors, "CONNECTED");
  const totalConn = connectors.reduce((s, r) => s + r._count, 0);

  return (
    <>
      <PageHeader title="Mission Control" subtitle={`${formatIst(new Date())} · Your AI organization's state, decisions and exceptions.`}
        actions={<>
          <form action={startWorkflowAction}><input type="hidden" name="type" value="website-audit" /><Button variant="primary">Start website audit</Button></form>
          <form action={startWorkflowAction}><input type="hidden" name="type" value="connector-health" /><Button variant="ghost">Check integrations</Button></form>
          <form action={startWorkflowAction}><input type="hidden" name="type" value="executive-brief" /><Button variant="ghost">Generate brief</Button></form>
        </>} />

      {simulatedProviders === 0 && (
        <div className="mb-6 rounded-xl border border-gold-300 bg-gold-100 px-5 py-3 text-sm text-gold-700 dark:border-gold-700 dark:bg-[#2a2310] dark:text-gold-300">
          No AI provider is connected yet. Agents can monitor and run deterministic checks, but analysis and debates need OpenAI, Claude or Gemini — <Link href="/settings#providers" className="font-medium underline">connect providers</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Tasks completed" value={completedToday} hint="today, with evidence" href="/tasks?status=COMPLETED" tone="good" />
        <Stat label="Need approval" value={pending.length} hint="waiting for you" href="/approvals" tone={pending.length ? "warn" : "default"} />
        <Stat label="Open incidents" value={incidents.length} hint={`${alerts.length} open alerts`} href="/incidents" tone={incidents.length ? "bad" : "default"} />
        <Stat label="Agents" value={`${count(agents, "ACTIVE")}/${agents.reduce((s, r) => s + r._count, 0)}`} hint={`active · ${count(agents, "SHADOW")} in shadow mode`} href="/organization" />
        <Stat label="Integrations" value={`${connected}/${totalConn}`} hint="connected" href="/integrations" tone={connected ? "default" : "warn"} />
        <Stat label="AI spend today" value={formatInr(aiToday._sum.costInr ?? 0)} hint={revenue ? `web revenue ${formatInr(revenue.value)} (verified)` : "revenue: connect Razorpay"} href="/costs" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Priority decisions" className="xl:col-span-2" action={<Link href="/approvals" className="accent text-xs font-medium">All approvals →</Link>}>
          {pending.length === 0 ? <Empty title="Nothing needs your decision">Agents will bring production, spend, publishing and pricing changes here with evidence and a rollback plan.</Empty> : (
            <div className="space-y-3">
              {pending.map((a) => (
                <Link key={a.id} href={`/approvals/${a.id}`} className="line surface-2 block rounded-lg border p-4 transition hover:border-[var(--color-gold-500)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="muted font-mono text-xs">{a.shortCode}</span><Pill tone={a.riskLevel >= 4 ? "bad" : "warn"}>{`risk ${a.riskLevel}`}</Pill>{a.urgency !== "normal" && <Pill tone={a.urgency === "low" ? "info" : "bad"}>{a.urgency}</Pill>}
                    <span className="muted ml-auto text-xs">{a.agentCode} · {a.department}</span>
                  </div>
                  <div className="mt-1.5 font-medium">{a.title}</div>
                  <div className="muted mt-1 line-clamp-2 text-sm">{a.reason}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Give the organization an objective">
          <ActionForm action={newObjectiveAction} submit="Send to Chief of Staff">
            <textarea name="objective" rows={4} required placeholder="e.g. Find why website sales dropped this week and prepare fixes. Ask before any production change." className="w-full rounded-lg px-3 py-2 text-sm" />
            <label className="muted mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="autoStart" defaultChecked /> Start agents immediately (production changes still need approval)</label>
          </ActionForm>
        </Card>

        <Card title="Open alerts" className="xl:col-span-2">
          {alerts.length === 0 ? <Empty title="All quiet">No open alerts.</Empty> : (
            <ul className="divide-y divide-[var(--line)]">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  <Pill>{a.severity}</Pill>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{a.title}{a.count > 1 && <span className="muted"> ×{a.count}</span>}</div><div className="muted line-clamp-1 text-xs">{a.source} · {formatIst(a.lastSeenAt)}</div></div>
                  <form action={alertAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="ack" /><button className="surface rounded-md px-2 py-1 text-xs">Acknowledge</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Live work">
          {runs.length === 0 ? <p className="muted text-sm">No workflows running right now.</p> : (
            <ul className="space-y-2 text-sm">{runs.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="truncate">{r.workflowType}</span><Pill>{r.status}</Pill></li>)}</ul>
          )}
          <div className="line mt-4 border-t pt-3">
            <div className="muted mb-2 text-xs font-medium uppercase tracking-wide">Recent agent activity</div>
            <ul className="space-y-1.5 text-xs">{activity.map((e) => <li key={e.seq} className="flex gap-2"><span className="font-mono accent">{e.actor.replace("agent:", "")}</span><span className="muted truncate">{e.action} {e.entityType}</span></li>)}</ul>
          </div>
        </Card>

        {incidents.length > 0 && (
          <Card title="Incidents" className="xl:col-span-3" action={<Link href="/incidents" className="accent text-xs font-medium">War room →</Link>}>
            <ul className="space-y-2 text-sm">{incidents.map((i) => <li key={i.id} className="flex items-center gap-2"><Pill>{i.severity}</Pill><span className="font-medium">{i.title}</span><span className="muted ml-auto text-xs">{formatIst(i.createdAt)}</span></li>)}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
