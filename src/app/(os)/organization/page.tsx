import Link from "next/link";
import { db } from "@/core/db/client";
import { istMonthStart, formatInr } from "@/core/time";
import { Card, PageHeader, Pill } from "@/components/ui";
import { agentStatusAction } from "../../actions";

export const metadata = { title: "AI Organization" };

export default async function Organization() {
  const [depts, open, done, cost] = await Promise.all([
    db.department.findMany({ orderBy: { sortOrder: "asc" }, include: { agents: { orderBy: [{ isManager: "desc" }, { code: "asc" }] } } }),
    db.task.groupBy({ by: ["ownerAgentId"], _count: true, where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    db.task.groupBy({ by: ["ownerAgentId"], _count: true, where: { status: "COMPLETED" } }),
    db.modelUsage.groupBy({ by: ["agentCode"], _sum: { costInr: true }, where: { createdAt: { gte: istMonthStart() } } }),
  ]);
  const m = (rows: { ownerAgentId: string | null; _count: number }[], id: string) => rows.find((r) => r.ownerAgentId === id)?._count ?? 0;
  const total = depts.reduce((s, d) => s + d.agents.length, 0);
  return (
    <>
      <PageHeader title="AI Organization" subtitle={`Founder → AI Chief of Staff → ${depts.length} department managers → ${total} specialised agents. Agents are configurations instantiated on demand — not ${total} running processes. New agents start in shadow mode (observe and propose only).`} />
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {depts.map((d) => (
          <Card key={d.id} title={<span><span className="muted mr-2 font-mono">{d.code}</span>{d.name}</span>} pad={false}>
            <p className="muted px-5 pt-3 text-xs">{d.description}</p>
            <ul className="divide-y divide-[var(--line)] pt-2">
              {d.agents.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="muted w-8 font-mono text-xs">{a.code}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/organization/${a.code}`} className="font-medium hover:underline">{a.name}</Link>
                    {a.isManager && <span className="ml-2 rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gold-700 dark:bg-[#2a2310] dark:text-gold-300">{a.code === "A01" ? "Chief of Staff" : "Manager"}</span>}
                    <div className="muted text-xs">{a.providerPrimary} · {a.modelTier} · {m(open, a.id)} open · {m(done, a.id)} done · {formatInr(cost.find((c) => c.agentCode === a.code)?._sum.costInr ?? 0)} this month</div>
                  </div>
                  <Pill>{a.status}</Pill>
                  <form action={agentStatusAction}>
                    <input type="hidden" name="code" value={a.code} />
                    <input type="hidden" name="status" value={a.status === "PAUSED" ? "SHADOW" : "PAUSED"} />
                    <button className="muted text-xs hover:underline" title={a.status === "PAUSED" ? "Resume in shadow mode" : "Pause agent"}>{a.status === "PAUSED" ? "Resume" : "Pause"}</button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
