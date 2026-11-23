/**
 * Production-safe synthetic checks: GET/HEAD requests only. No carts, no orders, no payments.
 * Safe to run every 15 minutes against the live storefront.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import { j } from "../db/json";
import { getSetting, SETTING_KEYS } from "../settings";

export interface CheckResult { suite: string; check: string; target: string; status: "PASS" | "FAIL" | "WARN" | "SKIP"; detail: string; durationMs: number }

const UA = "RootellectOS-Synthetic/1.0 (+monitoring)";

async function get(url: string, method: "GET" | "HEAD" = "GET") {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    const body = method === "GET" ? await res.text() : "";
    return { ok: res.ok, status: res.status, body, headers: res.headers, ms: Date.now() - t0, finalUrl: res.url };
  } catch (e) {
    return { ok: false, status: 0, body: "", headers: new Headers(), ms: Date.now() - t0, finalUrl: url, error: (e as Error).message };
  }
}

const meta = (html: string, name: string) =>
  html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1];

function jsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const v = JSON.parse(m[1]); out.push(...(Array.isArray(v) ? v : v["@graph"] ?? [v])); } catch { /* invalid JSON-LD reported by caller */ }
  }
  return out;
}

function sameOriginLinks(html: string, base: string, limit: number): string[] {
  const origin = new URL(base).origin;
  const set = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin && !/\.(pdf|jpg|jpeg|png|webp|svg)$/i.test(u.pathname)) set.add(u.origin + u.pathname);
    } catch { /* ignore */ }
    if (set.size >= limit) break;
  }
  return [...set];
}

export async function checkSinglePage(url: string): Promise<CheckResult[]> {
  const r = await get(url);
  return [{ suite: "single", check: "Page responds", target: url, status: r.ok ? (r.ms > 4000 ? "WARN" : "PASS") : "FAIL", detail: r.ok ? `HTTP ${r.status} in ${r.ms} ms` : `HTTP ${r.status} ${r.error ?? ""}`, durationMs: r.ms }];
}

