import { officeSnapshot } from "@/core/office";
import { currentUser } from "../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await currentUser())) return new Response("unauthorized", { status: 401 });
  return Response.json(await officeSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
