import { describe, it, expect } from "vitest";
import { db } from "@/core/db/client";
import { createTask, transitionTask, founderOverride, TransitionError } from "@/core/tasks/service";
import { updateAgent, duplicateAgent } from "@/core/org/registry";
import { audit, verifyAuditChain } from "@/core/audit";
import { encryptSecret, decryptSecret, signToken, verifyToken, hashPassword, verifyPassword, hashParams } from "@/core/crypto";
import { login, sessionUser } from "@/core/auth";
import { nextCron } from "@/core/workflows/cron";
import { lintClaims } from "@/core/compliance";
import { founder } from "./helpers";

describe("organization", () => {
  it("has exactly 63 agents in 9 departments, one manager each, correct reporting lines", async () => {
    expect(await db.agent.count()).toBe(63);
    const depts = await db.department.findMany({ include: { agents: true } });
    expect(depts).toHaveLength(9);
    for (const d of depts) {
      expect(d.agents).toHaveLength(7);
      expect(d.agents.filter((a) => a.isManager)).toHaveLength(1);
    }
    const cos = await db.agent.findUniqueOrThrow({ where: { code: "A01" } });
    expect(cos.managerId).toBeNull();
    const managers = await db.agent.findMany({ where: { isManager: true, code: { not: "A01" } } });
    expect(managers.every((m) => m.managerId === cos.id)).toBe(true);
    const qaTester = await db.agent.findUniqueOrThrow({ where: { code: "C03" }, include: { manager: true } });
    expect(qaTester.manager?.code).toBe("C01");
  });

  it("every agent carries the required profile fields and starts in shadow mode", async () => {
    for (const a of await db.agent.findMany()) {
      expect(a.description.length).toBeGreaterThan(10);
      expect(JSON.parse(a.responsibilities).length).toBeGreaterThan(0);
      expect(JSON.parse(a.kpis).length).toBeGreaterThan(0);
      expect(JSON.parse(a.tools).length).toBeGreaterThan(0);
      expect(JSON.parse(a.escalation).length).toBeGreaterThan(0);
      expect(["openai", "anthropic", "gemini"]).toContain(a.providerPrimary);
      const v1 = await db.agentVersion.findFirstOrThrow({ where: { agentId: a.id, version: 1 } });
      expect(JSON.parse(v1.snapshot).status).toBe("SHADOW"); // every agent starts in shadow mode
    }
  });

  it("agents cannot raise their own permissions; founder edits are versioned", async () => {
    await expect(updateAgent("D02", { tools: ["meta.update_budget", "pricing.update"] }, "agent:D02", "self-escalation")).rejects.toThrow(/Only the founder/);
    const { actor } = await founder();
    const updated = await updateAgent("D02", { instructions: "Prioritise Mind Calm campaigns." }, actor, "focus");
    expect(updated.version).toBe(2);
    const versions = await db.agentVersion.findMany({ where: { agent: { code: "D02" } } });
    expect(versions).toHaveLength(2);
    await expect(updateAgent("D02", { maxAutonomousRisk: 3 }, actor, "too high")).rejects.toThrow(/0–2/);
    const copy = await duplicateAgent("D02", "Meta Ads Specialist II", actor);
    expect(copy.status).toBe("SHADOW");
    expect(copy.code.startsWith("D")).toBe(true);
  });
});

describe("task lifecycle", () => {
  it("follows the state machine and refuses illegal jumps", async () => {
    const { task } = await createTask({ title: "Lifecycle", objective: "x", source: "founder", ownerAgentCode: "C01", actor: "founder:test" });
    expect(task.status).toBe("ASSIGNED");
    await expect(transitionTask(task.id, "COMPLETED", "system")).rejects.toThrow(TransitionError);
    await transitionTask(task.id, "EXECUTING", "agent:C01");
    await transitionTask(task.id, "MANAGER_REVIEW", "agent:C01");
    await expect(transitionTask(task.id, "VERIFIED", "agent:A01")).rejects.toThrow(/without execution evidence/);
    await transitionTask(task.id, "VERIFIED", "agent:A01", "ok", { evidence: [{ kind: "test-run", ref: "r1" }] });
    await transitionTask(task.id, "COMPLETED", "agent:A01");
    const events = await db.taskEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((e) => e.toState)).toEqual(["ASSIGNED", "EXECUTING", "MANAGER_REVIEW", "VERIFIED", "COMPLETED"]);
  });

  it("deduplicates tasks and enforces dependencies; founder can pause/resume/cancel", async () => {
    const a = await createTask({ title: "Dep A", objective: "x", source: "founder", ownerAgentCode: "B02", dedupeKey: "dep-a", actor: "founder:test" });
    const again = await createTask({ title: "Dep A dup", objective: "x", source: "founder", dedupeKey: "dep-a", actor: "founder:test" });
    expect(again.deduplicated).toBe(true);
    expect(again.task.id).toBe(a.task.id);
    const b = await createTask({ title: "Dep B", objective: "x", source: "founder", ownerAgentCode: "B03", dependsOn: [a.task.id], actor: "founder:test" });
    await expect(transitionTask(b.task.id, "EXECUTING", "agent:B03")).rejects.toThrow(/unfinished dependencies/);
    await founderOverride(b.task.id, "pause", "founder:test");
    await founderOverride(b.task.id, "resume", "founder:test");
    expect((await db.task.findUniqueOrThrow({ where: { id: b.task.id } })).status).toBe("ASSIGNED");
    await founderOverride(b.task.id, "cancel", "founder:test");
    expect((await db.task.findUniqueOrThrow({ where: { id: b.task.id } })).status).toBe("CANCELLED");
  });
});

