import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { formatInr, formatIst } from "@/core/time";
import { Card, Kv, PageHeader, Pill, Simulated, Button } from "@/components/ui";
import { taskOverrideAction, runTaskAction } from "../../../actions";

interface Output { summary?: string; recommendation?: string; findings?: { title: string; detail: string; verified: boolean; evidenceRefs: string[] }[]; risks?: string[]; measurement?: string; missingInformation?: string[]; dataReliability?: string; claimIssues?: { match: string; issue: string }[]; simulated?: boolean; provider?: string; model?: string; proposedActions?: { tool: string; reason: string }[] }

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await db.task.findUnique({ where: { id }, include: { owner: { include: { manager: true } }, project: true, parent: true, subtasks: { include: { owner: true } }, events: { orderBy: { createdAt: "asc" } }, dependsOn: { include: { dependsOn: true } } } });
  if (!t) notFound();
  const [execs, approvals, artifacts, debates] = await Promise.all([
    db.execution.findMany({ where: { taskId: id }, orderBy: { startedAt: "desc" }, take: 25 }),
    db.approvalRequest.findMany({ where: { taskId: id } }),
    db.artifact.findMany({ where: { taskId: id } }),
    db.debate.findMany({ where: { taskId: id } }),
  ]);
  const out = parseJson<Output | null>(t.output, null);
  const evidence = parseJson<{ kind: string; ref: string; note?: string; at?: string }[]>(t.evidence, []);
  const criteria = parseJson<string[]>(t.acceptanceCriteria, []);
  const closed = ["COMPLETED", "CANCELLED"].includes(t.status);
  return (
    <>
      <PageHeader title={t.title} subtitle={`${t.project ? `${t.project.title} · ` : ""}created ${formatIst(t.createdAt)} · source ${t.source}`} actions={<>
        <Pill>{t.status}</Pill>
        {!closed && t.ownerAgentId && <form action={runTaskAction}><input type="hidden" name="id" value={t.id} /><Button variant="ghost">Run owner agent</Button></form>}
        {!closed && !["PAUSED", "BLOCKED"].includes(t.status) && <form action={taskOverrideAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="action" value="pause" /><Button variant="ghost">Pause</Button></form>}
        {["PAUSED", "BLOCKED"].includes(t.status) && <form action={taskOverrideAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="action" value="resume" /><Button variant="ghost">Resume</Button></form>}
        {!closed && <form action={taskOverrideAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="action" value="cancel" /><Button variant="danger">Cancel</Button></form>}
      </>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Brief">
            <Kv k="Objective" v={<span className="whitespace-pre-wrap">{t.objective}</span>} />
            <Kv k="Owner" v={t.owner ? <Link className="hover:underline" href={`/organization/${t.owner.code}`}>{t.owner.code} {t.owner.name}{t.owner.manager ? ` → reviewed by ${t.owner.manager.code}` : ""}</Link> : "Unassigned"} />
            <Kv k="Priority / risk" v={`P${t.priority} · risk level ${t.riskLevel}`} />
            <Kv k="Due" v={t.dueAt ? formatIst(t.dueAt) : "—"} />
            <Kv k="Acceptance criteria" v={criteria.length ? <ul className="list-disc pl-4">{criteria.map((c) => <li key={c}>{c}</li>)}</ul> : "—"} />
            <Kv k="Cost" v={`${formatInr(t.actualCostInr, 2)} actual`} />
            {t.statusReason && <Kv k="Status note" v={t.statusReason} />}
            {t.dependsOn.length > 0 && <Kv k="Depends on" v={t.dependsOn.map((d) => <Link key={d.id} className="mr-2 underline" href={`/tasks/${d.dependsOnId}`}>{d.dependsOn.title} ({d.dependsOn.status.toLowerCase()})</Link>)} />}
          </Card>
          {out && (
            <Card title={<span className="flex items-center gap-2">Latest deliverable {out.simulated && <Simulated />}</span>} action={<span className="muted text-xs">{out.provider} {out.model}</span>}>
              {out.summary && <p className="text-sm">{out.summary}</p>}
              {!!out.claimIssues?.length && <div className="mt-3 rounded-lg bg-plum-50 p-3 text-xs text-plum-700">Claims issues: {out.claimIssues.map((c) => `"${c.match}" (${c.issue})`).join(", ")}</div>}
              {!!out.findings?.length && <div className="mt-4 space-y-2">{out.findings.map((f, i) => <div key={i} className="line rounded-lg border p-3 text-sm"><div className="flex items-center gap-2 font-medium">{f.title}{f.verified ? <Pill tone="good">verified</Pill> : <Pill tone="info">assumption</Pill>}</div><div className="muted mt-1">{f.detail}</div>{f.evidenceRefs.length > 0 && <div className="muted mt-1 font-mono text-[11px]">{f.evidenceRefs.join(" · ")}</div>}</div>)}</div>}
              {out.recommendation && <Kv k="Recommendation" v={out.recommendation} />}
              {out.dataReliability && <Kv k="Data reliability" v={out.dataReliability} />}
              {!!out.risks?.length && <Kv k="What could go wrong" v={out.risks.join("; ")} />}
              {out.measurement && <Kv k="Measurement" v={out.measurement} />}
              {!!out.missingInformation?.length && <Kv k="Missing information" v={out.missingInformation.join("; ")} />}
            </Card>
          )}
          <Card title={`Executions (${execs.length})`} pad={false}>
            <ul className="divide-y divide-[var(--line)] text-sm">{execs.map((e) => <li key={e.id} className="flex items-center gap-3 px-5 py-2"><Pill>{e.status}</Pill><span className="font-mono text-xs">{e.kind === "tool" ? e.toolKey : `${e.provider} ${e.model}`}</span><span className="muted text-xs">{e.agentCode}</span><span className="muted ml-auto text-xs">{formatIst(e.startedAt)}</span>{e.error && <span className="w-full text-xs text-plum-600">{e.error.slice(0, 200)}</span>}</li>)}</ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title={`Evidence (${evidence.length})`}>
            {evidence.length === 0 ? <p className="muted text-sm">No execution evidence yet — this task cannot be verified.</p> : <ul className="space-y-2 text-xs">{evidence.map((e, i) => <li key={i}><Pill tone="info">{e.kind}</Pill> <span className="font-mono">{e.ref.startsWith("http") ? <a href={e.ref} target="_blank" rel="noreferrer" className="underline">{e.ref}</a> : e.ref}</span>{e.note && <div className="muted">{e.note}</div>}</li>)}</ul>}
          </Card>
          <Card title="Timeline">
            <ol className="space-y-2.5 text-xs">{t.events.map((e) => <li key={e.id}><div className="flex items-center gap-2"><Pill>{e.toState}</Pill><span className="muted">{formatIst(e.createdAt)}</span></div><div className="muted mt-0.5">{e.actor}{e.note ? ` — ${e.note}` : ""}</div></li>)}</ol>
          </Card>
          {(approvals.length > 0 || debates.length > 0 || artifacts.length > 0 || t.subtasks.length > 0) && (
            <Card title="Linked">
              <ul className="space-y-1.5 text-sm">
                {approvals.map((a) => <li key={a.id}><Link className="hover:underline" href={`/approvals/${a.id}`}>{a.shortCode} {a.title}</Link> <Pill>{a.status}</Pill></li>)}
                {debates.map((d) => <li key={d.id}><Link className="hover:underline" href={`/debates/${d.id}`}>Debate: {d.outcome ?? d.status}</Link></li>)}
                {artifacts.map((a) => <li key={a.id}><Link className="hover:underline" href={a.kind === "report" || a.kind === "creative" ? `/reports/${a.id}` : `/api/artifacts/${a.id}`}>{a.kind}: {a.title}</Link></li>)}
                {t.subtasks.map((s) => <li key={s.id}><Link className="hover:underline" href={`/tasks/${s.id}`}>↳ {s.title}</Link> <Pill>{s.status}</Pill></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
