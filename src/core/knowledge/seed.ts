import { db } from "../db/client";

const SRC = "founder";
const PROV = "Founder brand brief (Rootellect positioning, products and compliance rules)";

const ENTRIES: { title: string; category: string; body: string }[] = [
  { title: "Rootellect positioning", category: "brand", body: "Rootellect is a premium, clean-label, vegan nutraceutical wellness brand from India (Adhiron Life Sciences Pvt. Ltd.). It is positioned as a systems-based wellness brand combining botanical wisdom with nutritional science: standardized herbal extracts, bioavailable nutrients, thoughtful dosing, non-hormonal support, in-house sourcing and manufacturing control, FSSAI-compliant communication. Personality: intelligent, trustworthy, emotionally aware, premium, calm, modern, science-backed, clean, human-centered." },
  { title: "Claims language policy (FSSAI)", category: "claims", body: "Never claim to treat, cure, fix, reverse or prevent any disease, never promise guaranteed outcomes or position products as a medical replacement. Use: supports, helps maintain, designed to support, may help support, part of a healthy lifestyle. Include where needed: 'Not intended to diagnose, treat, cure, or prevent any disease.' and 'Results may vary from person to person.' Material health or efficacy claims need qualified human review before public release." },
  { title: "Product: Women Balance", category: "product", body: "Daily hormonal support, PMS support, mood and emotional wellness, energy and nutritional balance for women 18–45. Key ingredients: KSM-66 Ashwagandha, Shatavari, Moringa, Punarnava, Iron Bisglycinate, Vitamin D3, L-Methylfolate, P-5-P. Tone: relatable, emotionally intelligent, modern woman wellness." },
  { title: "Product: PCOS/PCOD Support", category: "product", body: "Multi-pathway, non-hormonal support formula: supports hormonal balance, metabolic wellness, skin wellness, cycle support, stress and inflammation support. Key ingredients: Shatavari, Vitex, Spearmint, Berberis Aristata, Curcumin, Ashwagandha, Ashoka, Lodhra, Triphala. Never claim 'PCOS cure' or 'permanent reversal'; say 'supports hormonal balance', 'supports metabolic wellness', 'designed for modern PCOS support'." },
  { title: "Product: Perimenopause Support", category: "product", body: "Hormonal transition support, mood and sleep support, temperature regulation support, bone and metabolic wellness, calm and cognitive support for women 35+. Tone: sophisticated, reassuring, emotionally validating." },
  { title: "Product: Mind Calm", category: "product", body: "Stress support, calmness, focus, memory, sleep quality and mental clarity for men and women. Key ingredient highlight: B-Lit Bacopa (clinically studied Bacopa extract). Positioning: modern mental wellness, non-sedative calm support. Avoid sounding medicinal or psychiatric." },
  { title: "Sales channels", category: "company", body: "Rootellect sells via rootellect.com (custom Next.js/React storefront with Razorpay Magic Checkout, Shiprocket fulfilment, Prisma/Postgres) and Amazon India; Flipkart and Nykaa are additional marketplace targets. Amazon currently drives most sales; rootellect.com traffic is comparatively low." },
  { title: "Social content mix", category: "strategy", body: "Content mix: 40% educational, 30% product-focused, 20% lifestyle/relatable, 10% promotional. Format: strong hook → relatable problem → educational insight → product positioning → soft CTA (e.g., Comment BALANCE, Comment PCOS, Comment CALM, DM TRANSITION). Promotional content is aspirational and supportive, never pushy." },
  { title: "Operating defaults", category: "company", body: "Timezone Asia/Kolkata. Currency INR. Estimated and verified figures are always shown separately; missing cost inputs are flagged, never silently estimated." },
];

export async function seedKnowledge() {
  for (const e of ENTRIES) {
    const exists = await db.knowledgeEntry.findFirst({ where: { title: e.title } });
    if (!exists) await db.knowledgeEntry.create({ data: { ...e, verified: true, source: SRC, provenance: PROV } });
  }
}
