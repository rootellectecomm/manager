import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "../env";

/**
 * One node-postgres pool per process, wrapped by Prisma's pg adapter.
 * - Vercel (Fluid compute): DATABASE_URL is Neon's *pooled* string; attachDatabasePool lets idle
 *   clients close before the function instance is suspended (Neon's recommended setup).
 * - Worker (Railway / long-running): the same pool is reused across all workflow runs.
 * Migrations use DATABASE_URL_UNPOOLED via prisma.config.ts, never this pool.
 */
function create(): PrismaClient {
  const url = env.databaseUrl;
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL must be a Postgres connection string (Neon: the pooled URL). See docs/deploy.md.");
  }
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 5 : 10)), idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
  pool.on("error", (e) => console.error("[db] idle client error", e.message)); // e.g. Neon compute scaled to zero
  if (process.env.VERCEL) attachDatabasePool(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const g = globalThis as unknown as { __rosPrisma?: PrismaClient };
export const db: PrismaClient = g.__rosPrisma ?? (g.__rosPrisma = create());
