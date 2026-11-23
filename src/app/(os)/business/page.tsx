import Link from "next/link";
import { db } from "@/core/db/client";
import { formatInr, formatIst } from "@/core/time";
import { Card, Empty, PageHeader, Pill, Table, Td, Button } from "@/components/ui";
import { productCostAction, startWorkflowAction } from "../../actions";

export const metadata = { title: "Business Intelligence" };

export default async function Business() {
  const [metrics, costs, recon, channels] = await Promise.all([
    db.businessMetric.findMany({ orderBy: { capturedAt: "desc" }, take: 60 }),
    db.productCost.findMany({ orderBy: { sku: "asc" } }),
    db.workflowRun.findFirst({ where: { workflowType: "reconciliation", status: "COMPLETED" }, orderBy: { updatedAt: "desc" } }),
    db.connector.findMany({ where: { key: { in: ["razorpay", "shiprocket", "amazon_sp", "rootellect_backend", "merchant", "flipkart", "nykaa"] } } }),
  ]);
  const latest = new Map<string, (typeof metrics)[number]>();
  for (const m of metrics) if (!latest.has(m.key)) latest.set(m.key, m);
  const reconResult = recon?.result ? JSON.parse(recon.result) as { captured?: number; shipments?: number; unmatched?: string[]; failedPayments?: number; skipped?: boolean; reason?: string } : null;
  const missingCost = costs.filter((c) => c.unitCostInr === null);
  return (
    <>
      <PageHeader title="Business Intelligence" subtitle="Figures come only from connected systems. Verified and estimated numbers are always shown separately; missing inputs are flagged, never filled in silently."
        actions={<form action={startWorkflowAction}><input type="hidden" name="type" value="reconciliation" /><Button variant="ghost">Run reconciliation now</Button></form>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Latest metrics" className="xl:col-span-2" pad={false}>
          {latest.size === 0 ? <div className="p-5"><Empty title="No business data yet">Connect Razorpay and Shiprocket (and Amazon SP-API) in the <Link href="/integrations" className="underline">Integration Hub</Link>. Reconciliation runs hourly and records verified revenue.</Empty></div> : (
            <Table head={["Metric", "Value", "Source", "Quality", "As of"]}>
              {[...latest.values()].map((m) => (
                <tr key={m.id}><Td className="font-mono text-xs">{m.key}</Td><Td className="num font-medium">{m.unit === "INR" ? formatInr(m.value) : m.unit === "ratio" ? `${(m.value * 100).toFixed(1)}%` : m.value.toLocaleString("en-IN")}</Td><Td className="text-xs">{m.source}</Td><Td>{m.verified ? <Pill tone="good">verified</Pill> : <Pill tone="warn">estimate</Pill>}</Td><Td className="muted text-xs">{formatIst(m.capturedAt)}</Td></tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Payment ↔ shipment reconciliation">
          {!reconResult ? <p className="muted text-sm">Not run yet.</p> : reconResult.skipped ? <p className="text-sm">{reconResult.reason}</p> : (
            <div className="space-y-2 text-sm">
              <div>Captured payments (30h): <strong className="num">{reconResult.captured}</strong></div>
              <div>Shiprocket orders (3d): <strong className="num">{reconResult.shipments}</strong></div>
              <div>Failed payments: <strong className="num">{reconResult.failedPayments}</strong></div>
              <div>Paid without shipment: {reconResult.unmatched?.length ? <Pill tone="bad">{`${reconResult.unmatched.length} unmatched`}</Pill> : <Pill tone="good">none</Pill>}</div>
              <div className="muted text-xs">Last run {formatIst(recon!.updatedAt)}</div>
            </div>
          )}
        </Card>
        <Card title="Contribution margin inputs" className="xl:col-span-2">
          {missingCost.length > 0 && <p className="mb-3 rounded-lg bg-gold-100 px-3 py-2 text-xs text-gold-700 dark:bg-[#2a2310] dark:text-gold-300">{missingCost.length} product(s) have no unit cost. Margin reports will mark them incomplete rather than estimate.</p>}
          <Table head={["Product", "Unit cost (₹)", "Packaging (₹)", ""]} dense>
            {costs.map((c) => (
              <tr key={c.sku}><Td dense>{c.name}<div className="muted font-mono text-[11px]">{c.sku}</div></Td>
                <Td dense colSpan={3}>
                  <form action={productCostAction} className="flex items-center gap-2"><input type="hidden" name="sku" value={c.sku} /><input name="unitCostInr" type="number" step="0.01" defaultValue={c.unitCostInr ?? ""} placeholder="not set" className="w-28 rounded-lg px-2 py-1 text-sm" /><input name="packagingInr" type="number" step="0.01" defaultValue={c.packagingInr ?? ""} placeholder="not set" className="w-28 rounded-lg px-2 py-1 text-sm" /><button className="accent text-xs hover:underline">Save</button></form>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Commerce connections">
          <ul className="space-y-2 text-sm">{channels.map((c) => <li key={c.key} className="flex items-center justify-between"><span>{c.name}</span><Pill>{c.status}</Pill></li>)}</ul>
          <Link href="/integrations" className="accent mt-3 inline-block text-xs font-medium">Manage →</Link>
        </Card>
      </div>
    </>
  );
}
