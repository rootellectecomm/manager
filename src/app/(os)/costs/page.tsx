import { db } from "@/core/db/client";
import { formatInr, istDayStart, istMonthStart } from "@/core/time";
import { Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { budgetAction } from "../../actions";

export const metadata = { title: "AI Cost Center" };

export default async function Costs() {
  const day = istDayStart(), month = istMonthStart();
  const [today, mtd, byProvider, byAgent, budgets, unverified, debates] = await Promise.all([
    db.modelUsage.aggregate({ _sum: { costInr: true, tokensIn: true, tokensOut: true }, where: { createdAt: { gte: day } } }),
    db.modelUsage.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: month } } }),
    db.modelUsage.groupBy({ by: ["provider", "model"], _sum: { costInr: true, tokensIn: true, tokensOut: true }, _count: true, where: { createdAt: { gte: month } } }),
    db.modelUsage.groupBy({ by: ["agentCode"], _sum: { costInr: true }, _count: true, where: { createdAt: { gte: month } }, orderBy: { _sum: { costInr: "desc" } }, take: 15 }),
    db.budget.findMany(),
    db.modelUsage.count({ where: { costVerified: false, createdAt: { gte: month } } }),
    db.debate.aggregate({ _sum: { costInr: true }, _count: true, where: { createdAt: { gte: month } } }),
  ]);
  return (
    <>
      <PageHeader title="AI Cost Center" subtitle="Every model call is metered per provider, agent, task and debate. Budgets are enforced before each call — when a budget runs out, work pauses (it never loops) and you're alerted." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Today" value={formatInr(today._sum.costInr ?? 0, 2)} hint={`${((today._sum.tokensIn ?? 0) + (today._sum.tokensOut ?? 0)).toLocaleString("en-IN")} tokens`} />
        <Stat label="Month to date" value={formatInr(mtd._sum.costInr ?? 0, 2)} />
        <Stat label="Debates this month" value={debates._count} hint={formatInr(debates._sum.costInr ?? 0, 2)} />
        <Stat label="Estimated-price calls" value={unverified} hint="no price set for model → estimate" tone={unverified ? "warn" : "default"} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Budgets" pad={false}>
          <Table head={["Scope", "Period", "Limit"]} dense>
            {budgets.map((b) => <tr key={b.id}><Td dense>{b.scope}{b.scopeRef !== "*" ? ` · ${b.scopeRef}` : ""}</Td><Td dense>{b.period}</Td><Td dense><form action={budgetAction} className="flex items-center gap-2"><input type="hidden" name="id" value={b.id} /><input name="limitInr" type="number" min="0" defaultValue={b.limitInr} className="w-24 rounded-lg px-2 py-1 text-sm" /><button className="accent text-xs hover:underline">Save</button></form></Td></tr>)}
          </Table>
          <p className="muted px-5 py-3 text-xs">Per-agent monthly budgets and daily token limits are set on each agent’s page.</p>
        </Card>
        <Card title="By provider & model (month)" pad={false} className="xl:col-span-2">
          <Table head={["Provider", "Model", "Calls", "Tokens", "Cost"]} dense>
            {byProvider.map((p) => <tr key={`${p.provider}${p.model}`}><Td dense>{p.provider}</Td><Td dense className="font-mono text-xs">{p.model}</Td><Td dense className="num">{p._count}</Td><Td dense className="num">{((p._sum.tokensIn ?? 0) + (p._sum.tokensOut ?? 0)).toLocaleString("en-IN")}</Td><Td dense className="num">{formatInr(p._sum.costInr ?? 0, 2)}</Td></tr>)}
          </Table>
        </Card>
        <Card title="Top agents by spend (month)" pad={false} className="xl:col-span-3">
          <Table head={["Agent", "Calls", "Cost"]} dense>
            {byAgent.map((a) => <tr key={a.agentCode ?? "none"}><Td dense>{a.agentCode ?? "system"}</Td><Td dense className="num">{a._count}</Td><Td dense className="num">{formatInr(a._sum.costInr ?? 0, 2)}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
