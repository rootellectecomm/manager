/**
 * Optional: a local Postgres for development with no install (embedded binaries, Windows/macOS/Linux).
 * Prints the DATABASE_URL to put in .env. Data lives in ./data/pg. Ctrl-C to stop.
 * Most people should instead use a Neon development branch: `neon checkout dev --create`.
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const pg = new EmbeddedPostgres({ databaseDir: path.resolve("data/pg"), user: "postgres", password: "postgres", port, persistent: true });
(async () => {
  try { await pg.initialise(); } catch { /* already initialised */ }
  await pg.start();
  try { await pg.createDatabase("rootellect_os"); } catch { /* exists */ }
  console.log(`Local Postgres running.\nDATABASE_URL="postgresql://postgres:postgres@localhost:${port}/rootellect_os"\nDATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:${port}/rootellect_os"`);
  process.on("SIGINT", async () => { await pg.stop(); process.exit(0); });
})();
