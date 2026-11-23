import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  // Migrations need a direct (unpooled) connection; the app uses the pooled DATABASE_URL.
  // `neon env pull` writes DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct).
  datasource: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || process.env.DATABASE_URL || "" },
});
