import { db } from "../src/core/db/client";
import { seedOrganization } from "../src/core/org/registry";
import { TOOL_POLICIES } from "../src/core/tools/policies";
import { seedDefaults } from "../src/core/seed-defaults";

async function main() {
  const org = await seedOrganization();
  for (const p of TOOL_POLICIES) {
    await db.toolPolicy.upsert({ where: { toolKey: p.key }, create: { toolKey: p.key, riskLevel: p.risk }, update: {} });
  }
  await seedDefaults();
  console.log(`Organization: ${org.total} agents (${org.created} new). Tool policies: ${TOOL_POLICIES.length}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
