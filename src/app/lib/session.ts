import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionUser, actorOf } from "@/core/auth";

export const SESSION_COOKIE = "ros_session";

export async function currentUser() {
  const c = await cookies();
  return sessionUser(c.get(SESSION_COOKIE)?.value);
}

/** Every page and server action calls this — server actions are reachable by direct POST. */
export async function requireFounder() {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.role !== "FOUNDER") redirect("/login?e=role");
  return { user: u, actor: actorOf(u) };
}
