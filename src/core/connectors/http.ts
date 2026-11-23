export type ConnectorStatus = "CONNECTED" | "DEGRADED" | "TOKEN_EXPIRED" | "PERMISSION_REQUIRED" | "DISCONNECTED";

export class ConnectorError extends Error {
  constructor(public connector: string, public httpStatus: number, message: string) {
    super(`${connector}: ${message}`);
  }
  get status(): ConnectorStatus {
    if (this.httpStatus === 401) return "TOKEN_EXPIRED";
    if (this.httpStatus === 403) return "PERMISSION_REQUIRED";
    if (this.httpStatus === 429 || this.httpStatus >= 500 || this.httpStatus === 0) return "DEGRADED";
    return "DEGRADED";
  }
}

export async function call<T = unknown>(connector: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new ConnectorError(connector, 0, `network error: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const b = JSON.parse(text);
      msg = b.error?.message ?? b.error_description ?? b.message ?? b.errors?.[0]?.message ?? msg;
    } catch { /* raw */ }
    throw new ConnectorError(connector, res.status, `${res.status} ${msg}`);
  }
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

export const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
