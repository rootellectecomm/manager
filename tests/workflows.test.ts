import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/core/db/client";
import { defineWorkflow, startWorkflow, claimNext, executeRun } from "@/core/workflows/engine";
import "@/core/workflows";
import { tickSchedules } from "@/core/workflows/schedules";
import { requestApproval, decideApproval } from "@/core/approvals";
import { runDebate } from "@/core/ai/debate";
import { notifyFounder, deliverQueued, inQuietHours } from "@/core/comms/notify";
import { setSetting, SETTING_KEYS } from "@/core/settings";
import { saveConfig, checkConnector } from "@/core/connectors/registry";
import { processWhatsappInbound } from "@/core/comms/whatsapp-inbound";
import { founder, interceptFetch, json } from "./helpers";

let actor = "";
beforeAll(async () => { actor = (await founder()).actor; });

const sideEffects: string[] = [];
let crashOnce = true;
defineWorkflow("test-durable", async (ctx) => {
  const a = await ctx.step("one", async () => { sideEffects.push("one"); return 1; });
  const b = await ctx.step("two", async () => {
    if (crashOnce) { crashOnce = false; throw new Error("worker crashed mid-step"); }
    sideEffects.push("two"); return 2;
  });
  return a + b;
}, { maxAttempts: 3 });

defineWorkflow("test-approval", async (ctx) => {
  const id = await ctx.step("ask", async () => (await requestApproval({ title: "t", agentCode: "B01", toolKey: "github.merge_pr", params: { number: 1 }, reason: "r", workflowRunId: ctx.runId })).id);
  const d = await ctx.waitForApproval(id);
  return d;
});

async function drain(max = 10) {
  for (let i = 0; i < max; i++) {
    const run = await claimNext("w-test");
    if (!run) return;
    await executeRun(run.id, "w-test");
  }
}

describe("durable workflow engine", () => {
  it("resumes after a failure without re-running completed steps", async () => {
    const run = await startWorkflow("test-durable", {});
    const c = await claimNext("w-test");
    expect(c?.id).toBe(run.id);
    expect(await executeRun(run.id, "w-test")).toBe("RETRYING");
    await db.workflowRun.update({ where: { id: run.id }, data: { nextRunAt: new Date() } });
    await drain();
    const done = await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("COMPLETED");
    expect(JSON.parse(done.result!)).toBe(3);
    expect(sideEffects).toEqual(["one", "two"]); // "one" ran exactly once
  });

  it("a crashed worker's lease expires and another worker resumes the run", async () => {
    const run = await startWorkflow("connector-health", {});
    // Worker A claims it and "dies" (never executes); lease is in the past.
    await claimNext("dead-worker");
    await db.workflowRun.update({ where: { id: run.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const resumed = await claimNext("w-test");
    expect(resumed?.id).toBe(run.id);
    expect(resumed?.lockedBy).toBe("w-test");
    await executeRun(run.id, "w-test");
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
  });

  it("parks on approval, never treats silence as approval, wakes on decision", async () => {
    const run = await startWorkflow("test-approval", {});
    await drain();
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("WAITING");
    await drain(); // nothing to do while waiting
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("WAITING");
    const ap = await db.approvalRequest.findFirstOrThrow({ where: { workflowRunId: run.id } });
    await decideApproval(ap.id, "REJECT", actor, "dashboard");
    await drain();
    const done = await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(done.status).toBe("COMPLETED");
    expect(JSON.parse(done.result!)).toBe("REJECTED");
  });

  it("deduplicates starts and schedule fires", async () => {
    const a = await startWorkflow("connector-health", {}, { dedupeKey: "same" });
    const b = await startWorkflow("connector-health", {}, { dedupeKey: "same" });
    expect(a.id).toBe(b.id);
    await db.schedule.updateMany({ where: { name: "housekeeping" }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    const [x, y] = await Promise.all([tickSchedules(), tickSchedules()]);
    expect([...x, ...y].filter((n) => n === "housekeeping")).toHaveLength(1);
  });
});

describe("five-round debate", () => {
  it("full panel reaches consensus only when verification evidence supports it", async () => {
    const r = await runDebate(null, { question: "Fix or roll back?", context: "checkout button missing" });
    expect(r.outcome).toBe("CONSENSUS_UNVERIFIED"); // agreement without tool verification is not 'supported'
    const rounds = await db.debateRound.findMany({ where: { debateId: r.debateId } });
    expect(new Set(rounds.map((x) => x.round))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(rounds.map((x) => x.alias)).size).toBe(3);
    expect(await db.decision.count({ where: { debateId: r.debateId } })).toBe(1);
  });

  it("reports majority with dissent when one provider disagrees", async () => {
    const r = await runDebate(null, { question: "Split?", simulation: { splitVote: true } });
    expect(r.outcome).toBe("MAJORITY");
    expect(r.dissent).toMatch(/prefers/);
  });

  it("degrades to a reduced panel when a provider is unavailable", async () => {
    process.env.SIMULATED_UNAVAILABLE = "gemini";
    const r = await runDebate(null, { question: "Provider down?" });
    delete process.env.SIMULATED_UNAVAILABLE;
    expect(r.outcome).toBe("REDUCED_PANEL");
    const d = await db.debate.findUniqueOrThrow({ where: { id: r.debateId } });
    expect(JSON.parse(d.panel)).toEqual(expect.not.arrayContaining(["gemini"]));
  });
});

describe("notifications & connectors", () => {
  it("deduplicates notifications and retries undeliverable ones up to 5 times", async () => {
    await setSetting(SETTING_KEYS.quietHours, "", actor);
    await setSetting(SETTING_KEYS.founderEmail, "founder@rootellect.test", actor);
    const first = await notifyFounder({ severity: "SEV2", subject: "Test", body: "b", dedupeKey: "dup-test" });
    const second = await notifyFounder({ severity: "SEV2", subject: "Test", body: "b", dedupeKey: "dup-test" });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
    for (let i = 0; i < 6; i++) await deliverQueued();
    const email = await db.notification.findUniqueOrThrow({ where: { dedupeKey: "dup-test:email" } });
    expect(email.status).toBe("FAILED"); // SMTP not connected → failure is recorded, not hidden
    expect(email.attempts).toBe(5);
  });

  it("quiet hours are evaluated in IST", async () => {
    await setSetting(SETTING_KEYS.quietHours, "22:30-07:30", actor);
    expect(await inQuietHours(new Date("2026-11-20T18:00:00Z"))).toBe(true); // 23:30 IST
    expect(await inQuietHours(new Date("2026-11-20T06:00:00Z"))).toBe(false); // 11:30 IST
    await setSetting(SETTING_KEYS.quietHours, "", actor);
  });

  it("an expired token flips a connector to TOKEN_EXPIRED and opens a repair task + alert", async () => {
    let valid = true;
    const restore = interceptFetch([{ prefix: "https://api.vercel.com/", handler: () => (valid ? json({ name: "rootellect", id: "p" }) : json({ error: { message: "invalid token" } }, 401)) }]);
    try {
      expect((await saveConfig("vercel", { token: "t", projectId: "p" }, actor)).status).toBe("CONNECTED");
      valid = false;
      expect((await checkConnector("vercel")).status).toBe("TOKEN_EXPIRED");
      expect(await db.task.count({ where: { title: "Repair Vercel connector" } })).toBe(1);
      expect(await db.alert.count({ where: { source: "connector:vercel" } })).toBe(1);
    } finally { restore(); }
  });

  it("ignores duplicate webhook deliveries and messages from unknown numbers", async () => {
    await setSetting(SETTING_KEYS.founderWhatsapp, "+919800000000", actor);
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "919800000000", type: "text", text: { body: "show pending approvals" } }] } }] }] };
    const a = await processWhatsappInbound(payload, { reply: false });
    const b = await processWhatsappInbound(payload, { reply: false });
    expect(a[0].outcome).toBe("show_approvals");
    expect(b[0].outcome).toBe("duplicate-ignored");
    const stranger = await processWhatsappInbound({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.2", from: "911111111111", type: "text", text: { body: "approve AP-XXXXX" } }] } }] }] }, { reply: false });
    expect(stranger[0].outcome).toBe("ignored-unknown-sender");
  });
});

