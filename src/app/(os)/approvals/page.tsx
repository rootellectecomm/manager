import Link from "next/link";
import { db } from "@/core/db/client";
import { formatInr, formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Table, Td } from "@/components/ui";

export const metadata = { title: "Approval Inbox" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "open" } = await searchParams;
  const where = view === "open" ? { status: { in: ["PENDING", "DEFERRED", "DELEGATED"] } } : {};
  const rows = await db.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
      <PageHeader title="Approval Inbox" subtitle="Every production, spend, publishing, pricing and outreach action waits here. Approval is enforced by the tool gateway — the exact parameters you approve are the only ones that can run. Silence is never approval." />
      <div className="mb-4 flex gap-2 text-sm">
        {["open", "all"].map((v) => <Link key={v} href={`/approvals?view=${v}`} className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-accent" : "surface"}`}>{v === "open" ? "Waiting" : "History"}</Link>)}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty title={view === "open" ? "Nothing is waiting for you" : "No approvals yet"} /></div> : (
          <Table head={["Request", "Agent", "Risk", "Est. cost", "Status", "Expires"]}>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-[var(--surface-2)]">
                <Td><Link href={`/approvals/${a.id}`} className="font-medium hover:underline">{a.title}</Link><div className="muted font-mono text-xs">{a.shortCode} · {a.toolKey}</div></Td>
                <Td className="text-xs">{a.agentCode}<div className="muted">{a.department}</div></Td>
                <Td><Pill tone={a.riskLevel >= 4 ? "bad" : a.riskLevel >= 3 ? "warn" : "info"}>{`L${a.riskLevel}`}</Pill></Td>
                <Td className="num">{formatInr(a.estCostInr)}</Td>
                <Td><Pill>{a.status}</Pill></Td>
                <Td className="muted text-xs">{formatIst(a.expiresAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
