/**
 * Live office model: turns real records (tasks, approvals, debates, incidents, connectors, audit log)
 * into where each agent is and what it is doing. Nothing here is invented — an agent with no
 * work in the records is shown on a break, not "busy".
 */
import { db } from "./db/client";
import { parseJson } from "./db/json";
import { istDayStart, formatIst } from "./time";

export type Activity = "working" | "walking_to_desk" | "awaiting_approval" | "in_debate" | "review" | "blocked" | "paused" | "idle";

const WORKING = ["RESEARCHING", "PLANNED", "EXECUTING", "TESTING", "RELEASED"];

export function humanize(e: { actor: string; action: string; entityType: string; entityId: string; data: string }): string {
  const d = parseJson<Record<string, unknown>>(e.data, {});
  switch (e.action) {
    case "tool.execute": return `ran ${e.entityId}`;
    case "tool.denied": return `was blocked from ${e.entityId} (policy)`;
    case "tool.failed": return `hit an error running ${e.entityId}`;
    case "tool.manual_handoff": return `handed an approved action to a human`;
    case "task.create": return `opened a task: ${String(d.title ?? "").slice(0, 60)}`;
    case "task.transition": return `moved a task to ${String(d.to ?? "").toLowerCase().replace(/_/g, " ")}`;
    case "task.assign": return `assigned work to ${String(d.agent ?? "")}`;
    case "agent.output": return `submitted a deliverable${d.simulated ? " (simulated)" : ""}`;
    case "manager.review": return `reviewed a deliverable — ${String(d.verdict ?? "")}`;
    case "approval.request": return `asked for your approval (${String(d.tool ?? "")})`;
    case "project.plan": return `planned a project (${String(d.tasks ?? "")} tasks)`;
    case "project.create": return `opened a project`;
    case "website_audit.complete": return `finished a website audit (${String(d.fail ?? 0)} failures)`;
    case "alert.raise": return `raised an alert: ${String(d.title ?? "").slice(0, 60)}`;
    case "debate.start": return `convened a debate`;
    case "debate.finish": return `closed a debate — ${String(d.outcome ?? "").toLowerCase().replace(/_/g, " ")}`;
    case "knowledge.propose": return `proposed a knowledge entry`;
    default: return e.action.replace(/[._]/g, " ");
  }
}

export async function officeSnapshot() {
  const since = new Date(Date.now() - 45 * 60_000);
  const [agents, depts, tasks, approvals, debates, incidents, connectors, worker, feed, recent, doneToday] = await Promise.all([
    db.agent.findMany({ where: { status: { not: "RETIRED" } }, include: { department: true }, orderBy: { code: "asc" } }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    db.task.findMany({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, ownerAgentId: { not: null } }, select: { id: true, title: true, status: true, ownerAgentId: true, updatedAt: true, priority: true }, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }] }),
    db.approvalRequest.findMany({ where: { status: { in: ["PENDING", "DEFERRED"] } }, select: { id: true, shortCode: true, title: true, agentCode: true, riskLevel: true }, orderBy: { createdAt: "asc" } }),
    db.debate.findMany({ where: { status: "RUNNING" }, include: { rounds: { select: { round: true } } }, take: 1 }),
    db.incident.findMany({ where: { status: { not: "RESOLVED" } }, select: { id: true, title: true, severity: true, owners: true } }),
    db.connector.findMany({ select: { key: true, name: true, status: true } }),
    db.heartbeat.findUnique({ where: { component: "worker" } }),
    db.auditEvent.findMany({ where: { actor: { startsWith: "agent:" } }, orderBy: { seq: "desc" }, take: 14 }),
    db.auditEvent.findMany({ where: { actor: { startsWith: "agent:" }, createdAt: { gte: since } }, select: { actor: true, action: true, entityType: true, entityId: true, data: true, createdAt: true }, orderBy: { seq: "desc" }, take: 300 }),
    db.task.groupBy({ by: ["departmentId"], _count: true, where: { completedAt: { gte: istDayStart() } } }),
  ]);
  const debate = debates[0] ?? null;
  const incidentOwners = new Set(incidents.flatMap((i) => parseJson<string[]>(i.owners, [])));
  const lastByAgent = new Map<string, (typeof recent)[number]>();
  for (const r of recent) { const c = r.actor.slice(6); if (!lastByAgent.has(c)) lastByAgent.set(c, r); }

  const people = agents.map((a) => {
    const mine = tasks.filter((t) => t.ownerAgentId === a.id);
    const waiting = approvals.find((p) => p.agentCode === a.code);
    const working = mine.find((t) => WORKING.includes(t.status));
    const assigned = mine.find((t) => t.status === "ASSIGNED" || t.status === "TRIAGED" || t.status === "NEEDS_REWORK");
    const review = mine.find((t) => t.status === "MANAGER_REVIEW");
    const blocked = mine.find((t) => t.status === "BLOCKED" || t.status === "FAILED" || t.status === "PAUSED");
    const last = lastByAgent.get(a.code);
    let activity: Activity = "idle";
    let task = null as null | { id: string; title: string; status: string };
    if (a.status === "PAUSED") activity = "paused";
    else if (debate && (a.code === "A05" || a.code === "A01")) activity = "in_debate";
    else if (waiting) activity = "awaiting_approval";
    else if (working) { activity = "working"; task = working; }
    else if (review) { activity = "review"; task = review; }
    else if (assigned) { activity = "walking_to_desk"; task = assigned; }
    else if (blocked) { activity = "blocked"; task = blocked; }
    else if (last) activity = "working"; // active in the last 45 min with no open task (e.g. scheduled checks)
    if (incidentOwners.has(a.code) && activity === "idle") activity = "working";
    return {
      code: a.code, name: a.name, dept: a.department.code, isManager: a.isManager, status: a.status, activity,
      task: task ? { id: task.id, title: task.title, status: task.status } : null,
      openTasks: mine.length,
      approval: waiting ? { id: waiting.id, shortCode: waiting.shortCode, title: waiting.title } : null,
      bubble: last ? humanize(last) : null,
    };
  });

  const deptOf = new Map(agents.map((a) => [a.id, a.department.code]));
  const ageSec = worker ? (Date.now() - worker.beatAt.getTime()) / 1000 : Infinity;
  return {
    at: new Date().toISOString(),
    istHour: Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date())),
    workerOnline: ageSec < 180,
    people,
    departments: depts.map((d) => ({
      code: d.code, name: d.name,
      open: tasks.filter((t) => deptOf.get(t.ownerAgentId ?? "") === d.code).length,
      doneToday: doneToday.find((x) => x.departmentId === d.id)?._count ?? 0,
      busy: people.filter((p) => p.dept === d.code && ["working", "review", "walking_to_desk"].includes(p.activity)).length,
    })),
    approvals,
    debate: debate ? { id: debate.id, question: debate.question, round: Math.max(0, ...debate.rounds.map((r) => r.round)) } : null,
    incidents: incidents.map((i) => ({ id: i.id, title: i.title, severity: i.severity })),
    connectors: connectors.map((c) => ({ key: c.key, name: c.name, status: c.status })),
    feed: feed.map((e) => ({ seq: e.seq, who: e.actor.slice(6), text: humanize(e), at: formatIst(e.createdAt) })),
  };
}

