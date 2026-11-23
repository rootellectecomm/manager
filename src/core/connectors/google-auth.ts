import { createSign } from "node:crypto";
import { call } from "./http";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }
const cache = new Map<string, { token: string; exp: number }>();

/** OAuth2 access token from a service-account JSON key (JWT bearer flow, RS256). */
export async function serviceAccountToken(connector: string, saJson: string, scopes: string[]): Promise<string> {
  const sa = JSON.parse(saJson) as ServiceAccount;
  const cacheKey = `${sa.client_email}|${scopes.join(" ")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: scopes.join(" "), aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await call<{ access_token: string; expires_in: number }>(connector, sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  cache.set(cacheKey, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}

/** OAuth2 access token from a user refresh token (installed-app / web client). */
export async function refreshTokenAccess(connector: string, clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const cacheKey = `${clientId}|${refreshToken.slice(-8)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const r = await call<{ access_token: string; expires_in: number }>(connector, "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  cache.set(cacheKey, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}
