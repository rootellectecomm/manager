/**
 * SIMULATED provider — deterministic stand-in used only when ALLOW_SIMULATED_PROVIDER=true
 * (tests, demos, first-run walkthroughs). Every output says it is simulated.
 * It never produces business metrics; it only shapes plausible structure around
 * the evidence it is given, so the workflow plumbing can be exercised end to end.
 */
const TAG = "[SIMULATED]";

export function simulate(purpose: string, ctx: Record<string, unknown>, provider: string): unknown {
  const subject = String(ctx.subject ?? ctx.title ?? "the request");
  const evidence = (ctx.evidence as string[] | undefined) ?? [];
  const failing = (ctx.failingChecks as string[] | undefined) ?? [];
  switch (purpose) {
    case "agent_task":
      return {
        summary: `${TAG} Reviewed "${subject}". ${failing.length ? `${failing.length} failing check(s) found.` : "No failing checks in the supplied evidence."}`,
        findings: failing.map((f) => ({ title: f, detail: `${TAG} Reported by the QA run.`, evidenceRefs: evidence.slice(0, 2), verified: true })),
        recommendation: failing.length ? `${TAG} Prepare a fix branch for: ${failing[0]}` : `${TAG} No action needed.`,
        whatChanged: failing.length ? "QA detected a regression." : "No change detected.",
        whyItMatters: "Storefront issues directly affect conversion and trust.",
        dataReliability: evidence.length ? "high" : "low",
        rootCauseHypothesis: failing.length ? `${TAG} Recent template change likely removed the element.` : "",
        expectedBenefit: failing.length ? "Restores the affected journey." : "",
        risks: failing.length ? ["Fix could affect other templates"] : [],
        measurement: "Re-run the website audit after deployment.",
        missingInformation: [],
        proposedActions: failing.length && ctx.proposeFix
          ? [{ tool: "github.create_pr", params: { title: `Fix: ${failing[0]}`, branch: `fix/${String(failing[0]).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, body: `${TAG} Automated fix proposal` }, reason: "Prepare reviewed fix", expectedImpact: "Resolves failing check", rollbackPlan: "Close PR", estCostInr: 0 }]
          : [],
        toolRequests: [],
        confidence: failing.length ? 0.7 : 0.6,
        needsDebate: Boolean(ctx.important),
      };
    case "manager_review":
      return { verdict: ctx.hasEvidence === false ? "rework" : "accept", acceptanceCheck: ((ctx.criteria as string[]) ?? []).map((c) => ({ criterion: c, met: ctx.hasEvidence !== false, note: TAG })), unsupportedClaims: [], complianceIssues: [], note: `${TAG} Manager review by rule-check.` };
    case "debate_r1":
      return { diagnosis: `${TAG} ${provider} view of ${subject}`, evidence: evidence.slice(0, 3), missingInformation: [], rootCauseHypotheses: ["Template regression"], recommendation: provider === "gemini" && ctx.splitVote ? "Roll back the last deployment" : "Ship a targeted fix behind review", optionTitle: provider === "gemini" && ctx.splitVote ? "Roll back deployment" : "Targeted fix", risks: ["Regression elsewhere"], confidence: 0.7 };
    case "debate_r2":
      return { evaluations: [], betterAlternative: "", revisedRecommendation: `${TAG} Keep the targeted fix; add a regression test.` };
    case "debate_r3":
      return { challengedOption: "Targeted fix", failedAssumptions: [], failureModes: ["Fix passes in staging but production data differs"], unsupportedClaims: [], whyStrongestMightFail: `${TAG} Staging may not reflect production.`, verificationRequests: ctx.verifyUrl ? [{ tool: "qa.synthetic_check", params: { url: ctx.verifyUrl }, assumption: "The page responds and renders product data" }] : [] };
    case "debate_r4":
      return { assumptionChecks: [{ assumption: "The page responds and renders product data", status: ctx.verificationPassed === false ? "refuted" : "supported", evidenceRef: "round4-tool-output" }], updatedRecommendation: `${TAG} Proceed with targeted fix.`, changedMind: false };
    case "debate_r5": {
      const options = (ctx.options as { id: string; title: string }[]) ?? [{ id: "O1", title: "Targeted fix" }];
      const pick = provider === "gemini" && ctx.splitVote ? options[options.length - 1].id : options[0].id;
      return { recommendedOption: pick, reasons: [`${TAG} Lowest risk, reversible`], evidenceRefs: ["round4-tool-output"], remainingObjections: [], implementationSteps: ["Open PR", "Run tests", "Request approval", "Deploy", "Verify"], riskLevel: "low", costEstimate: "₹0 direct", reversibility: "high", feasibility: "high", expectedValue: "high", confidence: 0.75, dissent: pick !== options[0].id ? "Prefers rollback" : "" };
    }
    case "plan": {
      const text = String(ctx.objective ?? "").toLowerCase();
      const tasks = [] as { title: string; objective: string; ownerAgentCode: string; acceptanceCriteria: string[]; riskLevel: number; priority: number; dependsOn: number[] }[];
      if (/audit|website|site|checkout|qa/.test(text)) tasks.push({ title: "Run storefront audit", objective: "Run the synthetic and browser QA suites and triage failures.", ownerAgentCode: "C01", acceptanceCriteria: ["QA run stored with evidence"], riskLevel: 0, priority: 2, dependsOn: [] });
      if (/sales|revenue|drop/.test(text)) tasks.push({ title: "Diagnose sales change", objective: "Compare verified revenue, traffic and ad spend week over week.", ownerAgentCode: "G01", acceptanceCriteria: ["Verified vs estimated figures separated"], riskLevel: 0, priority: 2, dependsOn: [] });
      if (/meta|google|ads|campaign|marketing/.test(text)) tasks.push({ title: "Prepare marketing recommendations", objective: "Review paid media against verified outcomes and propose changes.", ownerAgentCode: "D01", acceptanceCriteria: ["Each recommendation has measurement plan"], riskLevel: 0, priority: 3, dependsOn: [] });
      if (!tasks.length) tasks.push({ title: "Scope the objective", objective: String(ctx.objective ?? ""), ownerAgentCode: "A02", acceptanceCriteria: ["Plan with owners and deadlines"], riskLevel: 0, priority: 3, dependsOn: [] });
      return { projectTitle: `${TAG} ${String(ctx.objective ?? "Objective").slice(0, 60)}`, summary: `${TAG} Keyword-based plan (no AI provider connected).`, tasks, approvalsLikely: [] };
    }
    case "answer":
      return { answer: `${TAG} Connect an AI provider to answer free-form questions from company records.`, sources: [], confidence: "low" };
    case "brief":
      return { headline: `${TAG} Executive summary generated without an AI provider.`, priorities: [], risks: [] };
    case "command_intent": {
      const text = String(ctx.text ?? "").trim();
      const kind = text.endsWith("?") ? "question" : text.split(/\s+/).length >= 4 ? "objective" : "unknown";
      return { kind, objective: kind === "objective" ? text : "", department: "", requiresApprovalBeforeProduction: true, answer: kind === "unknown" ? `${TAG} Connect an AI provider for natural-language commands.` : "" };
    }
    default:
      return { summary: `${TAG} ${purpose}` };
  }
}