export type OfficeSnapshot = Awaited<ReturnType<typeof officeSnapshot>>;

/** "What are you doing?" — a standup composed only from the agent's records. */
export async function agentStandup(code: string, founderName: string) {
  const a = await db.agent.findUniqueOrThrow({ where: { code }, include: { department: true, manager: true } });
  const today = istDayStart();
  const [open, doneToday, events, spend, latest, waiting] = await Promise.all([
    db.task.findMany({ where: { ownerAgentId: a.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }], take: 6 }),
    db.task.findMany({ where: { ownerAgentId: a.id, completedAt: { gte: today } }, take: 6 }),
    db.auditEvent.findMany({ where: { actor: `agent:${code}`, createdAt: { gte: today } }, orderBy: { seq: "desc" }, take: 8 }),
    db.modelUsage.aggregate({ _sum: { costInr: true }, where: { agentCode: code, createdAt: { gte: today } } }),
    db.task.findFirst({ where: { ownerAgentId: a.id, output: { not: null } }, orderBy: { updatedAt: "desc" }, select: { title: true, output: true, updatedAt: true } }),
    db.approvalRequest.findMany({ where: { agentCode: code, status: { in: ["PENDING", "DEFERRED"] } }, select: { id: true, shortCode: true, title: true } }),
  ]);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const now = open.find((t) => WORKING.includes(t.status)) ?? open[0];
  const blockers = open.filter((t) => ["BLOCKED", "FAILED", "NEEDS_REWORK", "PAUSED"].includes(t.status));
  const deliverable = latest ? parseJson<{ summary?: string; simulated?: boolean }>(latest.output, {}) : null;
  const lines: string[] = [];
  lines.push(`${greet}, ${founderName}. ${a.name} here, ${a.department.name}.`);
  if (a.status === "SHADOW") lines.push("I'm in shadow mode: I can investigate and propose, but nothing I propose executes until you promote me.");
  if (a.status === "PAUSED") lines.push("You've paused me, so I'm not taking any work.");
  lines.push(now ? `Right now: "${now.title}" — ${now.status.toLowerCase().replace(/_/g, " ")}.` : "I have no open tasks right now.");
  if (doneToday.length) lines.push(`Done today: ${doneToday.map((t) => `"${t.title}"`).join(", ")}.`);
  if (events.length) lines.push(`Today I ${[...new Set(events.map(humanize))].slice(0, 4).join("; ")}.`);
  if (waiting.length) lines.push(`Waiting on you: ${waiting.map((w) => `${w.shortCode} ${w.title}`).join("; ")}.`);
  if (blockers.length) lines.push(`Blocked / needs rework: ${blockers.map((b) => `"${b.title}"${b.statusReason ? ` (${b.statusReason.slice(0, 80)})` : ""}`).join("; ")}.`);
  if (deliverable?.summary) lines.push(`My latest deliverable${deliverable.simulated ? " (simulated)" : ""}: ${deliverable.summary.slice(0, 220)}`);
  if (!events.length && !open.length) lines.push("Nothing in my records today — I'm available.");
  return {
    code: a.code, name: a.name, department: a.department.name, manager: a.manager ? `${a.manager.code} ${a.manager.name}` : "Founder",
    status: a.status, spendTodayInr: spend._sum.costInr ?? 0, report: lines, openTasks: open.map((t) => ({ id: t.id, title: t.title, status: t.status })), approvals: waiting,
    note: "Composed from this agent's task, approval and audit records — no AI involved, nothing invented.",
  };
}
