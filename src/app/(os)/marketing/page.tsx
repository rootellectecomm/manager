import Link from "next/link";
import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { Card, PageHeader, Pill, Button } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { startWorkflowAction } from "../../actions";

export const metadata = { title: "Marketing Intelligence" };

const WORKFLOWS = [
  { type: "daily-marketing", title: "Daily marketing review", report: "Daily marketing review", desc: "Google + Meta yesterday vs verified revenue. Budget changes become approval requests." },
  { type: "ga4-audit", title: "GA4 tracking audit", report: "GA4 tracking audit", desc: "GA4 purchase events vs captured payments, per day." },
  { type: "seo-control", title: "SEO control centre", report: "SEO control centre", desc: "Search Console + technical SEO findings from QA." },
];

export default async function Marketing() {
  const [connectors, reports] = await Promise.all([
    db.connector.findMany({ where: { key: { in: ["google_ads", "meta_ads", "ga4", "gsc", "merchant", "omnisend"] } } }),
    Promise.all(WORKFLOWS.map((w) => db.artifact.findFirst({ where: { kind: "report", title: { startsWith: w.report } }, orderBy: { createdAt: "desc" } }))),
  ]);
  return (
    <>
      <PageHeader title="Marketing Intelligence" subtitle="Every recommendation states what changed, why it matters, how reliable the data is, the root-cause hypothesis, the action, expected benefit, what could go wrong and how it will be measured. Correlation is never presented as causation." />
      <div className="mb-6 flex flex-wrap gap-2">{connectors.map((c) => <span key={c.key} className="surface flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">{c.name} <Pill>{c.status}</Pill></span>)}<Link href="/integrations" className="accent self-center text-xs font-medium">Connect →</Link></div>
      <div className="grid gap-6 xl:grid-cols-3">
        {WORKFLOWS.map((w, i) => (
          <Card key={w.type} title={w.title} action={<form action={startWorkflowAction}><input type="hidden" name="type" value={w.type} /><Button variant="ghost">Run now</Button></form>}>
            <p className="muted mb-3 text-xs">{w.desc}</p>
            {reports[i] ? <><div className="muted mb-2 text-xs">Latest: {formatIst(reports[i]!.createdAt)} · <Link href={`/reports/${reports[i]!.id}`} className="underline">open</Link></div><div className="max-h-[28rem] overflow-auto text-sm"><Markdown text={reports[i]!.content ?? ""} /></div></> : <p className="text-sm">No report yet.</p>}
          </Card>
        ))}
      </div>
    </>
  );
}
