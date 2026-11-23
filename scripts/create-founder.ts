import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createFounder } from "../src/core/auth";
import { setSetting, SETTING_KEYS } from "../src/core/settings";

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question("Founder email: ")).trim();
  const name = (await rl.question("Name: ")).trim() || "Founder";
  const phone = (await rl.question("WhatsApp/phone in E.164 (e.g. +9198xxxxxxx, optional): ")).trim();
  const password = await rl.question("Password (min 12 chars): ");
  rl.close();
  const user = await createFounder(email, name, password, phone || undefined);
  await setSetting(SETTING_KEYS.founderEmail, user.email, "system:cli");
  if (phone) { await setSetting(SETTING_KEYS.founderWhatsapp, phone, "system:cli"); await setSetting(SETTING_KEYS.founderPhone, phone, "system:cli"); }
  console.log(`Founder account ready: ${user.email}`);
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
