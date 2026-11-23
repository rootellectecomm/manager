/**
 * Acceptance scenario (docs/acceptance.md): founder requests an audit → … → verified production fix.
 * Real: storefront HTTP checks, Playwright browser journey, workflow engine, gateway, approvals, audit log.
 * Mocked: GitHub REST API (fetch interception) and AI providers (SIMULATED, labelled as such).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/core/db/client";
import "@/core/workflows";
import { claimNext, executeRun } from "@/core/workflows/engine";
import { runCommand } from "@/core/command";
import { decideApproval } from "@/core/approvals";
import { saveConfig } from "@/core/connectors/registry";
import { setSetting, SETTING_KEYS } from "@/core/settings";
import { updateAgent } from "@/core/org/registry";
import { verifyAuditChain } from "@/core/audit";
import { startStorefront } from "./storefront-fixture";
import { founder, interceptFetch, json } from "../helpers";

let shop: Awaited<ReturnType<typeof startStorefront>>;
let restoreFetch: () => void;
let actor = "";
const gh: string[] = [];
let prCounter = 40;

async function drain(rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    const run = await claimNext("acceptance-worker");
    if (!run) return;
    await executeRun(run.id, "acceptance-worker");
  }
}

async function wakeTimers() {
  await db.workflowRun.updateMany({ where: { status: "PENDING", nextRunAt: { gt: new Date() } }, data: { nextRunAt: new Date() } });
}

beforeAll(async () => {
  shop = await startStorefront();
  actor = (await founder()).actor;
  restoreFetch = interceptFetch([{
    prefix: "https://api.github.com/",
    handler: (url, init) => {
      const method = init?.method ?? "GET";
      const p = new URL(url).pathname;
      gh.push(`${method} ${p}`);
      if (method === "GET" && p === "/repos/rootellect/rootellect") return json({ full_name: "rootellect/rootellect", default_branch: "main", permissions: { push: true } });
      if (p.endsWith("/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
      if (method === "POST" && p.endsWith("/git/refs")) return json({ ref: "ok" }, 201);
      if (method === "GET" && p.endsWith("/pulls")) return json([]);
      if (method === "POST" && p.endsWith("/pulls")) { prCounter++; return json({ number: prCounter, html_url: `https://github.com/rootellect/rootellect/pull/${prCounter}` }, 201); }
      if (p.endsWith("/status")) return json({ state: "success", total_count: 1 });
      if (p.endsWith("/check-runs")) return json({ total_count: 1, check_runs: [{ name: "build + tests", status: "completed", conclusion: "success" }] });
      if (method === "PUT" && p.endsWith("/merge")) { shop.state.broken = false; return json({ merged: true, sha: "merged-sha" }); } // merge → deploy fixes the page
      return json({ message: "not mocked" }, 404);
    },
  }]);
  await saveConfig("github", { token: "ghp_test", owner: "rootellect", repo: "rootellect", baseBranch: "main" }, actor);
  await setSetting(SETTING_KEYS.storefrontUrl, shop.base, actor);
  await setSetting(SETTING_KEYS.quietHours, "", actor);
  await setSetting("post_release_verify_minutes", "0", actor); // real default: 4 minutes for the deploy to roll out
  // Phase 8: promote the release managers out of shadow mode so approved merges may execute.
  await updateAgent("B01", { status: "ACTIVE" }, actor, "promoted for acceptance");
}, 60_000);

afterAll(async () => { restoreFetch?.(); await shop?.close(); });

describe("acceptance: founder-requested website audit", () => {
  it("runs end to end: audit → defect → debate → PR → CI → approval → merge → production verification → report", async () => {
    // 1. Founder requests the audit from the dashboard command bar.
    const cmd = await runCommand("Start a Rootellect website audit", actor);
    expect(cmd.kind).toBe("audit");
    await drain();

    const run = await db.workflowRun.findUniqueOrThrow({ where: { id: cmd.runId! } });
    expect(run.status).toBe("WAITING"); // parked on the founder's approval

    // 2–5. Project, QA task, evidence and defect task exist.
    const project = await db.project.findFirstOrThrow({ where: { title: { startsWith: "Website audit" } }, orderBy: { createdAt: "desc" }, include: { tasks: { include: { owner: true } } } });
    const qaTask = project.tasks.find((t) => t.owner?.code === "C01")!;
    expect(qaTask.status).toBe("COMPLETED");
    const defect = project.tasks.find((t) => t.title === "Defect: Product page availability")!;
    expect(defect.owner?.code).toBe("B02");
    expect(defect.status).toBe("AWAITING_APPROVAL");
    const qaFail = await db.testResult.findFirstOrThrow({ where: { check: "Product page availability", status: "FAIL" } });
    expect(qaFail.target).toContain("/products/women-balance");

    // 3–4. Browser journey actually ran with screenshots + trace stored.
    const shots = await db.artifact.findMany({ where: { kind: "screenshot" } });
    expect(shots.length).toBeGreaterThan(0);
    expect(existsSync(path.resolve(process.env.ARTIFACTS_DIR!, shots[0].path!))).toBe(true);
    expect(shots[0].data?.length).toBeGreaterThan(1000); // bytes stored in Postgres → viewable from the Vercel dashboard
    const journey = await db.testResult.findMany({ where: { suite: "browser:home_to_cart" } });
    expect(journey.find((r) => r.check === "Add to cart")?.status).toBe("PASS");

    // 8. Five-round debate ran for this important issue.
    const debate = await db.debate.findFirstOrThrow({ where: { taskId: defect.id }, include: { rounds: true } });
    expect(new Set(debate.rounds.map((r) => r.round)).size).toBe(5);

    // 9–10. PR created (never merged yet) and CI checked.
    expect(gh.some((c) => c.startsWith("POST") && c.endsWith("/pulls"))).toBe(true);
    expect(gh.some((c) => c.startsWith("PUT") && c.endsWith("/merge"))).toBe(false);

    // 11. Approval request reached the founder (dashboard + email queued) with evidence and rollback plan.
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { taskId: defect.id, toolKey: "github.merge_pr" } });
    expect(approval.status).toBe("PENDING");
    expect(approval.rollbackPlan).toMatch(/Revert/);
    expect(JSON.parse(approval.evidence).map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["qa-run", "pull-request", "debate"]));
    expect(await db.notification.count({ where: { approvalId: approval.id } })).toBeGreaterThanOrEqual(1);

    // 12–13. Founder approves through the authenticated control → merge happens only now.
    await decideApproval(approval.id, "APPROVE", actor, "dashboard", { note: "ship it" });
    await drain();
    expect(gh.filter((c) => c.startsWith("PUT") && c.endsWith("/merge"))).toHaveLength(1);

    // 14. After the rollout delay (0 min in this test), production is re-verified.
    await wakeTimers();
    await drain();
    const history = (await db.taskEvent.findMany({ where: { taskId: defect.id }, orderBy: { createdAt: "asc" } })).map((e) => e.toState);
    expect(history.slice(-4)).toEqual(["AWAITING_APPROVAL", "RELEASED", "VERIFIED", "COMPLETED"]);
    const finalDefect = await db.task.findUniqueOrThrow({ where: { id: defect.id } });
    expect(finalDefect.status).toBe("COMPLETED");
    expect(JSON.parse(finalDefect.evidence).some((e: { note?: string }) => e.note === "post-release verification")).toBe(true);

    // 15–16. Report generated and founder notified.
    const done = await db.workflowRun.findUniqueOrThrow({ where: { id: cmd.runId! } });
    expect(done.status).toBe("COMPLETED");
    const result = JSON.parse(done.result!);
    expect(result.fix.status).toBe("resolved");
    const report = await db.artifact.findUniqueOrThrow({ where: { id: result.reportId } });
    expect(report.content).toContain("Product page availability");
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `audit-report:${cmd.runId}` } } })).toBeGreaterThanOrEqual(1);

    // 17. Everything is searchable and the audit chain is intact.
    expect(await db.auditEvent.count({ where: { action: "approval.approved", entityId: approval.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "tool.execute", entityId: "github.merge_pr" } })).toBe(1);
    expect((await verifyAuditChain()).ok).toBe(true);
  }, 180_000);

  it("founder rejection: nothing is merged and the defect goes back for rework", async () => {
    shop.state.broken = true;
    gh.length = 0;
    await db.task.updateMany({ where: { dedupeKey: { startsWith: "defect:" } }, data: { dedupeKey: null } }); // new day in real life
    const cmd = await runCommand("run a website audit", actor);
    await drain();
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { workflowRunId: cmd.runId!, toolKey: "github.merge_pr" } });
    await decideApproval(approval.id, "REJECT", actor, "dashboard", { note: "Prefer a rollback" });
    await drain();
    expect(gh.some((c) => c.startsWith("PUT") && c.endsWith("/merge"))).toBe(false);
    const t = await db.task.findUniqueOrThrow({ where: { id: approval.taskId! } });
    expect(t.status).toBe("NEEDS_REWORK");
    const run = await db.workflowRun.findUniqueOrThrow({ where: { id: cmd.runId! } });
    expect(JSON.parse(run.result!).fix.status).toBe("not-approved");
  }, 180_000);
});
