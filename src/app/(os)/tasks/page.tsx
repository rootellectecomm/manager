import Link from "next/link";
import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { STATE_LABEL, type TaskState } from "@/core/tasks/lifecycle";
import { Card, Empty, Field, PageHeader, Pill, Table, Td, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { cancelRunAction, newTaskAction } from "../../actions";

export const metadata = { title: "Task Command Center" };

const GROUPS: Record<string, string[] | null> = {
  active: ["NEW", "TRIAGED", "ASSIGNED", "RESEARCHING", "PLANNED", "EXECUTING", "TESTING", "MANAGER_REVIEW", "RELEASED", "VERIFIED"],
  approval: ["AWAITING_APPROVAL"],
  attention: ["BLOCKED", "FAILED", "NEEDS_REWORK", "PAUSED"],
  COMPLETED: ["COMPLETED"],
  all: null,
};

export default async function Tasks({ searchParams }: { searchParams: Promise<{ status?: string; dept?: string }> }) {
  const { status = "active", dept } = await searchParams;
  const states = GROUPS[status] ?? GROUPS.active;
  const [tasks, agents, depts, runs, counts] = await Promise.all([
    db.task.findMany({ where: { ...(states ? { status: { in: states } } : {}), ...(dept ? { department: { code: dept } } : {}) }, include: { owner: true, project: true }, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }], take: 200 }),
    db.agent.findMany({ where: { status: { notIn: ["RETIRED"] } }, orderBy: { code: "asc" }, select: { code: true, name: true } }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    db.workflowRun.findMany({ orderBy: { updatedAt: "desc" }, take: 15 }),
    db.task.groupBy({ by: ["status"], _count: true }),
  ]);
  const n = (list: string[] | null) => counts.filter((c) => !list || list.includes(c.status)).reduce((s, c) => s + c._count, 0);
  return (
    <>
      <PageHeader title="Task Command Center" subtitle="Every unit of work, its owner, state, evidence and deadline. Tasks only complete after verification with evidence." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {Object.keys(GROUPS).map((g) => <Link key={g} href={`/tasks?status=${g}${dept ? `&dept=${dept}` : ""}`} className={`rounded-lg px-3 py-1.5 ${status === g ? "bg-accent" : "surface"}`}>{{ active: "Active", approval: "Awaiting approval", attention: "Needs attention", COMPLETED: "Completed", all: "All" }[g]} <span className="num opacity-70">{n(GROUPS[g])}</span></Link>)}
        <span className="muted mx-2 self-center">|</span>
        <Link href={`/tasks?status=${status}`} className={`rounded-lg px-2.5 py-1.5 ${!dept ? "bg-accent" : "surface"}`}>All depts</Link>
        {depts.map((d) => <Link key={d.code} href={`/tasks?status=${status}&dept=${d.code}`} title={d.name} className={`rounded-lg px-2.5 py-1.5 ${dept === d.code ? "bg-accent" : "surface"}`}>{d.code}</Link>)}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card pad={false} className="xl:col-span-2">
          {tasks.length === 0 ? <div className="p-5"><Empty title="No tasks here">Start an audit, give the Chief of Staff an objective, or create a task.</Empty></div> : (
            <Table head={["Task", "Owner", "Priority", "State", "Updated"]}>
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--surface-2)]">
                  <Td><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>{t.project && <div className="muted text-xs">{t.project.title}</div>}{t.statusReason && <div className="muted line-clamp-1 text-xs">{t.statusReason}</div>}</Td>
                  <Td className="text-xs">{t.owner ? <Link className="hover:underline" href={`/organization/${t.owner.code}`}>{t.owner.code} {t.owner.name}</Link> : <span className="muted">Unassigned</span>}</Td>
                  <Td className="num">P{t.priority}</Td>
                  <Td><Pill>{STATE_LABEL[t.status as TaskState] ? t.status : t.status}</Pill>{t.dueAt && t.dueAt < new Date() && t.status !== "COMPLETED" && <div className="mt-1"><Pill tone="bad">overdue</Pill></div>}</Td>
                  <Td className="muted text-xs">{formatIst(t.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Create a task">
            <ActionForm action={newTaskAction} submit="Create task">
              <div className="space-y-3">
                <Field label="Title"><input name="title" required className={inputCls} /></Field>
                <Field label="Objective"><textarea name="objective" required rows={3} className={inputCls} /></Field>
                <Field label="Owner"><select name="owner" className={inputCls}><option value="">Chief of Staff decides later</option>{agents.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority"><select name="priority" defaultValue="3" className={inputCls}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select></Field>
                  <Field label="Due"><input type="date" name="due" className={inputCls} /></Field>
                </div>
                <Field label="Acceptance criteria" help="One per line"><textarea name="criteria" rows={2} className={inputCls} /></Field>
                <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" name="start" defaultChecked /> Start the owner agent now</label>
              </div>
            </ActionForm>
          </Card>
          <Card title="Workflow runs" pad={false}>
            <ul className="divide-y divide-[var(--line)] text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-2 px-5 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate">{r.workflowType}</div><div className="muted truncate text-xs">{formatIst(r.updatedAt)}{r.error ? ` · ${r.error}` : ""}</div></div>
                  <Pill>{r.status}</Pill>
                  {["PENDING", "WAITING", "RUNNING"].includes(r.status) && <form action={cancelRunAction}><input type="hidden" name="id" value={r.id} /><button className="muted text-xs hover:underline">Cancel</button></form>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
