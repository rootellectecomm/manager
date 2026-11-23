import { config } from "dotenv";

// .env.local first (where `neon env pull` writes), then .env. Real env vars always win.
config({ path: [".env.local", ".env"], quiet: true });

function read(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

export const env = {
  get databaseUrl() { return read("DATABASE_URL"); },
  get cronSecret() { return read("CRON_SECRET"); },
  get masterKey() { return read("MASTER_KEY"); },
  get approvalLinkSecret() { return read("APPROVAL_LINK_SECRET"); },
  get appUrl() { return read("APP_URL", "http://localhost:3100"); },
  get artifactsDir() { return read("ARTIFACTS_DIR", "./artifacts"); },
  get workerId() { return read("WORKER_ID", `worker-${process.pid}`); },
  get allowSimulatedProvider() { return read("ALLOW_SIMULATED_PROVIDER", "false") === "true"; },
  get watchdogStaleSeconds() { return Number(read("WATCHDOG_STALE_SECONDS", "180")); },
};

/** Fails loudly when a secret the operation needs is missing — never falls back to a weak default. */
export function requireSecret(name: "MASTER_KEY" | "APPROVAL_LINK_SECRET"): string {
  const v = name === "MASTER_KEY" ? env.masterKey : env.approvalLinkSecret;
  if (!v) throw new Error(`${name} is not set. See .env.example.`);
  return v;
}
