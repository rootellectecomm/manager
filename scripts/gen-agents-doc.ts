import { writeFileSync } from "node:fs";
import { AGENTS, DEPARTMENTS, DEPARTMENT_MANAGERS } from "../src/core/org/catalog";
import { POLICY_BY_KEY } from "../src/core/tools/policies";

const lines = ["# The 63 initial agent roles", "", "Generated from `src/core/org/catalog.ts` (`npx tsx scripts/gen-agents-doc.ts`). Edit roles in the dashboard. Every change is versioned.", ""];
for (const d of DEPARTMENTS) {
  lines.push(`## ${d.code} · ${d.name}`, "", d.description, "", `Manager: **${DEPARTMENT_MANAGERS[d.code]}**${d.code === "A" ? " (reports to the founder)" : " → reports to A01"}`, "");
  lines.push("| Code | Role | Model | Key KPIs | Level-3+ tools it may propose |", "|---|---|---|---|---|");
  for (const a of AGENTS.filter((x) => x.dept === d.code)) {
    const risky = a.tools.filter((t) => (POLICY_BY_KEY[t]?.risk ?? 0) >= 3);
    lines.push(`| ${a.code} | **${a.name}**${a.isManager ? " (manager)" : ""}<br>${a.description} | ${a.provider}/${a.tier} → ${a.fallback} | ${a.kpis.join("; ")} | ${risky.join(", ") || "—"} |`);
  }
  lines.push("");
}
writeFileSync("docs/agents.md", lines.join("\n"));
console.log(`docs/agents.md: ${AGENTS.length} agents`);
