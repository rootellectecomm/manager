import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { Card, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.artifact.findUnique({ where: { id } });
  if (!r) notFound();
  return (
    <>
      <PageHeader title={r.title} subtitle={`${r.kind} · ${formatIst(r.createdAt)}`} actions={<>
        <a href={`/api/artifacts/${r.id}?download=1`} className="surface rounded-lg px-3.5 py-2 text-sm">Download .md</a>
        {r.content?.includes("| Status |") && <a href={`/api/artifacts/${r.id}?format=csv`} className="surface rounded-lg px-3.5 py-2 text-sm">Download .csv</a>}
        {r.taskId && <Link href={`/tasks/${r.taskId}`} className="surface rounded-lg px-3.5 py-2 text-sm">Source task</Link>}
      </>} />
      <Card><div className="mx-auto max-w-4xl"><Markdown text={r.content ?? ""} /></div></Card>
    </>
  );
}
