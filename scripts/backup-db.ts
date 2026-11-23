/**
 * Logical backup of the control-plane database with pg_dump (uses the DIRECT/unpooled URL).
 * Neon also keeps point-in-time history — restore a branch from the console for most recoveries.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL)."); process.exit(1); }
const dir = path.resolve("backups");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `rootellect-os-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
try {
  execFileSync("pg_dump", ["--format=custom", "--no-owner", `--file=${file}`, url], { stdio: "inherit" });
  console.log(`Backup written: ${file}\nRestore: pg_restore --clean --no-owner -d "<DATABASE_URL_UNPOOLED>" "${file}"`);
} catch {
  console.error("pg_dump failed or is not installed. Install PostgreSQL client tools, or use Neon's point-in-time restore (Console → Branches → Restore).");
  process.exit(1);
}
