import { db } from "@/core/db/client";
import { searchKnowledge } from "@/core/knowledge/service";
import { formatIst } from "@/core/time";
import { Card, Field, PageHeader, Pill, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { knowledgeAction } from "../../actions";

export const metadata = { title: "Knowledge Center" };

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  const { q, cat } = await searchParams;
  const rows = q ? await searchKnowledge(q, { limit: 40, category: cat }) : (await db.knowledgeEntry.findMany({ where: { supersededBy: null, ...(cat ? { category: cat } : {}) }, orderBy: [{ verified: "asc" }, { updatedAt: "desc" }], take: 100 })).map((r) => ({ ...r, score: 0 }));
  const cats = await db.knowledgeEntry.groupBy({ by: ["category"], _count: true, where: { supersededBy: null } });
  return (
    <>
      <PageHeader title="Knowledge Center" subtitle="Company memory with provenance. Verified facts (from you or connected systems) are kept separate from agent-proposed assumptions. Corrections create a new version; nothing is edited in place. Instructions found in documents or web pages are never treated as commands." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <form className="flex flex-wrap gap-2">
            <input name="q" defaultValue={q} placeholder="Search knowledge…" className="min-w-64 flex-1 rounded-lg px-3 py-2 text-sm" />
            <select name="cat" defaultValue={cat ?? ""} className="rounded-lg px-3 py-2 text-sm"><option value="">All categories</option>{cats.map((c) => <option key={c.category} value={c.category}>{c.category} ({c._count})</option>)}</select>
            <button className="bg-accent rounded-lg px-3 py-2 text-sm">Search</button>
          </form>
          {rows.map((r) => (
            <Card key={r.id} title={<span className="flex items-center gap-2">{r.title}{r.verified ? <Pill tone="good">verified</Pill> : <Pill tone="warn">unverified</Pill>}<Pill tone="info">{r.category}</Pill></span>}>
              <p className="whitespace-pre-wrap text-sm">{r.body}</p>
              <div className="muted mt-2 text-xs">Source: {r.source}{r.provenance ? ` · ${r.provenance}` : ""} · {formatIst(r.updatedAt)}</div>
              <details className="mt-3 text-sm">
                <summary className="accent cursor-pointer text-xs font-medium">Correct or verify</summary>
                <div className="mt-2 flex flex-col gap-3">
                  {!r.verified && <ActionForm action={knowledgeAction} submit="Mark verified" variant="ghost"><input type="hidden" name="op" value="verify" /><input type="hidden" name="id" value={r.id} /></ActionForm>}
                  <ActionForm action={knowledgeAction} submit="Save correction" variant="ghost"><input type="hidden" name="op" value="correct" /><input type="hidden" name="id" value={r.id} /><textarea name="body" defaultValue={r.body} rows={4} className={inputCls} /></ActionForm>
                </div>
              </details>
            </Card>
          ))}
        </div>
        <Card title="Add a verified fact">
          <ActionForm action={knowledgeAction} submit="Add to company memory">
            <input type="hidden" name="op" value="add" />
            <div className="space-y-3">
              <Field label="Title"><input name="title" required className={inputCls} /></Field>
              <Field label="Category"><select name="category" className={inputCls}>{["company", "product", "claims", "brand", "sop", "strategy", "decision", "preference"].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Fact"><textarea name="body" required rows={6} className={inputCls} /></Field>
              <Field label="Provenance" help="Where this comes from (document, meeting, lab report…)"><input name="provenance" className={inputCls} /></Field>
              <Field label="Expires" help="Optional — for prices, offers, temporary policies"><input name="expiresAt" type="date" className={inputCls} /></Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
