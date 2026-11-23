import { db } from "./db/client";
import { sha256, canonicalJson } from "./crypto";

const GENESIS = "0".repeat(64);

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string;
  data?: unknown;
}

/**
 * Append-only, hash-chained audit log. Each event's hash covers the previous hash,
 * so editing or deleting any past row breaks verification (see verifyAuditChain).
 * Serialised through a transaction so concurrent writers cannot fork the chain.
 */
// In-process queue: one audit write at a time per process, so concurrent callers don't each hold a
// pooled connection while waiting on the cross-process advisory lock (matters over high-latency links).
let queue: Promise<unknown> = Promise.resolve();

export function audit(e: AuditInput): Promise<void> {
  const next = queue.then(() => writeAudit(e));
  queue = next.catch(() => undefined);
  return next;
}

async function writeAudit(e: AuditInput): Promise<void> {
  await db.$transaction(async (tx) => {
    // Serialise writers across all processes (dashboard + workers) so the chain never forks.
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(424242)");
    const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const data = canonicalJson(e.data ?? {});
    const hash = sha256([prevHash, e.actor, e.action, e.entityType, e.entityId ?? "", data, createdAt.toISOString()].join("|"));
    await tx.auditEvent.create({
      data: { actor: e.actor, action: e.action, entityType: e.entityType, entityId: e.entityId ?? "", data, prevHash, hash, createdAt },
    });
  }, { maxWait: 15_000, timeout: 20_000 });
}

export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
  const rows = await db.auditEvent.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  for (const r of rows) {
    const expected = sha256([prev, r.actor, r.action, r.entityType, r.entityId, r.data, r.createdAt.toISOString()].join("|"));
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
