import Link from "next/link";
import { db } from "@/core/db/client";
import { formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Table, Td, Button } from "@/components/ui";
import { startWorkflowAction } from "../../actions";

export const metadata = { title: "Browser Operations" };

export default async function Qa({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const sessions = await db.browserSession.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  const latestRun = run ?? (await db.testResult.findFirst({ where: { suite: { not: "single" } }, orderBy: { createdAt: "desc" } }))?.runId;
  const [results, shots, uptime] = await Promise.all([
    latestRun ? db.testResult.findMany({ where: { runId: latestRun }, orderBy: [{ status: "asc" }, { check: "asc" }] }) : [],
    db.artifact.findMany({ where: { kind: { in: ["screenshot", "trace"] } }, orderBy: { createdAt: "desc" }, take: 12 }),
    db.testResult.findMany({ where: { suite: "single" }, orderBy: { createdAt: "desc" }, take: 96 }),
  ]);
  const up = uptime.filter((u) => u.status === "PASS").length;
  return (
    <>
      <PageHeader title="Browser Operations" subtitle="API first → deterministic Playwright → AI-assisted browsing → human-assisted. Live-site checks are production-safe: no orders, no payments, no customer data. Transaction tests belong on staging or test mode."
        actions={<><form action={startWorkflowAction}><input type="hidden" name="type" value="website-audit" /><Button>Full website audit</Button></form><form action={startWorkflowAction}><input type="hidden" name="type" value="storefront-check" /><Button variant="ghost">Heartbeat check</Button></form></>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={latestRun ? `Latest run · ${latestRun.slice(0, 8)}` : "Latest run"} className="xl:col-span-2" pad={false}>
          {results.length === 0 ? <div className="p-5"><Empty title="No test runs yet">Run a website audit to test availability, product pages, structured data, links, images, SEO metadata, security headers and the add-to-cart journey.</Empty></div> : (
            <Table head={["Status", "Check", "Target", "Detail"]} dense>
              {results.map((r) => <tr key={r.id}><Td dense><Pill>{r.status}</Pill></Td><Td dense className="font-medium">{r.check}<div className="muted text-[11px]">{r.suite}</div></Td><Td dense className="max-w-[16rem] truncate text-xs">{r.target}</Td><Td dense className="muted text-xs">{r.detail}</Td></tr>)}
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Storefront heartbeat">
            <div className="serif num text-3xl font-semibold">{uptime.length ? `${((up / uptime.length) * 100).toFixed(1)}%` : "—"}</div>
            <div className="muted text-xs">{uptime.length} checks (every 15 min)</div>
            <div className="mt-3 flex flex-wrap gap-0.5">{uptime.slice().reverse().map((u) => <span key={u.id} title={`${formatIst(u.createdAt)} ${u.detail}`} className={`h-5 w-1.5 rounded-sm ${u.status === "PASS" ? "bg-forest-400" : "bg-plum-400"}`} />)}</div>
          </Card>
          <Card title="Sessions" pad={false}>
            <ul className="divide-y divide-[var(--line)] text-xs">{sessions.map((s) => <li key={s.id} className="px-5 py-2.5"><div className="flex items-center gap-2"><Pill tone="info">{s.mode}</Pill><Pill>{s.status}</Pill><span className="muted ml-auto">{formatIst(s.startedAt)}</span></div><div className="muted mt-1 line-clamp-2">{s.summary}</div></li>)}</ul>
          </Card>
        </div>
        <Card title="Evidence: screenshots & traces" className="xl:col-span-3">
          {shots.length === 0 ? <p className="muted text-sm">Browser journeys store screenshots and Playwright traces here (install Playwright’s Chromium on the worker host).</p> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {shots.map((s) => s.kind === "screenshot" ? (
                <a key={s.id} href={`/api/artifacts/${s.id}`} target="_blank" rel="noreferrer" className="line block overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/artifacts/${s.id}`} alt={s.title} className="aspect-[4/3] w-full object-cover object-top" />
                  <div className="muted truncate px-2 py-1 text-[11px]">{s.title}</div>
                </a>
              ) : <a key={s.id} href={`/api/artifacts/${s.id}`} className="line grid aspect-[4/3] place-items-center rounded-lg border text-xs">⬇ {s.title}</a>)}
            </div>
          )}
          <p className="muted mt-3 text-xs">Open traces with <code>npx playwright show-trace trace.zip</code>. <Link className="underline" href="/reports">Audit reports →</Link></p>
        </Card>
      </div>
    </>
  );
}
