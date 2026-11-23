import { z } from "zod";

export const ProposedAction = z.object({
  tool: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  reason: z.string(),
  expectedImpact: z.string().default(""),
  rollbackPlan: z.string().default(""),
  estCostInr: z.number().default(0),
});
export type ProposedAction = z.infer<typeof ProposedAction>;

export const AgentOutput = z.object({
  summary: z.string(),
  findings: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    evidenceRefs: z.array(z.string()).default([]),
    verified: z.boolean().default(false), // true only when backed by tool output or verified knowledge
  })).default([]),
  recommendation: z.string().default(""),
  whatChanged: z.string().default(""),
  whyItMatters: z.string().default(""),
  dataReliability: z.enum(["high", "medium", "low", "unknown"]).default("unknown"),
  rootCauseHypothesis: z.string().default(""),
  expectedBenefit: z.string().default(""),
  risks: z.array(z.string()).default([]),
  measurement: z.string().default(""),
  missingInformation: z.array(z.string()).default([]),
  proposedActions: z.array(ProposedAction).default([]),
  toolRequests: z.array(z.object({ tool: z.string(), params: z.record(z.string(), z.unknown()).default({}), why: z.string().default("") })).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  needsDebate: z.boolean().default(false),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

export const ManagerReview = z.object({
  verdict: z.enum(["accept", "rework", "escalate"]),
  acceptanceCheck: z.array(z.object({ criterion: z.string(), met: z.boolean(), note: z.string().default("") })).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  complianceIssues: z.array(z.string()).default([]),
  note: z.string(),
});
export type ManagerReview = z.infer<typeof ManagerReview>;

// ── Debate ──
export const R1 = z.object({
  diagnosis: z.string(),
  evidence: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  rootCauseHypotheses: z.array(z.string()).default([]),
  recommendation: z.string(),
  optionTitle: z.string(), // short name of the recommended option
  risks: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export const R2 = z.object({
  evaluations: z.array(z.object({ option: z.string(), strengths: z.array(z.string()).default([]), weaknesses: z.array(z.string()).default([]), expectedCost: z.string().default(""), reversibility: z.enum(["high", "medium", "low"]).default("medium"), complexity: z.enum(["low", "medium", "high"]).default("medium") })).default([]),
  betterAlternative: z.string().default(""),
  revisedRecommendation: z.string(),
});
export const R3 = z.object({
  challengedOption: z.string(),
  failedAssumptions: z.array(z.string()).default([]),
  failureModes: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  whyStrongestMightFail: z.string(),
  verificationRequests: z.array(z.object({ tool: z.string(), params: z.record(z.string(), z.unknown()).default({}), assumption: z.string() })).default([]),
});
export const R4 = z.object({
  assumptionChecks: z.array(z.object({ assumption: z.string(), status: z.enum(["supported", "refuted", "untested"]), evidenceRef: z.string().default("") })).default([]),
  updatedRecommendation: z.string(),
  changedMind: z.boolean().default(false),
});
export const R5 = z.object({
  recommendedOption: z.string(), // must be one of the canonical option ids (O1, O2, …)
  reasons: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  remainingObjections: z.array(z.string()).default([]),
  implementationSteps: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]),
  costEstimate: z.string().default(""),
  reversibility: z.enum(["high", "medium", "low"]).default("medium"),
  feasibility: z.enum(["high", "medium", "low"]).default("medium"),
  expectedValue: z.enum(["high", "medium", "low"]).default("medium"),
  confidence: z.number().min(0).max(1),
  dissent: z.string().default(""),
});

export const CommandIntent = z.object({
  kind: z.enum(["question", "objective", "audit", "integrations_check", "pause_production", "resume_production", "emergency_stop", "show_approvals", "report", "unknown"]),
  objective: z.string().default(""),
  department: z.string().default(""),
  requiresApprovalBeforeProduction: z.boolean().default(true),
  answer: z.string().default(""),
});

export const Plan = z.object({
  projectTitle: z.string(),
  summary: z.string().default(""),
  tasks: z.array(z.object({
    title: z.string(),
    objective: z.string(),
    ownerAgentCode: z.string(),
    acceptanceCriteria: z.array(z.string()).default([]),
    riskLevel: z.number().int().min(0).max(4).default(0),
    priority: z.number().int().min(1).max(5).default(3),
    dependsOn: z.array(z.number().int()).default([]), // indexes into this list
  })).min(1).max(12),
  approvalsLikely: z.array(z.string()).default([]),
});
