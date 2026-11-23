import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/core/db/client";
import { executeTool } from "@/core/tools/gateway";
import { decideApproval } from "@/core/approvals";
import { setSetting, SETTING_KEYS } from "@/core/settings";
import { saveConfig } from "@/core/connectors/registry";
import { assertWithinBudget, BudgetExceededError } from "@/core/ai/budget";
import { founder, setAgent, interceptFetch, json } from "./helpers";

let actor = "";
let restore: (() => void) | null = null;
const metaCalls: string[] = [];

beforeAll(async () => {
  actor = (await founder()).actor;
  restore = interceptFetch([{ prefix: "https://graph.facebook.com/", handler: (url, init) => { metaCalls.push(`${init?.method ?? "GET"} ${url.split("?")[0]} ${init?.body ?? ""}`); return json({ success: true, data: [] }); } }]);
  await saveConfig("meta_ads", { adAccountId: "act_1", accessToken: "tok" }, actor);
  await setAgent("D02", { status: "ACTIVE" });
});
afterEach(async () => {
  await setSetting(SETTING_KEYS.emergencyStop, "false", actor);
  await setSetting(SETTING_KEYS.productionWritesPaused, "false", actor);
});

describe("tool gateway — approval enforcement", () => {
  it("denies a tool outside the agent's allowlist (permission escalation attempt)", async () => {
    const r = await executeTool({ agentCode: "E06", toolKey: "meta.update_budget", params: { objectId: "1", amountInr: 500 } });
    expect(r.status).toBe("denied");
    expect(await db.auditEvent.count({ where: { action: "tool.denied", entityId: "meta.update_budget" } })).toBeGreaterThan(0);
  });

  it("level 3 action creates an approval request instead of executing", async () => {
    metaCalls.length = 0;
    const r = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_9", amountInr: 800 }, approval: { title: "Raise budget", reason: "ROAS strong" } });
    expect(r.status).toBe("approval_required");
    expect(metaCalls).toHaveLength(0);
    const again = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_9", amountInr: 800 } });
    expect(again.status === "approval_required" && r.status === "approval_required" && again.approvalId === r.approvalId).toBe(true); // deduplicated
  });

  it("no AI model may approve; founder approval executes exactly once with the approved params", async () => {
    metaCalls.length = 0;
    const r = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_1", amountInr: 1000 } });
    if (r.status !== "approval_required") throw new Error("expected approval");
    await expect(decideApproval(r.approvalId, "APPROVE", "agent:A01", "dashboard")).rejects.toThrow(/Only the founder/);
    await expect(decideApproval(r.approvalId, "APPROVE", actor, "whatsapp")).rejects.toThrow(/dashboard/);
    await decideApproval(r.approvalId, "APPROVE", actor, "dashboard");

    // Parameters changed after approval → refused.
    const tampered = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_1", amountInr: 5000 }, approvalId: r.approvalId });
    expect(tampered.status).toBe("denied");
    expect(metaCalls).toHaveLength(0);

    const ok = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_1", amountInr: 1000 }, approvalId: r.approvalId });
    expect(ok.status).toBe("ok");
    expect(metaCalls).toHaveLength(1);
    expect(metaCalls[0]).toContain("daily_budget=100000"); // ₹1000 → paise
    const replay = await executeTool({ agentCode: "D02", toolKey: "meta.update_budget", params: { objectId: "adset_1", amountInr: 1000 }, approvalId: r.approvalId });
    expect(replay.status).toBe("ok");
    expect(metaCalls).toHaveLength(1); // not executed twice
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalId } })).status).toBe("EXECUTED");
  });

  it("rejected and expired approvals never execute", async () => {
    const r = await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "c1", status: "PAUSED" } });
    if (r.status !== "approval_required") throw new Error();
    await decideApproval(r.approvalId, "REJECT", actor, "dashboard", { note: "not now" });
    expect((await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "c1", status: "PAUSED" }, approvalId: r.approvalId })).status).toBe("denied");

    const r2 = await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "c2", status: "PAUSED" } });
    if (r2.status !== "approval_required") throw new Error();
    await db.approvalRequest.update({ where: { id: r2.approvalId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(decideApproval(r2.approvalId, "APPROVE", actor, "dashboard")).rejects.toThrow(/expired/);
  });

  it("level 4 approval requires a named qualified reviewer", async () => {
    await setAgent("I05", { status: "ACTIVE" });
    const r = await executeTool({ agentCode: "I05", toolKey: "claims.review", params: { text: "Supports calm focus" } });
    if (r.status !== "approval_required") throw new Error();
    await expect(decideApproval(r.approvalId, "APPROVE", actor, "dashboard")).rejects.toThrow(/qualified reviewer/);
    await decideApproval(r.approvalId, "APPROVE", actor, "dashboard", { reviewer: "Dr. A. Sharma, regulatory consultant" });
  });

  it("shadow-mode agents cannot execute even approved actions", async () => {
    await setAgent("D03", { status: "SHADOW" });
    await saveConfig("google_ads", { customerId: "123-456-7890", developerToken: "d", clientId: "c", clientSecret: "s", refreshToken: "r" }, actor).catch(() => undefined);
    const r = await executeTool({ agentCode: "D03", toolKey: "gads.update_budget", params: { budgetResourceName: "customers/1/campaignBudgets/2", amountInr: 500 } });
    if (r.status !== "approval_required") throw new Error(JSON.stringify(r));
    const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalId } });
    expect(req.title).toContain("[Shadow proposal]");
    await decideApproval(r.approvalId, "APPROVE", actor, "dashboard");
    const exec = await executeTool({ agentCode: "D03", toolKey: "gads.update_budget", params: { budgetResourceName: "customers/1/campaignBudgets/2", amountInr: 500 }, approvalId: r.approvalId });
    expect(exec.status).toBe("denied");
    expect(exec.status === "denied" && exec.reason).toMatch(/shadow mode/);
  });

  it("emergency stop blocks everything except read-only; production pause blocks risk ≥ 2", async () => {
    await setSetting(SETTING_KEYS.emergencyStop, "true", actor);
    expect((await executeTool({ agentCode: "C01", toolKey: "report.write", params: { title: "x", markdown: "y" } })).status).toBe("denied");
    expect((await executeTool({ agentCode: "C01", toolKey: "knowledge.search", params: { query: "claims" } })).status).toBe("ok");
    await setSetting(SETTING_KEYS.emergencyStop, "false", actor);
    await setSetting(SETTING_KEYS.productionWritesPaused, "true", actor);
    expect((await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "z", status: "PAUSED" } })).status).toBe("denied");
    expect((await executeTool({ agentCode: "C01", toolKey: "report.write", params: { title: "x", markdown: "y" } })).status).toBe("ok");
  });

  it("an interrupted external action is flagged for verification, never blindly retried", async () => {
    await db.idempotencyRecord.create({ data: { key: "manual-test-key", scope: "meta.set_status", status: "STARTED" } });
    metaCalls.length = 0;
    const r = await executeTool({ agentCode: "D02", toolKey: "meta.read", params: {}, idempotencyKey: "manual-test-key" });
    expect(r.status).toBe("ok"); // read-only tools are not external side-effects
    // simulate a crash after an approved write started
    const req = await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "crash", status: "PAUSED" } });
    if (req.status !== "approval_required") throw new Error();
    await decideApproval(req.approvalId, "APPROVE", actor, "dashboard");
    await db.idempotencyRecord.create({ data: { key: `approval:${req.approvalId}`, scope: "meta.set_status", status: "STARTED" } });
    const res = await executeTool({ agentCode: "D02", toolKey: "meta.set_status", params: { objectId: "crash", status: "PAUSED" }, approvalId: req.approvalId });
    expect(res.status).toBe("needs_verification");
    expect(metaCalls.filter((c) => c.startsWith("POST"))).toHaveLength(0);
    expect(await db.alert.count({ where: { title: { contains: "Interrupted external action" } } })).toBe(1);
  });

  it("spending budget exhaustion stops model calls", async () => {
    await db.modelUsage.create({ data: { provider: "openai", model: "x", costInr: 1_000_000, tokensIn: 1, tokensOut: 1 } });
    await expect(assertWithinBudget({})).rejects.toBeInstanceOf(BudgetExceededError);
    await db.modelUsage.deleteMany({ where: { model: "x" } });
    await expect(assertWithinBudget({})).resolves.toBeUndefined();
  });

  it("manual-only tools hand the exact approved parameters to a human task", async () => {
    await setAgent("F07", { status: "ACTIVE" });
    const r = await executeTool({ agentCode: "F07", toolKey: "pricing.update", params: { sku: "mind-calm", channel: "web", newPriceInr: 899 } });
    if (r.status !== "approval_required") throw new Error();
    await decideApproval(r.approvalId, "APPROVE", actor, "dashboard");
    const res = await executeTool({ agentCode: "F07", toolKey: "pricing.update", params: { sku: "mind-calm", channel: "web", newPriceInr: 899 }, approvalId: r.approvalId });
    expect(res.status).toBe("manual");
    const t = await db.task.findUniqueOrThrow({ where: { id: res.status === "manual" ? res.taskId : "" } });
    expect(t.objective).toContain('"newPriceInr": 899');
  });

  afterAll(() => restore?.());
});
import { afterAll } from "vitest";
