import http from "node:http";
import type { AddressInfo } from "node:net";

/** A tiny stand-in for rootellect.com with one switchable defect (a product page returning 500). */
export async function startStorefront() {
  const state = { broken: true };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const page = (title: string, body: string, ld = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Premium clean-label vegan nutraceuticals designed to support hormonal balance, calm focus and everyday wellness.">
<link rel="canonical" href="/"><meta property="og:image" content="/img/hero.png">${ld}</head><body>${body}
<div class="cart-count" aria-label="cart">0</div><script>document.querySelectorAll('button.add').forEach(b=>b.addEventListener('click',()=>{document.querySelector('.cart-count').textContent='1'}))</script></body></html>`;
  const product = (slug: string, name: string, price: number) => page(`${name} | Rootellect`, `<h1>${name}</h1><p>₹${price}</p><img src="/img/${slug}.png" alt="${name}"><button class="add">Add to cart</button><a href="/cart">Cart</a>`,
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name, image: `/img/${slug}.png`, offers: { "@type": "Offer", price, priceCurrency: "INR" } })}</script>`);
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: string | Buffer, type = "text/html") => { res.writeHead(status, { "Content-Type": type, "Strict-Transport-Security": "max-age=63072000", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" }); res.end(body); };
    if (url === "/") return send(200, page("Rootellect — Clean, vegan, science-backed wellness", `<a href="/products/mind-calm">Mind Calm</a> <a href="/products/women-balance">Women Balance</a> <img src="/img/hero.png" alt="hero">`));
    if (url === "/robots.txt") return send(200, "User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n", "text/plain");
    if (url === "/sitemap.xml") { const o = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; return send(200, `<?xml version="1.0"?><urlset><url><loc>${o}/</loc></url><url><loc>${o}/products/mind-calm</loc></url><url><loc>${o}/products/women-balance</loc></url></urlset>`, "application/xml"); }
    if (url.startsWith("/img/")) return send(200, png, "image/png");
    if (url === "/products/mind-calm") return send(200, product("mind-calm", "Rootellect Mind Calm", 899));
    if (url === "/products/women-balance") return state.broken ? send(500, "Internal Server Error") : send(200, product("women-balance", "Rootellect Women Balance", 999));
    if (url === "/cart") return send(200, page("Cart | Rootellect", "<h1>Cart</h1>"));
    return send(404, "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}
