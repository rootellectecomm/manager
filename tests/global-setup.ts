import { execSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import EmbeddedPostgres from "embedded-postgres";

/**
 * Tests run against a real, throwaway PostgreSQL (same engine as Neon) — no mocks for the database.
 * Set TEST_DATABASE_URL to use an existing Postgres instead (e.g. a Neon test branch).
 */
export const TEST_PORT = 54329;

export default async function setup() {
  const dir = path.resolve(__dirname, "../data/test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let pg: EmbeddedPostgres | null = null;
  let url = process.env.TEST_DATABASE_URL ?? "";
  if (!url) {
    pg = new EmbeddedPostgres({ databaseDir: path.join(os.tmpdir(), `ros-test-pg-${process.pid}`), user: "postgres", password: "postgres", port: TEST_PORT, persistent: false, onLog: () => undefined });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("ros_test");
    url = `postgresql://postgres:postgres@localhost:${TEST_PORT}/ros_test`;
  }
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), APPROVAL_LINK_SECRET: "test-secret", ALLOW_SIMULATED_PROVIDER: "true" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  return async () => { await pg?.stop(); };
}
