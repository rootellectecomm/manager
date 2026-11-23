/**
 * Website audit — the first production milestone scenario (docs/acceptance.md):
 * founder request → Chief of Staff project → QA tests with evidence → defect tasks →
 * engineering investigation → manager validation → debate (if important) → fix PR →
 * CI status → founder approval → merge only after approval → production re-verification →
 * evidence report → founder notification. Every step is checkpointed and audited.
 */
import { db } from "../db/client";
import { j } from "../db/json";
import { audit } from "../audit";
import { defineWorkflow } from "./engine";
import { createTask, transitionTask } from "../tasks/service";
import { executeTool } from "../tools/gateway";
import { runAgentOnTask, managerReview } from "../ai/agent-runner";
import { runDebate } from "../ai/debate";
import { notifyFounder } from "../comms/notify";
import { getSetting, SETTING_KEYS } from "../settings";
import { formatIst } from "../time";

interface AuditInput { baseUrl?: string; requestedBy?: string; browser?: boolean; verifyDelayMs?: number }
type Suite = { runId: string; base: string; pass: number; warn: number; fail: number; failures: { check: string; target: string; detail: string }[] };

defineWorkflow("website-audit", async (ctx) => {
  const input = ctx.input as AuditInput;
  const base = input.baseUrl || (await getSetting(SETTING_KEYS.storefrontUrl, "https://rootellect.com"));
  const actor = input.requestedBy ?? "system:schedule";

  // 1–2. Chief of Staff opens a project and assigns QA + Engineering.
  const setup = await ctx.step("project", async () => {
    const project = await db.project.create({ data: { title: `Website audit · ${formatIst(new Date(), false)}`, objective: `Audit ${base}: availability, product pages, SEO, structured data, links, images, mobile, checkout entry.`, createdBy: actor } });
    const qa = await createTask({ title: "Run website audit", objective: `Run production-safe synthetic checks${input.browser !== false ? " and browser journeys" : ""} on ${base}; record evidence.`, source: actor.startsWith("founder") ? "founder" : "schedule", projectId: project.id, ownerAgentCode: "C01", riskLevel: 0, priority: 2, acceptanceCriteria: ["Every check stored with result and detail", "Failures triaged into defect tasks with reproduction steps"], actor: "agent:A01" });
    await audit({ actor: "agent:A01", action: "project.create", entityType: "project", entityId: project.id, data: { kind: "website-audit", base } });
    return { projectId: project.id, qaTaskId: qa.task.id };
  });
  await ctx.step("qa-start", () => transitionTask(setup.qaTaskId, "EXECUTING", "agent:C01", "audit started").then(() => true));

  // 3–4. Tests run via the gateway (read-only tools); results/screenshots/traces stored.
  const suite = await ctx.step("synthetic", async () => {
    const r = await executeTool({ agentCode: "C03", toolKey: "qa.synthetic_check", params: { suite: "storefront", url: base }, taskId: setup.qaTaskId, runId: ctx.runId });
    if (r.status !== "ok") throw new Error(`Synthetic suite could not run: ${JSON.stringify(r)}`);
    const o = r.output as Suite;
    return { runId: o.runId, base: o.base, pass: o.pass, warn: o.warn, fail: o.fail, failures: o.failures } satisfies Suite;
  });
  const browser = input.browser === false ? null : await ctx.step("browser", async () => {
    const r = await executeTool({ agentCode: "C03", toolKey: "qa.browser_run", params: { journey: "home_to_cart", baseUrl: base }, taskId: setup.qaTaskId, runId: ctx.runId });
    return r.status === "ok" ? (r.output as { runId: string; status: string; steps: { name: string; status: string; detail: string }[]; screenshots: string[] }) : { runId: "", status: "SKIP", steps: [], screenshots: [], error: r };
  });
  const browserFailures = (browser?.steps ?? []).filter((s) => s.status === "FAIL").map((s) => ({ check: `Browser: ${s.name}`, target: base, detail: s.detail }));
  // Most severe first: anything blocking purchase (availability, checkout, price, cart) leads.
  const severity = (c: string) => (/availability|checkout|add-to-cart|add to cart|price/i.test(c) ? 0 : /structured data|sitemap|robots|images/i.test(c) ? 1 : 2);
  const failures = [...suite.failures, ...browserFailures].sort((a, b) => severity(a.check) - severity(b.check));

  await ctx.step("qa-evidence", () => transitionTask(setup.qaTaskId, "TESTING", "agent:C01", `${suite.pass} pass · ${suite.warn} warn · ${failures.length} fail`, {
    evidence: [{ kind: "test-run", ref: `synthetic:${suite.runId}` }, ...(browser?.runId ? [{ kind: "test-run", ref: `browser:${browser.runId}` }] : [])],
    testResults: [{ synthetic: { pass: suite.pass, warn: suite.warn, fail: suite.fail } }, ...(browser ? [{ browser: browser.status }] : [])],
  }).then(() => true));

  // 5. Each failure becomes a tracked defect task (deduplicated per check+target per day).
  const defects = await ctx.step("defects", async () => {
    const ids: string[] = [];
    for (const f of failures.slice(0, 10)) {
      const { task } = await createTask({
        title: `Defect: ${f.check}`, objective: `${f.check} failed on ${f.target}.\nDetail: ${f.detail}\n\nReproduce: request ${f.target} (see QA run ${suite.runId}).`,
        source: "workflow", trigger: `website-audit:${ctx.runId}`, projectId: setup.projectId, parentId: setup.qaTaskId, ownerAgentCode: "B02", riskLevel: 1, priority: /availability|checkout|price|add-to-cart/i.test(f.check) ? 1 : 2,
        acceptanceCriteria: ["Root cause identified", "Fix prepared as a pull request", "Check passes in production after release"],
        inputs: { failure: f, qaRunId: suite.runId }, dedupeKey: `defect:${f.check}:${f.target}:${new Date().toISOString().slice(0, 10)}`, actor: "agent:C01",
      });
      ids.push(task.id);
    }
    return ids;
  });

  await ctx.step("qa-review", () => transitionTask(setup.qaTaskId, "MANAGER_REVIEW", "agent:C01", "audit complete").then(() => transitionTask(setup.qaTaskId, "VERIFIED", "agent:A01", "results stored with evidence")).then(() => transitionTask(setup.qaTaskId, "COMPLETED", "agent:A01")).then(() => true));

  let fixOutcome: Record<string, unknown> = { status: "no-defects" };
  if (defects.length) {
    const defectId = defects[0];
    const failure = failures[0];
    // 6. Engineering investigates with the evidence.
    const investigation = await ctx.step("investigate", async () => {
      await transitionTask(defectId, "RESEARCHING", "agent:B02", "investigating");
      return runAgentOnTask(defectId, {
        workflowRunId: ctx.runId,
        evidence: [{ ref: `qa:${suite.runId}`, data: failure }],
        extraInstructions: "Investigate the failure. If a code change is needed, propose exactly one github.create_pr action with a descriptive branch (fix/...), title and body describing the change and its test plan. Do not propose merges or deployments — those need founder approval later.",
        simulationContext: { failingChecks: [failure.check], evidence: [`qa:${suite.runId}`], proposeFix: true, important: /availability|checkout/i.test(failure.check) },
      });
    });
    // 7. Manager validation.
    await ctx.step("to-execute", () => transitionTask(defectId, "EXECUTING", "agent:B02", "investigation submitted", { evidence: [{ kind: "qa-run", ref: suite.runId }] }).then(() => true));
    const review = await ctx.step("review", () => managerReview(defectId, investigation, { workflowRunId: ctx.runId }));

    // 8. Important issues go to the five-round debate.
    const important = /availability|checkout|price|add-to-cart|sitemap|robots/i.test(failure.check) || investigation.needsDebate;
    const debate = important ? await runDebate(ctx, {
      question: `How should we resolve "${failure.check}" on ${failure.target}?`, context: `${investigation.summary}\nProposed: ${investigation.recommendation}`, taskId: defectId,
      evidence: [{ ref: `qa:${suite.runId}`, data: failure }], simulation: { verifyUrl: failure.target },
    }) : null;

    // 9. Fix PR (level 1 — allowed without approval; never merges).
    const pr = await ctx.step("pull-request", async () => {
      const prop = investigation.proposedActions.find((a) => a.tool === "github.create_pr");
      if (!prop) return { status: "none", reason: "Agent did not propose a code change" };
      const r = await executeTool({ agentCode: "B02", toolKey: "github.create_pr", params: prop.params, taskId: defectId, runId: ctx.runId });
      return r.status === "ok" ? { status: "ok", ...(r.output as { number: number; url: string }), branch: String(prop.params.branch) } : { status: r.status, reason: "reason" in r ? r.reason : "error" in r ? r.error : "" };
    });

    if (pr.status === "ok" && "number" in pr) {
      // 10. Automated tests (CI checks on the PR branch).
      const ci = await ctx.step("ci", async () => {
        const r = await executeTool({ agentCode: "B01", toolKey: "github.read", params: { what: "checks", ref: (pr as { branch: string }).branch }, taskId: defectId, runId: ctx.runId });
        return r.status === "ok" ? (r.output as { state: string; checks: string[] }) : { state: "unknown", checks: [] };
      });
      await ctx.step("testing", () => transitionTask(defectId, "TESTING", "agent:B01", `CI: ${ci.state}`, { evidence: [{ kind: "pull-request", ref: (pr as { url: string }).url }], testResults: [{ ci }] }).then(() => transitionTask(defectId, "MANAGER_REVIEW", "agent:B01", `review ${review.verdict}`)).then(() => true));

      if (ci.state === "failure") {
        await ctx.step("ci-failed", () => transitionTask(defectId, "NEEDS_REWORK", "agent:B01", `CI failed: ${ci.checks.join(", ")}`).then(() => true));
        fixOutcome = { status: "ci-failed", pr };
      } else {
        // 11. Production approval request (level 3) — merge happens only after approval.
        const ask = await ctx.step("request-approval", async () => {
          const r = await executeTool({
            agentCode: "B01", toolKey: "github.merge_pr", params: { number: (pr as { number: number }).number }, taskId: defectId, runId: ctx.runId,
            approval: {
              title: `Release fix: ${failure.check}`, reason: `QA found "${failure.check}" failing on ${failure.target}. ${investigation.rootCauseHypothesis}`,
              evidence: [{ kind: "qa-run", ref: suite.runId }, { kind: "pull-request", ref: (pr as { url: string }).url }, ...(debate ? [{ kind: "debate", ref: debate.debateId, note: `${debate.outcome}: ${debate.recommendation}` }] : [])],
              expectedImpact: investigation.expectedBenefit || "Restores the failing check", estCostInr: 0,
              riskAssessment: `Manager review: ${review.verdict}. CI: ${ci.state}.${debate ? ` Debate: ${debate.outcome}.` : ""}`,
              rollbackPlan: "Revert the merge commit and redeploy the previous Vercel deployment (instant rollback).",
              recommendation: debate?.recommendation ?? investigation.recommendation, urgency: important ? "high" : "normal",
            },
          });
          if (r.status !== "approval_required") throw new Error(`Expected an approval request, got ${r.status}`);
          return { approvalId: r.approvalId, shortCode: r.shortCode };
        });
        await ctx.step("await-approval", () => transitionTask(defectId, "AWAITING_APPROVAL", "agent:B01", `approval ${ask.shortCode} requested`).then(() => true));

        // 12–13. Founder decides through an authenticated control; the run parks until then.
        const decision = await ctx.waitForApproval(ask.approvalId);
        if (decision !== "APPROVED") {
          await ctx.step("declined", () => transitionTask(defectId, "NEEDS_REWORK", "system:workflow", `Founder decision: ${decision}`).then(() => true));
          fixOutcome = { status: "not-approved", decision, pr };
        } else {
          const merge = await ctx.step("merge", async () => {
            const r = await executeTool({ agentCode: "B01", toolKey: "github.merge_pr", params: { number: (pr as { number: number }).number }, taskId: defectId, runId: ctx.runId, approvalId: ask.approvalId });
            return { status: r.status, detail: r };
          });
          if (merge.status !== "ok") {
            await ctx.step("merge-failed", () => transitionTask(defectId, "NEEDS_REWORK", "system:workflow", `Merge failed: ${JSON.stringify(merge.detail).slice(0, 300)}`).then(() => true));
            fixOutcome = { status: "merge-failed", merge };
          } else {
            await ctx.step("released", () => transitionTask(defectId, "RELEASED", "agent:B07", "merged after founder approval", { evidence: [{ kind: "merge", ref: `${(pr as { url: string }).url}`, note: ask.shortCode }] }).then(() => true));
            // 14. Verify production behaviour after the deploy has had time to roll out.
            const delayMs = input.verifyDelayMs ?? Number(await getSetting("post_release_verify_minutes", "4")) * 60_000;
            await ctx.sleepUntil(new Date(await ctx.step("verify-at", async () => Date.now() + delayMs)));
            const verify = await ctx.step("verify", async () => {
              const r = await executeTool({ agentCode: "C01", toolKey: "qa.synthetic_check", params: { suite: "storefront", url: base }, taskId: defectId, runId: ctx.runId });
              const o = r.status === "ok" ? (r.output as Suite) : null;
              const stillFailing = o?.failures.some((f) => f.check === failure.check && f.target === failure.target) ?? true;
              return { runId: o?.runId ?? "", stillFailing };
            });
            if (verify.stillFailing) {
              await ctx.step("verify-failed", () => transitionTask(defectId, "NEEDS_REWORK", "agent:C01", "Check still failing in production after release").then(() => true));
              fixOutcome = { status: "not-resolved-in-production", verify };
            } else {
              await ctx.step("verified", () => transitionTask(defectId, "VERIFIED", "agent:C01", "passes in production", { evidence: [{ kind: "test-run", ref: `synthetic:${verify.runId}`, note: "post-release verification" }] }).then(() => transitionTask(defectId, "COMPLETED", "agent:A01")).then(() => true));
              fixOutcome = { status: "resolved", pr, verifyRun: verify.runId };
            }
          }
        }
      }
    } else {
      await ctx.step("no-pr", () => transitionTask(defectId, "MANAGER_REVIEW", "agent:B02", `No PR created: ${(pr as { reason?: string }).reason ?? pr.status}`).then(() => true));
      fixOutcome = { status: "pr-not-created", pr };
    }
  }

  // 15–16. Evidence-based report + founder notification.
  const report = await ctx.step("report", async () => {
    const results = await db.testResult.findMany({ where: { runId: { in: [suite.runId, ...(browser?.runId ? [browser.runId] : [])] } } });
    const md = [
      `# Website audit — ${base}`, `Run ${ctx.runId} · ${formatIst(new Date())}`, "",
      `**Synthetic:** ${suite.pass} pass · ${suite.warn} warn · ${suite.fail} fail${browser ? ` · **Browser journey:** ${browser.status}` : ""}`, "",
      "## Failures", ...(failures.length ? failures.map((f) => `- **${f.check}** — ${f.target}\n  ${f.detail}`) : ["None"]), "",
      "## Fix pipeline", "```json", JSON.stringify(fixOutcome, null, 2), "```", "",
      "## All checks", "| Status | Check | Target | Detail |", "|---|---|---|---|",
      ...results.map((r) => `| ${r.status} | ${r.check} | ${r.target.replace(base, "") || "/"} | ${r.detail.replace(/\|/g, "/").slice(0, 160)} |`), "",
      `Evidence: test runs ${suite.runId}${browser?.runId ? `, ${browser.runId}` : ""}; screenshots and traces under Artifacts.`,
    ].join("\n");
    const art = await db.artifact.create({ data: { kind: "report", title: `Website audit · ${formatIst(new Date(), false)}`, content: md, taskId: setup.qaTaskId } });
    await notifyFounder({ severity: "REPORT", subject: `Website audit: ${failures.length} failing check(s)`, body: `${suite.pass} pass · ${suite.warn} warn · ${failures.length} fail.\nFix pipeline: ${String(fixOutcome.status)}.\nReport: ${art.id}`, dedupeKey: `audit-report:${ctx.runId}` });
    return { artifactId: art.id };
  });
  await ctx.step("record", () => audit({ actor: "agent:A01", action: "website_audit.complete", entityType: "project", entityId: setup.projectId, data: { fail: failures.length, fix: fixOutcome.status, report: report.artifactId } }).then(() => true));
  return { projectId: setup.projectId, failures: failures.length, defects, fix: fixOutcome, reportId: report.artifactId, qaRunId: suite.runId };
}, { maxAttempts: 4, description: "Founder/scheduled website audit with fix → approval → verify pipeline" });

export const _keep = j;
