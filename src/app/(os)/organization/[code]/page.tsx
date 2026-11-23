import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/core/db/client";
import { agentLists } from "@/core/org/registry";
import { TOOL_POLICIES } from "@/core/tools/policies";
import { formatInr, formatIst, istMonthStart } from "@/core/time";
import { Card, Field, Kv, PageHeader, Pill, inputCls, Button } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { updateAgentAction, duplicateAgentAction, agentStatusAction } from "../../../actions";

export default async function AgentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const a = await db.agent.findUnique({ where: { code }, include: { department: true, manager: true, reports: true, versions: { orderBy: { version: "desc" }, take: 10 } } });
  if (!a) notFound();
  const L = agentLists(a);
  const [tasks, monthCost, failed, deniedTools] = await Promise.all([
    db.task.findMany({ where: { ownerAgentId: a.id }, orderBy: { updatedAt: "desc" }, take: 12 }),
    db.modelUsage.aggregate({ _sum: { costInr: true, tokensIn: true, tokensOut: true }, where: { agentCode: code, createdAt: { gte: istMonthStart() } } }),
    db.execution.count({ where: { agentCode: code, status: "FAILED" } }),
    db.execution.count({ where: { agentCode: code, status: "BLOCKED" } }),
  ]);
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  return (
    <>
      <PageHeader title={a.name} subtitle={`${a.code} · ${a.department.name}${a.manager ? ` · reports to ${a.manager.code} ${a.manager.name}` : " · reports to the founder"} · version ${a.version}`} actions={<>
        <Pill>{a.status}</Pill>
        {a.status !== "ACTIVE" && <form action={agentStatusAction}><input type="hidden" name="code" value={a.code} /><input type="hidden" name="status" value="ACTIVE" /><Button variant="gold">Promote to Active</Button></form>}
        {a.status === "ACTIVE" && <form action={agentStatusAction}><input type="hidden" name="code" value={a.code} /><input type="hidden" name="status" value="SHADOW" /><Button variant="ghost">Return to shadow</Button></form>}
      </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Configuration">
            <ActionForm action={updateAgentAction} submit="Save new version">
              <input type="hidden" name="code" value={a.code} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Role description"><textarea name="description" defaultValue={a.description} rows={2} className={inputCls} /></Field></div>
                <Field label="Responsibilities" help="One per line"><textarea name="responsibilities" defaultValue={L.responsibilities.join("\n")} rows={5} className={inputCls} /></Field>
                <Field label="KPIs" help="One per line"><textarea name="kpis" defaultValue={L.kpis.join("\n")} rows={5} className={inputCls} /></Field>
                <div className="md:col-span-2"><Field label="Founder instructions for this role" help="Added to the agent's working instructions on every task."><textarea name="instructions" defaultValue={a.instructions} rows={3} className={inputCls} /></Field></div>
                <Field label="Primary model provider"><select name="providerPrimary" defaultValue={a.providerPrimary} className={inputCls}>{["anthropic", "openai", "gemini"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Fallback provider"><select name="providerFallback" defaultValue={a.providerFallback} className={inputCls}>{["openai", "anthropic", "gemini"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Model tier" help="fast for routine extraction, deep for strategy"><select name="modelTier" defaultValue={a.modelTier} className={inputCls}>{["fast", "balanced", "deep"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Status"><select name="status" defaultValue={a.status} className={inputCls}>{["ACTIVE", "SHADOW", "PAUSED", "RETIRED"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Max autonomous risk" help="0 read-only · 1 drafts · 2 standing approvals. Level 3+ always needs you."><select name="maxAutonomousRisk" defaultValue={String(a.maxAutonomousRisk)} className={inputCls}>{[0, 1, 2].map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Monthly budget (₹)"><input name="monthlyBudgetInr" type="number" min="0" defaultValue={a.monthlyBudgetInr} className={inputCls} /></Field>
                <Field label="Daily token budget"><input name="dailyTokenBudget" type="number" min="0" defaultValue={a.dailyTokenBudget} className={inputCls} /></Field>
                <Field label="Change note"><input name="changeNote" placeholder="Why this change" className={inputCls} /></Field>
              </div>
              <div className="mt-5">
                <div className="mb-2 text-sm font-medium">Tool permissions</div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {TOOL_POLICIES.map((t) => (
                    <label key={t.key} className="flex items-start gap-2 text-xs"><input type="checkbox" name="tools" value={t.key} defaultChecked={L.tools.includes(t.key)} className="mt-0.5" /><span><span className="font-mono">{t.key}</span> <span className={`ml-1 rounded px-1 text-[10px] ${t.risk >= 3 ? "bg-plum-50 text-plum-700" : t.risk === 2 ? "bg-gold-100 text-gold-700" : "muted"}`}>L{t.risk}</span><span className="muted block">{t.title}</span></span></label>
                  ))}
                </div>
              </div>
            </ActionForm>
          </Card>
          <Card title="Recent work" pad={false}>
            <ul className="divide-y divide-[var(--line)] text-sm">{tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-2"><Link href={`/tasks/${t.id}`} className="flex-1 hover:underline">{t.title}</Link><Pill>{t.status}</Pill></li>)}{!tasks.length && <li className="muted px-5 py-3">No tasks yet.</li>}</ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Performance">
            <Kv k="Completed (recent)" v={`${completed} of ${tasks.length}`} />
            <Kv k="Spend this month" v={`${formatInr(monthCost._sum.costInr ?? 0, 2)} of ${formatInr(a.monthlyBudgetInr)}`} />
            <Kv k="Tokens this month" v={((monthCost._sum.tokensIn ?? 0) + (monthCost._sum.tokensOut ?? 0)).toLocaleString("en-IN")} />
            <Kv k="Failed executions" v={failed} />
            <Kv k="Blocked by policy" v={deniedTools} />
          </Card>
          <Card title="Escalates when">
            <ul className="list-disc space-y-1 pl-4 text-sm">{L.escalation.map((e) => <li key={e}>{e}</li>)}</ul>
            <div className="mt-3 text-sm font-medium">Deliverables</div>
            <ul className="muted list-disc pl-4 text-sm">{L.deliverables.map((e) => <li key={e}>{e}</li>)}</ul>
          </Card>
          {a.reports.length > 0 && <Card title={`Team (${a.reports.length})`}><ul className="space-y-1 text-sm">{a.reports.map((r) => <li key={r.id}><Link className="hover:underline" href={`/organization/${r.code}`}>{r.code} {r.name}</Link></li>)}</ul></Card>}
          <Card title="Version history">
            <ol className="space-y-2 text-xs">{a.versions.map((v) => <li key={v.id}><span className="font-medium">v{v.version}</span> <span className="muted">· {formatIst(v.createdAt)} · {v.changedBy.split(":")[0]}</span><div className="muted">{v.changeNote}</div></li>)}</ol>
          </Card>
          <Card title="Duplicate this role">
            <form action={duplicateAgentAction} className="flex gap-2"><input type="hidden" name="code" value={a.code} /><input name="name" placeholder={`${a.name} II`} className={inputCls} /><Button variant="ghost">Duplicate</Button></form>
          </Card>
        </div>
      </div>
    </>
  );
}
