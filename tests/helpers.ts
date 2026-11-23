import { db } from "@/core/db/client";
import { createFounder } from "@/core/auth";

export async function founder() {
  const existing = await db.user.findFirst({ where: { role: "FOUNDER" } });
  const u = existing ?? (await createFounder("founder@rootellect.test", "Partik", "correct-horse-battery", "+919800000000"));
  return { user: u, actor: `founder:${u.id}` };
}

export async function setAgent(code: string, data: { status?: string; maxAutonomousRisk?: number; tools?: string[] }) {
  const { tools, ...rest } = data;
  await db.agent.update({ where: { code }, data: { ...rest, ...(tools ? { tools: JSON.stringify(tools) } : {}) } });
}

/** Routes fetch calls whose URL starts with a prefix to a fake handler; everything else hits the real network/local servers. */
export function interceptFetch(routes: { prefix: string; handler: (url: string, init?: RequestInit) => Promise<Response> | Response }[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = routes.find((x) => url.startsWith(x.prefix));
    return r ? r.handler(url, init) : real(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
