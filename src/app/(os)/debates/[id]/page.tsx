import { notFound } from "next/navigation";
import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { formatInr, formatIst } from "@/core/time";
import { Card, Kv, PageHeader, Pill, Simulated } from "@/components/ui";

const ROUND = ["", "Independent analysis", "Competing solutions", "Adversarial challenge", "Evidence & verification", "Final decision"];
const OUTCOME_COPY: Record<string, string> = {
  CONSENSUS_SUPPORTED: "All three providers independently chose the same option, critical assumptions were tested with real read-only checks, and none were refuted.",
  CONSENSUS_UNVERIFIED: "All three agree, but critical assumptions were not verified with evidence. Treat as a strong hypothesis, not proof.",
  MAJORITY: "Two providers agree; one dissents. Read the dissent before deciding.",
  SPLIT: "No agreement. Compare the options and their scores below.",
  REDUCED_PANEL: "At least one provider was unavailable, so this is not a full three-model review.",
  FAILED: "The debate could not complete.",
};

export default async function DebateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await db.debate.findUnique({ where: { id }, include: { rounds: { orderBy: [{ round: "asc" }, { alias: "asc" }] } } });
  if (!d) notFound();
  const options = parseJson<{ id: string; title: string; proposedBy: string[]; summary: string }[]>(d.options, []);
  const scores = parseJson<{ simulated?: boolean; scores?: Record<string, number>; evidence?: { supported: number; refuted: number; total: number; toolChecks: number; toolChecksOk: boolean }; votes?: Record<string, string[]>; unavailable?: string[] }>(d.scores, {});
  return (
    <>
      <PageHeader title={d.question} subtitle={`${formatIst(d.createdAt)} · panel ${parseJson<string[]>(d.panel, []).join(", ")} · cost ${formatInr(d.costInr, 2)}`} actions={<>{scores.simulated && <Simulated />}<Pill>{d.outcome ?? d.status}</Pill></>} />
      {scores.simulated && <div className="mb-6 rounded-xl border border-gold-300 bg-gold-100 px-5 py-3 text-sm text-gold-700 dark:border-gold-700 dark:bg-[#2a2310] dark:text-gold-300">This debate used the simulated provider (no AI keys connected). It exercises the workflow only — its conclusions are not real analysis.</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Arbiter's result" className="lg:col-span-2">
          {d.outcome && <p className="mb-3 text-sm">{OUTCOME_COPY[d.outcome]}</p>}
          <Kv k="Recommendation" v={<span className="font-medium">{d.recommendation ?? "—"}</span>} />
          {d.dissent && <Kv k="Dissent" v={<span className="whitespace-pre-wrap">{d.dissent}</span>} />}
          {scores.evidence && <Kv k="Evidence" v={`${scores.evidence.supported} assumptions supported · ${scores.evidence.refuted} refuted · ${scores.evidence.total - scores.evidence.supported - scores.evidence.refuted} untested · ${scores.evidence.toolChecks} read-only tool check(s) ${scores.evidence.toolChecksOk ? "ran" : "could not all run"}`} />}
          {!!scores.unavailable?.length && <Kv k="Unavailable" v={scores.unavailable.join(", ")} />}
          {d.context && <Kv k="Context" v={<span className="muted whitespace-pre-wrap text-xs">{d.context}</span>} />}
        </Card>
        <Card title="Options">
          <ul className="space-y-3 text-sm">{options.map((o) => <li key={o.id}><div className="flex items-center gap-2"><span className="font-mono text-xs">{o.id}</span><span className="font-medium">{o.title}</span>{scores.scores?.[o.id] !== undefined && <span className="num muted ml-auto text-xs">score {scores.scores[o.id]}</span>}</div><div className="muted text-xs">votes: {(scores.votes?.[o.id] ?? []).join(", ") || "none"} · proposed by {o.proposedBy.join(", ")}</div></li>)}</ul>
        </Card>
      </div>
      {[1, 2, 3, 4, 5].map((r) => {
        const rows = d.rounds.filter((x) => x.round === r);
        if (!rows.length) return null;
        return (
          <Card key={r} title={`Round ${r} — ${ROUND[r]}`} className="mt-6">
            <div className="grid gap-4 lg:grid-cols-3">
              {rows.map((x) => (
                <div key={x.id} className="line surface-2 rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold">{x.alias}</span><span className="muted">{x.provider}</span></div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">{JSON.stringify(JSON.parse(x.content), null, 2)}</pre>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