export async function runStorefrontSuite(opts: { baseUrl?: string; actor?: string; taskId?: string } = {}) {
  const base = (opts.baseUrl || (await getSetting(SETTING_KEYS.storefrontUrl, "https://rootellect.com"))).replace(/\/$/, "");
  const runId = randomUUID();
  const results: CheckResult[] = [];
  const add = (check: string, target: string, status: CheckResult["status"], detail: string, durationMs = 0) => results.push({ suite: "storefront", check, target, status, detail, durationMs });

  // 1. Homepage
  const home = await get(base + "/");
  add("Homepage availability", base + "/", home.ok ? (home.ms > 4000 ? "WARN" : "PASS") : "FAIL", home.ok ? `HTTP ${home.status} in ${home.ms} ms` : `HTTP ${home.status} ${home.error ?? ""}`, home.ms);

  if (home.ok) {
    // 2. SEO metadata
    const title = home.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    add("Homepage <title>", base, title ? (title.length > 65 ? "WARN" : "PASS") : "FAIL", title ? `"${title}" (${title.length} chars)` : "Missing <title>");
    const desc = meta(home.body, "description");
    add("Meta description", base, desc ? (desc.length < 70 || desc.length > 170 ? "WARN" : "PASS") : "FAIL", desc ? `${desc.length} chars` : "Missing meta description");
    const canonical = home.body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
    add("Canonical link", base, canonical ? "PASS" : "WARN", canonical ?? "No canonical link");
    add("Open Graph image", base, meta(home.body, "og:image") ? "PASS" : "WARN", meta(home.body, "og:image") ?? "No og:image");
    add("Mobile viewport meta", base, meta(home.body, "viewport") ? "PASS" : "FAIL", meta(home.body, "viewport") ?? "Missing viewport meta");

    // 3. Security headers
    const h = home.headers;
    add("HSTS header", base, h.get("strict-transport-security") ? "PASS" : "WARN", h.get("strict-transport-security") ?? "Missing Strict-Transport-Security");
    add("X-Content-Type-Options", base, h.get("x-content-type-options") === "nosniff" ? "PASS" : "WARN", h.get("x-content-type-options") ?? "Missing");
    add("Clickjacking protection", base, h.get("x-frame-options") || /frame-ancestors/i.test(h.get("content-security-policy") ?? "") ? "PASS" : "WARN", h.get("x-frame-options") ?? "No X-Frame-Options / frame-ancestors");

    // 4. Images on homepage
    const imgs = [...home.body.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, "&"), base).toString(); } catch { return null; } }).filter((x): x is string => Boolean(x) && !x!.startsWith("data:")).slice(0, 12);
    const brokenImgs: string[] = [];
    await Promise.all(imgs.map(async (u) => { const r = await get(u, "GET"); if (!r.ok) brokenImgs.push(`${r.status} ${u}`); }));
    add("Homepage images load", base, imgs.length === 0 ? "WARN" : brokenImgs.length ? "FAIL" : "PASS", imgs.length === 0 ? "No <img> tags found in server HTML" : brokenImgs.length ? `Broken: ${brokenImgs.join(", ")}` : `${imgs.length} images OK`);

    // 5. Internal links
    const links = sameOriginLinks(home.body, base, 30);
    const broken: string[] = [];
    await Promise.all(links.map(async (u) => { const r = await get(u, "GET"); if (!r.ok) broken.push(`${r.status} ${u}`); }));
    add("Internal links (homepage)", base, broken.length ? "FAIL" : "PASS", broken.length ? `Broken: ${broken.join(", ")}` : `${links.length} links OK`);
  }

  // 6. robots.txt
  const robots = await get(base + "/robots.txt");
  if (!robots.ok) add("robots.txt", base + "/robots.txt", "WARN", `HTTP ${robots.status}`);
  else {
    const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(robots.body) && /user-agent:\s*\*/i.test(robots.body);
    add("robots.txt", base + "/robots.txt", blocksAll ? "FAIL" : "PASS", blocksAll ? "Disallows the whole site for all crawlers" : /sitemap:/i.test(robots.body) ? "OK, references sitemap" : "OK (no Sitemap: line)");
  }

  // 7. Sitemap + product pages
  const sitemap = await get(base + "/sitemap.xml");
  const locs = sitemap.ok ? [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()) : [];
  add("sitemap.xml", base + "/sitemap.xml", sitemap.ok && locs.length ? "PASS" : "FAIL", sitemap.ok ? `${locs.length} URLs` : `HTTP ${sitemap.status}`);
  const configured = (await getSetting("product_paths", "")).split(",").map((s) => s.trim()).filter(Boolean).map((p) => (p.startsWith("http") ? p : base + p));
  const productUrls = (configured.length ? configured : locs.filter((u) => /\/(products?|shop)\//i.test(u))).slice(0, 8);
  if (!productUrls.length) add("Product pages discovered", base, "WARN", "No product URLs in sitemap. Set product paths in Settings.");
  for (const u of productUrls) {
    const p = await get(u);
    if (!p.ok) { add("Product page availability", u, "FAIL", `HTTP ${p.status} ${p.error ?? ""}`, p.ms); continue; }
    add("Product page availability", u, p.ms > 4000 ? "WARN" : "PASS", `HTTP ${p.status} in ${p.ms} ms`, p.ms);
    const ld = jsonLd(p.body) as { "@type"?: string | string[]; offers?: { price?: unknown; priceCurrency?: string } | { price?: unknown }[]; image?: unknown; name?: string }[];
    const product = ld.find((x) => (Array.isArray(x["@type"]) ? x["@type"] : [x["@type"]]).includes("Product"));
    const offer = product ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) : undefined;
    add("Product structured data", u, product ? (offer?.price !== undefined && product.image ? "PASS" : "WARN") : "FAIL", product ? `Product "${product.name ?? ""}" · price ${offer?.price ?? "missing"} · image ${product.image ? "yes" : "missing"}` : "No Product JSON-LD");
    const hasCart = /add\s*to\s*(cart|bag)|buy\s*now/i.test(p.body);
    add("Add-to-cart control present", u, hasCart ? "PASS" : "WARN", hasCart ? "Found in server HTML" : "Not in server HTML (may be client-rendered — browser journey verifies)");
    const hasPrice = /₹\s?\d|INR\s?\d|&#8377;|"price"/i.test(p.body);
    add("Price visible", u, hasPrice ? "PASS" : "FAIL", hasPrice ? "Price found" : "No price in HTML");
    add("Product image tag", u, meta(p.body, "og:image") ? "PASS" : "WARN", meta(p.body, "og:image") ?? "No og:image on product page");
  }

  await db.testResult.createMany({ data: results.map((r) => ({ runId, suite: r.suite, check: r.check, target: r.target, status: r.status, detail: r.detail.slice(0, 2000), durationMs: r.durationMs, evidence: j([]) })) });
  await db.browserSession.create({ data: { mode: "synthetic", target: base, status: "DONE", endedAt: new Date(), summary: `${results.filter((r) => r.status === "FAIL").length} fail · ${results.filter((r) => r.status === "WARN").length} warn · ${results.filter((r) => r.status === "PASS").length} pass` } });
  return {
    runId, base,
    pass: results.filter((r) => r.status === "PASS").length,
    warn: results.filter((r) => r.status === "WARN").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    failures: results.filter((r) => r.status === "FAIL").map((r) => ({ check: r.check, target: r.target, detail: r.detail })),
    results,
  };
}