describe("security primitives", () => {
  it("encrypts secrets, signs expiring tokens, hashes passwords", async () => {
    const blob = encryptSecret("sk-live-123");
    expect(blob).not.toContain("sk-live");
    expect(decryptSecret(blob)).toBe("sk-live-123");
    const tok = signToken({ approvalId: "a1" }, 60);
    expect(verifyToken<{ approvalId: string }>(tok)?.approvalId).toBe("a1");
    expect(verifyToken(tok.slice(0, -2) + "xx")).toBeNull();
    expect(verifyToken(signToken({ a: 1 }, -10))).toBeNull();
    const h = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(hashParams({ b: 1, a: { d: 2, c: 3 } })).toBe(hashParams({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("logs in, locks out after repeated failures", async () => {
    await founder();
    const ok = await login("founder@rootellect.test", "correct-horse-battery");
    expect("token" in ok).toBe(true);
    if ("token" in ok) expect((await sessionUser(ok.token))?.email).toBe("founder@rootellect.test");
    for (let i = 0; i < 5; i++) await login("founder@rootellect.test", "nope");
    const locked = await login("founder@rootellect.test", "correct-horse-battery");
    expect("error" in locked && locked.error).toMatch(/Too many attempts/);
  });

  it("audit chain stays intact under concurrent writers (advisory lock)", async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => audit({ actor: `test:${i}`, action: "concurrent", entityType: "t" })));
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("audit log is hash-chained and detects tampering", async () => {
    await audit({ actor: "test", action: "x", entityType: "t" });
    expect((await verifyAuditChain()).ok).toBe(true);
    const row = await db.auditEvent.findFirstOrThrow({ orderBy: { seq: "desc" } });
    await db.auditEvent.update({ where: { seq: row.seq }, data: { action: "tampered" } });
    const res = await verifyAuditChain();
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(row.seq);
    await db.auditEvent.update({ where: { seq: row.seq }, data: { action: "x" } });
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});

describe("utilities", () => {
  it("cron runs in IST", () => {
    // 09:15 IST = 03:45 UTC
    const next = nextCron("15 9 * * *", new Date("2026-11-20T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-20T03:45:00.000Z");
    const every15 = nextCron("*/15 * * * *", new Date("2026-11-20T03:46:10Z"));
    expect(every15.toISOString()).toBe("2026-11-20T04:00:00.000Z");
    const friday = nextCron("0 18 * * 5", new Date("2026-11-20T00:00:00Z")); // Fri 20 Nov 2026
    expect(friday.toISOString()).toBe("2026-11-20T12:30:00.000Z");
  });

  it("claims linter flags non-compliant health language", () => {
    expect(lintClaims("Cures PCOS permanently, guaranteed results").map((i) => i.issue)).toEqual(expect.arrayContaining(["Cure claim", "Permanent result claim", "Guaranteed outcome"]));
    expect(lintClaims("Designed to support hormonal balance as part of a healthy lifestyle")).toHaveLength(0);
  });
});

describe("two-factor sign-in", () => {
  it("requires a valid TOTP code once enabled", async () => {
    const { beginMfaSetup, confirmMfa, disableMfa } = await import("@/core/auth");
    const { totpAt } = await import("@/core/totp");
    const { createFounder } = await import("@/core/auth");
    const u = await createFounder("mfa@rootellect.test", "MFA", "another-long-password");
    const secret = await beginMfaSetup(u.id);
    await expect(confirmMfa(u.id, "000000")).rejects.toThrow(/didn't match/);
    await confirmMfa(u.id, totpAt(secret));
    const noCode = await login("mfa@rootellect.test", "another-long-password");
    expect("needsTotp" in noCode && noCode.needsTotp).toBe(true);
    const bad = await login("mfa@rootellect.test", "another-long-password", undefined, "123456");
    expect("error" in bad).toBe(true);
    const good = await login("mfa@rootellect.test", "another-long-password", undefined, totpAt(secret));
    expect("token" in good).toBe(true);
    await disableMfa(u.id, totpAt(secret));
  });

  it("matches the RFC 6238 SHA-1 test vector", async () => {
    const { totpAt, base32Encode } = await import("@/core/totp");
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 59_000)).toBe("287082"); // RFC 6238 Appendix B, 8-digit 94287082 → last 6
  });
});
