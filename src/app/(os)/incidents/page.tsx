import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, inputCls, Button } from "@/components/ui";
import { incidentNoteAction, alertAction } from "../../actions";

export const metadata = { title: "Incident War Room" };

export default async function Incidents() {
  const [incidents, alerts] = await Promise.all([
    db.incident.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 30 }),
    db.alert.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { lastSeenAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <PageHeader title="Incident War Room" subtitle="SEV1/SEV2 alerts open an incident automatically. QA, Engineering, Commerce and the Chief of Staff work from one shared timeline, root cause and remediation plan." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {incidents.length === 0 && <Empty title="No incidents">Critical failures will open a war room here.</Empty>}
          {incidents.map((i) => {
            const timeline = parseJson<{ at: string; actor: string; note: string }[]>(i.timeline, []);
            return (
              <Card key={i.id} title={<span className="flex items-center gap-2"><Pill>{i.severity}</Pill>{i.title}</span>} action={<Pill>{i.status}</Pill>}>
                {i.summary && <p className="muted mb-3 whitespace-pre-wrap text-sm">{i.summary}</p>}
                <div className="text-sm"><span className="font-medium">Root cause:</span> {i.rootCause || <span className="muted">not yet established</span>}</div>
                <div className="muted mt-1 text-xs">Owners: {parseJson<string[]>(i.owners, []).join(", ")}</div>
                <ol className="line mt-4 space-y-2 border-l-2 pl-4 text-xs">{timeline.map((t, k) => <li key={k}><span className="muted">{formatIst(new Date(t.at))} · {t.actor}</span><div>{t.note}</div></li>)}</ol>
                {i.status !== "RESOLVED" && (
                  <form action={incidentNoteAction} className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                    <input type="hidden" name="id" value={i.id} />
                    <input name="note" placeholder="Timeline note" className={inputCls} />
                    <input name="rootCause" placeholder="Root cause (optional)" className={inputCls} />
                    <select name="status" className={inputCls} defaultValue=""><option value="">Keep status</option><option value="MITIGATED">Mitigated</option><option value="RESOLVED">Resolved</option></select>
                    <Button variant="ghost">Add</Button>
                  </form>
                )}
              </Card>
            );
          })}
        </div>
        <Card title={`Unresolved alerts (${alerts.length})`} pad={false}>
          <ul className="divide-y divide-[var(--line)]">
            {alerts.map((a) => (
              <li key={a.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-2"><Pill>{a.severity}</Pill><Pill>{a.status}</Pill>{a.count > 1 && <span className="muted text-xs">×{a.count}</span>}</div>
                <div className="mt-1 font-medium">{a.title}</div>
                <div className="muted line-clamp-3 text-xs">{a.detail}</div>
                <div className="mt-2 flex gap-3 text-xs">
                  {a.status === "OPEN" && <form action={alertAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="ack" /><button className="accent hover:underline">Acknowledge</button></form>}
                  <form action={alertAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="action" value="resolve" /><button className="muted hover:underline">Resolve</button></form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
