import Link from "next/link";
import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Table, Td, Button } from "@/components/ui";
import { startWorkflowAction } from "../../actions";

export const metadata = { title: "Reports" };

export default async function Reports() {
  const rows = await db.artifact.findMany({ where: { kind: { in: ["report", "creative"] } }, orderBy: { createdAt: "desc" }, take: 150 });
  return (
    <>
      <PageHeader title="Reports" subtitle="Executive briefs, audits, reviews and drafts — each linked to the evidence and tasks it came from. Download as Markdown or CSV."
        actions={<><form action={startWorkflowAction}><input type="hidden" name="type" value="executive-brief" /><Button>Executive brief</Button></form><form action={startWorkflowAction}><input type="hidden" name="type" value="weekly-review" /><Button variant="ghost">Weekly review</Button></form></>} />
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-5"><Empty title="No reports yet" /></div> : (
          <Table head={["Report", "Kind", "Created", ""]}>
            {rows.map((r) => <tr key={r.id} className="hover:bg-[var(--surface-2)]"><Td><Link href={`/reports/${r.id}`} className="font-medium hover:underline">{r.title}</Link></Td><Td><Pill tone="info">{r.kind}</Pill></Td><Td className="muted text-xs">{formatIst(r.createdAt)}</Td><Td className="text-xs"><a href={`/api/artifacts/${r.id}?download=1`} className="accent hover:underline">Download</a></Td></tr>)}
          </Table>
        )}
      </Card>
    </>
  );
}
