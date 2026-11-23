import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { verifyAuditAction } from "../../actions";

export const metadata = { title: "Audit & Security" };

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; actor?: string }> }) {
  const { q, actor } = await searchParams;
  const where = { ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" as const } }, { entityId: { contains: q } }, { data: { contains: q, mode: "insensitive" as const } }] } : {}), ...(actor ? { actor: { startsWith: actor } } : {}) };
  const [events, denied, total] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { seq: "desc" }, take: 200 }),
    db.auditEvent.count({ where: { action: { in: ["tool.denied", "tool.param_mismatch", "approval.decide.denied", "agent.update.denied", "auth.login_failed"] } } }),
    db.auditEvent.count(),
  ]);
  return (
    <>
      <PageHeader title="Audit & Security" subtitle={`${total.toLocaleString("en-IN")} events in an append-only, hash-chained log: every approval, tool call, permission change, login and setting. ${denied} blocked or denied attempts recorded.`} />
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <ActionForm action={verifyAuditAction} submit="Verify chain integrity" variant="ghost"><span /></ActionForm>
          <form className="ml-auto flex flex-wrap gap-2">
            <input name="q" defaultValue={q} placeholder="Search action, entity, data…" className="rounded-lg px-3 py-2 text-sm" />
            <select name="actor" defaultValue={actor ?? ""} className="rounded-lg px-3 py-2 text-sm"><option value="">All actors</option><option value="founder:">Founder</option><option value="agent:">Agents</option><option value="system:">System</option><option value="workflow:">Workflows</option></select>
            <button className="bg-accent rounded-lg px-3 py-2 text-sm">Filter</button>
          </form>
        </div>
      </Card>
      <Card pad={false}>
        <Table head={["#", "When", "Actor", "Action", "Entity", "Data"]} dense>
          {events.map((e) => <tr key={e.seq}><Td dense className="muted num text-xs">{e.seq}</Td><Td dense className="muted whitespace-nowrap text-xs">{formatIst(e.createdAt)}</Td><Td dense className="font-mono text-xs">{e.actor.length > 32 ? `${e.actor.slice(0, 32)}…` : e.actor}</Td><Td dense className={`text-xs ${/denied|mismatch|failed/.test(e.action) ? "font-semibold text-plum-600" : ""}`}>{e.action}</Td><Td dense className="text-xs">{e.entityType}<div className="muted max-w-[10rem] truncate font-mono text-[10px]">{e.entityId}</div></Td><Td dense className="muted max-w-md truncate font-mono text-[11px]">{e.data}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
