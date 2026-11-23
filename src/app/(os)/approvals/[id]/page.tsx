import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { formatInr, formatIst } from "@/core/time";
import { verifyToken } from "@/core/crypto";
import { Card, Kv, PageHeader, Pill } from "@/components/ui";
import { ApprovalButtons } from "@/components/client";
import { decideApprovalAction } from "../../../actions";

export default async function ApprovalDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const a = await db.approvalRequest.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!a) notFound();
  let linkValid: boolean | null = null;
  if (t) { try { linkValid = verifyToken<{ approvalId: string }>(t)?.approvalId === id; } catch { linkValid = false; } }
  const evidence = parseJson<{ kind: string; ref: string; note?: string }[]>(a.evidence, []);
  const open = ["PENDING", "DEFERRED", "DELEGATED"].includes(a.status) && a.expiresAt > new Date();
  const agent = await db.agent.findUnique({ where: { code: a.agentCode } });
  return (
    <>
      <PageHeader title={a.title} subtitle={`${a.shortCode} · requested by ${a.agentCode}${agent ? ` ${agent.name}` : ""} · ${formatIst(a.createdAt)}`} actions={<Pill>{a.status}</Pill>} />
      {linkValid === false && <div className="mb-4 rounded-lg bg-plum-50 px-4 py-2 text-sm text-plum-700">This approval link has expired or is invalid. You can still decide here because you’re signed in.</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Proposed action">
            <Kv k="Tool" v={<span className="font-mono text-xs">{a.toolKey}</span>} />
            <Kv k="Risk level" v={<Pill tone={a.riskLevel >= 4 ? "bad" : "warn"}>{`Level ${a.riskLevel}`}</Pill>} />
            <Kv k="Exact parameters" v={<pre className="surface-2 line overflow-x-auto rounded-lg border p-3 text-xs">{JSON.stringify(JSON.parse(a.params), null, 2)}</pre>} />
            <Kv k="Parameter hash" v={<span className="muted font-mono text-[11px]">{a.paramsHash}</span>} />
          </Card>
          <Card title="Why">
            <Kv k="Reason" v={a.reason} />
            <Kv k="Expected impact" v={a.expectedImpact || "—"} />
            <Kv k="Estimated cost" v={formatInr(a.estCostInr)} />
            <Kv k="Risk assessment" v={a.riskAssessment || "—"} />
            <Kv k="Rollback plan" v={a.rollbackPlan || <span className="text-plum-600">No rollback plan supplied</span>} />
            <Kv k="Recommendation" v={a.recommendation || "—"} />
          </Card>
          <Card title={`Evidence (${evidence.length})`}>
            {evidence.length === 0 ? <p className="muted text-sm">No evidence attached — consider requesting changes.</p> : (
              <ul className="space-y-2 text-sm">{evidence.map((e, i) => <li key={i}><Pill tone="info">{e.kind}</Pill> <span className="font-mono text-xs">{e.ref.startsWith("http") ? <a className="underline" href={e.ref} target="_blank" rel="noreferrer">{e.ref}</a> : e.kind === "debate" ? <Link className="underline" href={`/debates/${e.ref}`}>{e.ref}</Link> : e.ref}</span>{e.note && <div className="muted mt-0.5 text-xs">{e.note}</div>}</li>)}</ul>
            )}
            {a.taskId && <Link href={`/tasks/${a.taskId}`} className="accent mt-4 inline-block text-sm font-medium">Open the task →</Link>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Your decision">
            {open ? (
              <>
                <p className="muted mb-3 text-xs">Expires {formatIst(a.expiresAt)}. If you do nothing, the action stays paused.{a.riskLevel >= 3 ? " Level 3+ can only be approved here, not over WhatsApp." : ""}</p>
                {agent?.status === "SHADOW" && <p className="mb-3 rounded-lg bg-gold-100 px-3 py-2 text-xs text-gold-700">{agent.name} is in shadow mode: approving records your decision, but the action won’t execute until you promote the agent to Active.</p>}
                <ApprovalButtons action={decideApprovalAction} id={a.id} riskLevel={a.riskLevel} />
              </>
            ) : <p className="text-sm">Decided: <Pill>{a.status}</Pill>{a.decisionNote && <span className="muted mt-2 block text-xs">{a.decisionNote}</span>}</p>}
          </Card>
          <Card title="History">
            <ol className="space-y-2 text-xs">{a.events.map((e) => <li key={e.id}><span className="font-medium">{e.event}</span> <span className="muted">· {e.actor.startsWith("founder:") ? "you" : e.actor.replace("agent:", "")} via {e.channel} · {formatIst(e.createdAt)}</span>{e.note && <div className="muted">{e.note}</div>}</li>)}</ol>
          </Card>
        </div>
      </div>
    </>
  );
}
