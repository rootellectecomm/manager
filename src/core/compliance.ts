/**
 * FSSAI-oriented claims linter. A first-line automated screen only — material claims
 * still go to the Regulatory Claims Review Specialist and a qualified human (level 4).
 */
const RULES: { re: RegExp; issue: string; suggest: string }[] = [
  { re: /\b(cure[sd]?|curing)\b/i, issue: "Cure claim", suggest: "supports / helps maintain" },
  { re: /\b(treat(s|ed|ment|ing)?)\b/i, issue: "Treatment claim", suggest: "designed to support" },
  { re: /\breverse[sd]?\b|\breversal\b/i, issue: "Reversal claim", suggest: "supports balance" },
  { re: /\b(fix(es|ed)?)\b\s+(your\s+)?(hormone|pcos|pcod|thyroid|anxiety|insomnia|periods?)/i, issue: "'Fixes' a condition", suggest: "supports" },
  { re: /\bprevents?\b.*\b(disease|pcos|pcod|cancer|diabetes|depression)\b/i, issue: "Disease prevention claim", suggest: "part of a healthy lifestyle" },
  { re: /\bguarantee[sd]?\b|\b100\s?%\s*(results|effective|guaranteed)/i, issue: "Guaranteed outcome", suggest: "results may vary" },
  { re: /\bpermanent(ly)?\b/i, issue: "Permanent result claim", suggest: "helps maintain" },
  { re: /\bmiracle\b|\bmagic(al)? (pill|cure)\b/i, issue: "Miracle language", suggest: "remove" },
  { re: /\bno side[- ]effects?\b/i, issue: "Absolute safety claim", suggest: "remove or substantiate with review" },
  { re: /\breplace(s|ment)? (your )?(medicine|medication|doctor|treatment)\b/i, issue: "Medical replacement claim", suggest: "not a substitute for medical advice" },
  { re: /\bclinically proven\b/i, issue: "'Clinically proven' needs an approved substantiation reference", suggest: "clinically studied ingredient (with citation)" },
  { re: /\b(diagnos(e|is))\b/i, issue: "Diagnosis language", suggest: "remove" },
];

export interface ClaimIssue { match: string; issue: string; suggest: string }

export function lintClaims(text: string): ClaimIssue[] {
  const out: ClaimIssue[] = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) out.push({ match: m[0], issue: r.issue, suggest: r.suggest });
  }
  return out;
}

export const DISCLAIMER = "Not intended to diagnose, treat, cure, or prevent any disease. Results may vary from person to person.";
