/**
 * Browser journeys with Playwright (optional dependency). Read-only by design:
 * a journey may add an item to a cart in its own throwaway session, and open the
 * checkout to confirm it loads — it never enters contact, address or payment details.
 */
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import { j } from "../db/json";
import { env } from "../env";
import { getSetting, SETTING_KEYS } from "../settings";

export type Journey = "home_to_cart" | "mobile_home" | "checkout_open";
interface Step { name: string; status: "PASS" | "FAIL" | "WARN" | "SKIP"; detail: string }

export async function runBrowserJourney(journey: Journey, opts: { baseUrl?: string; taskId?: string; headless?: boolean } = {}) {
  const base = (opts.baseUrl || (await getSetting(SETTING_KEYS.storefrontUrl, "https://rootellect.com"))).replace(/\/$/, "");
  const runId = randomUUID();
  let pw: typeof import("playwright");
  try {
    pw = await import("playwright");
  } catch {
    await db.testResult.create({ data: { runId, suite: "browser", check: journey, target: base, status: "SKIP", detail: "Playwright not installed (npm i playwright && npx playwright install chromium)" } });
    return { runId, status: "SKIP" as const, steps: [], screenshots: [] as string[] };
  }
  const dir = path.resolve(env.artifactsDir, "browser", runId);
  mkdirSync(dir, { recursive: true });
  const session = await db.browserSession.create({ data: { mode: "playwright", target: base } });
  const steps: Step[] = [];
  const screenshots: string[] = [];
  const consoleErrors: string[] = [];
  const browser = await pw.chromium.launch({ headless: opts.headless ?? true });
  const mobile = journey === "mobile_home";
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 RootellectOS-QA" } : { viewport: { width: 1366, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  const shot = async (name: string) => {
    const file = path.join(dir, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
    screenshots.push(path.relative(path.resolve(env.artifactsDir), file));
  };
  try {
    const res = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    steps.push({ name: "Open homepage", status: res?.ok() ? "PASS" : "FAIL", detail: `HTTP ${res?.status()}` });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await shot("home");

    if (mobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      steps.push({ name: "No horizontal overflow at 390px", status: overflow > 2 ? "FAIL" : "PASS", detail: `scrollWidth - innerWidth = ${overflow}px` });
      const smallTargets = await page.evaluate(() => [...document.querySelectorAll("a,button")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).length);
      steps.push({ name: "Tap targets ≥ 24px", status: smallTargets > 10 ? "WARN" : "PASS", detail: `${smallTargets} small targets` });
    } else {
      const productLink = page.locator('a[href*="/product"], a[href*="/products/"], a[href*="/shop/"]').first();
      if (await productLink.count()) {
        await Promise.all([page.waitForLoadState("domcontentloaded"), productLink.click()]);
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        steps.push({ name: "Open a product page", status: "PASS", detail: page.url() });
        await shot("product");
        const add = page.getByRole("button", { name: /add to (cart|bag)|buy now/i }).first();
        if (await add.count()) {
          await add.click();
          await page.waitForTimeout(1500);
          const cartSignal = await page.locator('[class*="cart" i], [data-testid*="cart" i], [aria-label*="cart" i]').count();
          steps.push({ name: "Add to cart", status: cartSignal ? "PASS" : "WARN", detail: cartSignal ? "Cart UI responded" : "Clicked; no cart element detected" });
          await shot("after-add-to-cart");
          if (journey === "checkout_open") {
            const checkout = page.getByRole("button", { name: /checkout|place order|proceed/i }).or(page.getByRole("link", { name: /checkout/i })).first();
            if (await checkout.count()) {
              await checkout.click();
              await page.waitForTimeout(4000);
              const frames = page.frames().map((f) => f.url()).filter((u) => /razorpay/i.test(u));
              steps.push({ name: "Checkout opens (no payment entered)", status: frames.length || /checkout/i.test(page.url()) ? "PASS" : "WARN", detail: frames.length ? "Razorpay checkout frame loaded" : page.url() });
              await shot("checkout-opened");
            } else steps.push({ name: "Checkout button", status: "FAIL", detail: "No checkout control found" });
          }
        } else steps.push({ name: "Add-to-cart button", status: "FAIL", detail: "No add-to-cart/buy-now button found" });
      } else steps.push({ name: "Find a product link", status: "FAIL", detail: "No product link on homepage" });
    }
    steps.push({ name: "JavaScript errors", status: consoleErrors.length ? "WARN" : "PASS", detail: consoleErrors.length ? consoleErrors.slice(0, 5).join(" | ") : "None" });
  } catch (e) {
    steps.push({ name: "Journey error", status: "FAIL", detail: (e as Error).message.slice(0, 500) });
    await shot("error");
  } finally {
    const trace = path.join(dir, "trace.zip");
    await context.tracing.stop({ path: trace }).catch(() => undefined);
    await browser.close();
  }
  const overall = steps.some((s) => s.status === "FAIL") ? "FAIL" : steps.some((s) => s.status === "WARN") ? "WARN" : "PASS";
  await db.testResult.createMany({ data: steps.map((s) => ({ runId, suite: `browser:${journey}`, check: s.name, target: base, status: s.status, detail: s.detail.slice(0, 2000), evidence: j(screenshots) })) });
  // Evidence bytes go into the database so the dashboard (e.g. on Vercel) can show them even though
  // the browser ran on the worker host. Large traces stay on the worker disk only.
  const store = (rel: string, cap: number) => {
    try { const abs = path.resolve(env.artifactsDir, rel); const size = statSync(abs).size; return size <= cap ? { data: readFileSync(abs), sizeBytes: size } : { sizeBytes: size }; } catch { return {}; }
  };
  for (const s of screenshots) await db.artifact.create({ data: { kind: "screenshot", title: `${journey} · ${path.basename(s)}`, path: s, mime: "image/png", taskId: opts.taskId, ...store(s, 4 * 1024 * 1024) } });
  const traceRel = path.relative(path.resolve(env.artifactsDir), path.join(dir, "trace.zip"));
  await db.artifact.create({ data: { kind: "trace", title: `${journey} trace`, path: traceRel, mime: "application/zip", taskId: opts.taskId, ...store(traceRel, 10 * 1024 * 1024) } });
  await db.browserSession.update({ where: { id: session.id }, data: { status: overall, endedAt: new Date(), summary: steps.map((s) => `${s.status} ${s.name}`).join(" · ").slice(0, 1000) } });
  return { runId, status: overall, steps, screenshots };
}
