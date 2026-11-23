/** Creates .env with freshly generated secrets if it doesn't exist. Never overwrites. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) {
  console.log(".env already exists — leaving it unchanged.");
  process.exit(0);
}
const template = readFileSync(".env.example", "utf8")
  .replace('MASTER_KEY=""', `MASTER_KEY="${randomBytes(32).toString("base64")}"`)
  .replace('APPROVAL_LINK_SECRET=""', `APPROVAL_LINK_SECRET="${randomBytes(32).toString("base64url")}"`)
  .replace('CRON_SECRET=""', `CRON_SECRET="${randomBytes(24).toString("base64url")}"`);
writeFileSync(".env", template);
console.log("Created .env with new MASTER_KEY and APPROVAL_LINK_SECRET. Back up MASTER_KEY somewhere safe (password manager).");
