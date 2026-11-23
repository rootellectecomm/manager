import { db } from "./db/client";
import { audit } from "./audit";
import { decryptSecret, encryptSecret, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { newTotpSecret, verifyTotp } from "./totp";

export const SESSION_TTL_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export async function createFounder(email: string, name: string, password: string, phone?: string) {
  if (password.length < 12) throw new Error("Use at least 12 characters for the founder password.");
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), name, passwordHash: await hashPassword(password), role: "FOUNDER", phone },
    update: { name, passwordHash: await hashPassword(password), phone },
  });
  await audit({ actor: "system:cli", action: "user.founder_set", entityType: "user", entityId: user.id, data: { email: user.email } });
  return user;
}

export async function login(email: string, password: string, userAgent?: string, totp?: string): Promise<{ token: string; userId: string } | { error: string; needsTotp?: boolean }> {
  const normalized = email.toLowerCase().trim();
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
  const failures = await db.auditEvent.count({ where: { action: "auth.login_failed", entityId: normalized, createdAt: { gte: since } } });
  if (failures >= MAX_FAILURES) return { error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` };

  const user = await db.user.findUnique({ where: { email: normalized } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    await audit({ actor: "anonymous", action: "auth.login_failed", entityType: "user", entityId: normalized });
    return { error: "Email or password is incorrect." };
  }
  if (user.mfaSecret) {
    if (!totp) return { error: "Enter the 6-digit code from your authenticator app.", needsTotp: true };
    if (!verifyTotp(decryptSecret(user.mfaSecret), totp)) {
      await audit({ actor: "anonymous", action: "auth.login_failed", entityType: "user", entityId: normalized, data: { reason: "totp" } });
      return { error: "That authenticator code is not valid.", needsTotp: true };
    }
  }
  const token = randomToken();
  await db.session.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000), userAgent } });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actor: `founder:${user.id}`, action: "auth.login", entityType: "user", entityId: user.id });
  return { token, userId: user.id };
}

export async function sessionUser(token: string | undefined | null) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

export async function logout(token: string) {
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export function actorOf(user: { id: string; role: string }): string {
  return `${user.role === "FOUNDER" ? "founder" : "user"}:${user.id}`;
}

/** Step 1: create a pending secret (not active until confirmed with a valid code). */
export async function beginMfaSetup(userId: string) {
  const secret = newTotpSecret();
  await db.setting.upsert({ where: { key: `mfa_pending:${userId}` }, create: { key: `mfa_pending:${userId}`, value: encryptSecret(secret) }, update: { value: encryptSecret(secret) } });
  return secret;
}

/** Step 2: confirm with a code from the app; only then is MFA required at login. */
export async function confirmMfa(userId: string, code: string) {
  const pending = await db.setting.findUnique({ where: { key: `mfa_pending:${userId}` } });
  if (!pending) throw new Error("Start MFA setup first.");
  const secret = decryptSecret(pending.value);
  if (!verifyTotp(secret, code)) throw new Error("Code didn't match. Check your phone's clock and try again.");
  await db.user.update({ where: { id: userId }, data: { mfaSecret: encryptSecret(secret) } });
  await db.setting.delete({ where: { key: `mfa_pending:${userId}` } });
  await audit({ actor: `founder:${userId}`, action: "auth.mfa_enabled", entityType: "user", entityId: userId });
}

export async function disableMfa(userId: string, code: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.mfaSecret) return;
  if (!verifyTotp(decryptSecret(u.mfaSecret), code)) throw new Error("A current authenticator code is required to turn MFA off.");
  await db.user.update({ where: { id: userId }, data: { mfaSecret: null } });
  await audit({ actor: `founder:${userId}`, action: "auth.mfa_disabled", entityType: "user", entityId: userId });
}
