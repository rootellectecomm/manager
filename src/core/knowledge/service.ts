import { db } from "../db/client";
import { audit } from "../audit";

export interface KnowledgeHit { id: string; title: string; body: string; category: string; verified: boolean; source: string; provenance: string; updatedAt: Date; score: number }

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "with", "what", "how", "why", "our", "we", "i", "it", "this", "that"]);

function terms(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Hybrid-ready keyword search with provenance. Ranking: term hits in title (×3) and body,
 * verified facts boosted, expired/superseded entries excluded. A vector index can be
 * layered on later behind the same interface (see docs/ADR-001 §Knowledge).
 */
export async function searchKnowledge(query: string, opts: { limit?: number; category?: string; scope?: string } = {}): Promise<KnowledgeHit[]> {
  const ts = terms(query);
  const now = new Date();
  const rows = await db.knowledgeEntry.findMany({
    where: {
      supersededBy: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.scope ? { accessScope: { in: ["all", opts.scope] } } : { accessScope: "all" }),
    },
  });
  const scored = rows.map((r) => {
    const title = r.title.toLowerCase();
    const body = r.body.toLowerCase();
    let score = 0;
    for (const t of ts) {
      if (title.includes(t)) score += 3;
      const m = body.split(t).length - 1;
      score += Math.min(m, 5);
    }
    if (score > 0 && r.verified) score *= 1.5;
    return { id: r.id, title: r.title, body: r.body, category: r.category, verified: r.verified, source: r.source, provenance: r.provenance, updatedAt: r.updatedAt, score };
  });
  return scored.filter((s) => ts.length === 0 || s.score > 0).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
}

export async function proposeKnowledge(input: { title: string; body: string; category: string; source: string; provenance?: string }, actor: string) {
  const row = await db.knowledgeEntry.create({ data: { ...input, provenance: input.provenance ?? "", verified: false } });
  await audit({ actor, action: "knowledge.propose", entityType: "knowledge", entityId: row.id, data: { title: input.title } });
  return row;
}

export async function addVerifiedKnowledge(input: { title: string; body: string; category: string; source: string; provenance?: string; expiresAt?: Date }, actor: string) {
  if (!actor.startsWith("founder:") && !actor.startsWith("system:")) throw new Error("Only the founder can add verified knowledge.");
  const row = await db.knowledgeEntry.create({ data: { ...input, provenance: input.provenance ?? "", verified: true } });
  await audit({ actor, action: "knowledge.add_verified", entityType: "knowledge", entityId: row.id, data: { title: input.title } });
  return row;
}

export async function verifyKnowledge(id: string, actor: string) {
  if (!actor.startsWith("founder:")) throw new Error("Only the founder can verify knowledge.");
  await db.knowledgeEntry.update({ where: { id }, data: { verified: true } });
  await audit({ actor, action: "knowledge.verify", entityType: "knowledge", entityId: id });
}

/** Corrections never edit in place: a new version supersedes the old one. */
export async function correctKnowledge(id: string, body: string, actor: string) {
  const old = await db.knowledgeEntry.findUniqueOrThrow({ where: { id } });
  const next = await db.knowledgeEntry.create({
    data: { title: old.title, body, category: old.category, source: actor, provenance: `correction of ${id}`, accessScope: old.accessScope, version: old.version + 1, verified: actor.startsWith("founder:") },
  });
  await db.knowledgeEntry.update({ where: { id }, data: { supersededBy: next.id } });
  await audit({ actor, action: "knowledge.correct", entityType: "knowledge", entityId: next.id, data: { supersedes: id } });
  return next;
}

export function formatForPrompt(hits: KnowledgeHit[]): string {
  if (!hits.length) return "(no matching company knowledge)";
  return hits.map((h) => `[K:${h.id}] ${h.verified ? "VERIFIED" : "UNVERIFIED"} · ${h.category} · ${h.title}\n${h.body}`).join("\n\n");
}