describe("founder objective → Chief of Staff → departments", () => {
  it("plans tasks for the right agents, runs them through manager review, and never completes without evidence", async () => {
    const { runCommand } = await import("@/core/command");
    const res = await runCommand("Find why website sales dropped this week and prepare fixes", actor);
    expect(res.kind).toBe("objective");
    for (let i = 0; i < 20; i++) { const r = await claimNext("w-obj"); if (!r) break; await executeRun(r.id, "w-obj"); }
    const project = await db.project.findFirstOrThrow({ where: { objective: { contains: "sales dropped" } }, include: { tasks: { include: { owner: true } } } });
    expect(project.tasks.some((t) => t.owner?.code === "G01")).toBe(true); // finance owns the sales diagnosis
    const t = project.tasks.find((x) => x.owner?.code === "G01")!;
    const fresh = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    // Simulated analysis has no execution evidence → the manager sends it back; it is never "completed".
    expect(fresh.status).toBe("NEEDS_REWORK");
    expect(fresh.completedAt).toBeNull();
    expect(await db.auditEvent.count({ where: { action: "manager.review", entityId: t.id } })).toBe(1);
  });
});

describe("remaining failure cases", () => {
  it("browser automation failure is recorded as evidence, not thrown", async () => {
    const { runBrowserJourney } = await import("@/core/qa/browser");
    const r = await runBrowserJourney("home_to_cart", { baseUrl: "http://127.0.0.1:9" }); // nothing listens here
    expect(r.status).toBe("FAIL");
    expect(r.steps.some((s) => s.status === "FAIL")).toBe(true);
    expect(await db.testResult.count({ where: { runId: r.runId, status: "FAIL" } })).toBeGreaterThan(0);
  }, 60_000);

  it("a workflow that hits the spending budget pauses safely and resumes when the budget allows", async () => {
    const { createTask } = await import("@/core/tasks/service");
    const { task } = await createTask({ title: "Budget test", objective: "x", source: "founder", ownerAgentCode: "A02", actor });
    const usage = await db.modelUsage.create({ data: { provider: "openai", model: "budget-test", costInr: 999_999, tokensIn: 1, tokensOut: 1 } });
    const run = await startWorkflow("agent-task", { taskId: task.id });
    await drain();
    const parked = await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(parked.status).toBe("WAITING");
    expect(parked.error).toMatch(/Budget exhausted/);
    expect(await db.alert.count({ where: { title: { contains: "AI budget exhausted" } } })).toBeGreaterThan(0);
    await db.modelUsage.delete({ where: { id: usage.id } });
    const { resumeBudgetPaused } = await import("@/core/workflows/engine");
    expect(await resumeBudgetPaused()).toBeGreaterThan(0);
    await drain();
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("COMPLETED");
  });
});
