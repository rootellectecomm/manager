import { db } from "../db/client";
import { j, parseJson } from "../db/json";
import { audit } from "../audit";
import { AGENTS, DEPARTMENTS, DEPARTMENT_MANAGERS, slugify } from "./catalog";

const VERSIONED_FIELDS = [
  "name", "description", "responsibilities", "kpis", "tools", "deliverables", "validationRules", "escalation",
  "instructions", "providerPrimary", "providerFallback", "modelTier", "status", "maxAutonomousRisk",
  "dailyTokenBudget", "monthlyBudgetInr", "managerId",
] as const;

type AgentPatch = Partial<{
  name: string; description: string; responsibilities: string[]; kpis: string[]; tools: string[];
  deliverables: string[]; validationRules: string[]; escalation: string[]; instructions: string;
  providerPrimary: string; providerFallback: string; modelTier: string; status: string;
  maxAutonomousRisk: number; dailyTokenBudget: number; monthlyBudgetInr: number; managerId: string | null;
}>;

/**
 * Updates an agent and records an immutable version snapshot.
 * Only humans (actor "founder:*" or "system:seed") may change tools, status or autonomy —
 * agents cannot raise their own permissions.
 */
export async function updateAgent(code: string, patch: AgentPatch, actor: string, changeNote: string) {
  const privileged = ["tools", "status", "maxAutonomousRisk", "monthlyBudgetInr", "dailyTokenBudget"] as const;
  if (!actor.startsWith("founder:") && !actor.startsWith("system:") && privileged.some((k) => k in patch)) {
    await audit({ actor, action: "agent.update.denied", entityType: "agent", entityId: code, data: { attempted: Object.keys(patch) } });
    throw new Error("Only the founder can change an agent's tools, status, autonomy or budget.");
  }
  if (patch.maxAutonomousRisk !== undefined && (patch.maxAutonomousRisk < 0 || patch.maxAutonomousRisk > 2)) {
    throw new Error("maxAutonomousRisk must be 0–2. Level 3+ always requires approval.");
  }
  const agent = await db.agent.findUniqueOrThrow({ where: { code } });
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(VERSIONED_FIELDS as readonly string[]).includes(k)) continue;
    data[k] = Array.isArray(v) ? j(v) : v;
  }
  const next = await db.agent.update({ where: { code }, data: { ...data, version: { increment: 1 } } });
  await db.agentVersion.create({ data: { agentId: agent.id, version: next.version, snapshot: j(next), changeNote, changedBy: actor } });
  await audit({ actor, action: "agent.update", entityType: "agent", entityId: code, data: { fields: Object.keys(data), version: next.version, note: changeNote } });
  return next;
}

export async function duplicateAgent(code: string, newName: string, actor: string) {
  const src = await db.agent.findUniqueOrThrow({ where: { code } });
  const count = await db.agent.count({ where: { departmentId: src.departmentId } });
  const dept = await db.department.findUniqueOrThrow({ where: { id: src.departmentId } });
  let n = count + 1;
  let newCode = `${dept.code}${String(n).padStart(2, "0")}`;
  while (await db.agent.findUnique({ where: { code: newCode } })) newCode = `${dept.code}${String(++n).padStart(2, "0")}`;
  const { id: _id, createdAt: _c, updatedAt: _u, code: _code, slug: _s, name: _n, version: _v, isManager: _m, ...rest } = src;
  const copy = await db.agent.create({ data: { ...rest, code: newCode, slug: `${slugify(newName)}-${newCode.toLowerCase()}`, name: newName, isManager: false, status: "SHADOW", version: 1 } });
  await db.agentVersion.create({ data: { agentId: copy.id, version: 1, snapshot: j(copy), changeNote: `duplicated from ${code}`, changedBy: actor } });
  await audit({ actor, action: "agent.duplicate", entityType: "agent", entityId: newCode, data: { from: code } });
  return copy;
}

export interface AgentView {
  code: string; name: string; department: string; status: string; isManager: boolean;
  responsibilities: string[]; kpis: string[]; tools: string[];
}

export function agentLists(a: { responsibilities: string; kpis: string; tools: string; deliverables: string; escalation: string; validationRules: string }) {
  return {
    responsibilities: parseJson<string[]>(a.responsibilities, []),
    kpis: parseJson<string[]>(a.kpis, []),
    tools: parseJson<string[]>(a.tools, []),
    deliverables: parseJson<string[]>(a.deliverables, []),
    escalation: parseJson<string[]>(a.escalation, []),
    validationRules: parseJson<string[]>(a.validationRules, []),
  };
}

/** Idempotent: creates departments and the 63 initial agents if missing; never overwrites founder edits. */
export async function seedOrganization() {
  for (const [i, d] of DEPARTMENTS.entries()) {
    await db.department.upsert({ where: { code: d.code }, create: { ...d, sortOrder: i }, update: {} });
  }
  const depts = Object.fromEntries((await db.department.findMany()).map((d) => [d.code, d.id]));
  let created = 0;
  for (const def of AGENTS) {
    const exists = await db.agent.findUnique({ where: { code: def.code } });
    if (exists) continue;
    const agent = await db.agent.create({
      data: {
        code: def.code, slug: slugify(def.name), name: def.name, departmentId: depts[def.dept],
        isManager: def.isManager ?? false, description: def.description,
        responsibilities: j(def.responsibilities), kpis: j(def.kpis), tools: j(def.tools),
        deliverables: j(def.deliverables), escalation: j(def.escalation),
        validationRules: j([
          "Every factual claim cites a source reference or is marked as an assumption",
          "Never invent metrics, reviews, testimonials or test results",
          "Health language uses 'supports / helps maintain' — never treat, cure, fix or reverse",
        ]),
        providerPrimary: def.provider, providerFallback: def.fallback, modelTier: def.tier,
        status: "SHADOW", maxAutonomousRisk: 1,
      },
    });
    await db.agentVersion.create({ data: { agentId: agent.id, version: 1, snapshot: j(agent), changeNote: "initial catalog", changedBy: "system:seed" } });
    created++;
  }
  // Reporting lines: employees → department manager; managers → Chief of Staff; Chief of Staff → founder.
  const byCode = Object.fromEntries((await db.agent.findMany()).map((a) => [a.code, a]));
  for (const def of AGENTS) {
    const me = byCode[def.code];
    if (!me || me.managerId) continue;
    const mgrCode = def.code === "A01" ? null : def.isManager ? "A01" : DEPARTMENT_MANAGERS[def.dept];
    if (mgrCode && byCode[mgrCode]) await db.agent.update({ where: { id: me.id }, data: { managerId: byCode[mgrCode].id } });
  }
  return { created, total: await db.agent.count() };
}
