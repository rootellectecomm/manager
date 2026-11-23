import { agentStandup } from "@/core/office";
import { currentUser } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const u = await currentUser();
  if (!u) return new Response("unauthorized", { status: 401 });
  const { code } = await params;
  try {
    return Response.json(await agentStandup(code.toUpperCase(), u.name.split(" ")[0] || "Founder"));
  } catch {
    return new Response("not found", { status: 404 });
  }
}
