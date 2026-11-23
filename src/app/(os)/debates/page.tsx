import Link from "next/link";
import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { formatInr, formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Table, Td } from "@/components/ui";

export const metadata = { title: "Agent Debate Room" };

export default async function Debates({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = await db.debate.findMany({ where: q ? { OR: [{ question: { contains: q, mode: "insensitive" } }, { recommendation: { contains: q, mode: "insensitive" } }] } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  const outcomes = await db.debate.groupBy({ by: ["outcome"], _count: true });
  return (
    <>
      <PageHeader title="Agent Debate Room" subtitle="Five rounds across OpenAI, Claude and Gemini: independent analysis → competing solutions → adversarial challenge → evidence verification with real tools → final decisions. Agreement alone never counts as proof." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {outcomes.map((o) => <span key={o.outcome ?? "running"} className="surface rounded-lg px-3 py-1.5 text-xs"><Pill>{o.outcome ?? "RUNNING"}</Pill> <span className="num ml-1">{o._count}</span></span>)}
        <form className="ml-auto"><input name="q" defaultValue={q} placeholder="Search decisions…" className="rounded-lg px-3 py-1.5 text-sm" /></form>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty title="No debates yet">Important decisions (production fixes, budget shifts, strategy) are routed here automatically, or agents can request one.</Empty></div> : (
          <Table head={["Decision question", "Panel", "Outcome", "Cost", "When"]}>
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-[var(--surface-2)]">
                <Td><Link href={`/debates/${d.id}`} className="font-medium hover:underline">{d.question}</Link>{d.recommendation && <div className="muted line-clamp-1 text-xs">{d.recommendation}</div>}</Td>
                <Td className="text-xs">{parseJson<string[]>(d.panel, []).join(", ")}</Td>
                <Td><Pill>{d.outcome ?? d.status}</Pill></Td>
                <Td className="num text-xs">{formatInr(d.costInr, 2)}</Td>
                <Td className="muted text-xs">{formatIst(d.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
