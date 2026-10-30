import { getMember, type Member } from "./auth";
import { rateLimit } from "./ratelimit";
import { sameOriginRequest } from "./security";
import { can } from "./permissions";

/** The signed-in field worker for an offline-sync request, or the response to send instead. */
export async function fieldMember(req: Request, write: boolean): Promise<Member | Response> {
  if (write && !sameOriginRequest(req.headers)) return Response.json({ error: "Send this from the app" }, { status: 403 });
  const member = await getMember();
  if (!member) return Response.json({ error: "Sign in again to send your work. It stays saved on this device." }, { status: 401 });
  if (member.companySuspended) return Response.json({ error: "Your company's workspace is closed" }, { status: 403 });
  if (!can(member.role, "inspection.conduct")) return Response.json({ error: "Your role does not include inspections" }, { status: 403 });
  if (!(await rateLimit(`field:${member.userId}`, 240, 60_000))) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  return member;
}

/** A refusal the inspector can act on: the message of a checked error, never internals. */
export function fieldError(e: unknown) {
  const msg = e instanceof Error && e.message.length < 300 && !/prisma|invalid `|database/i.test(e.message) ? e.message : "That could not be saved. Try again.";
  const zod = e && typeof e === "object" && "issues" in e ? "Some of what was sent is not valid. Update the app and try again." : null;
  return Response.json({ error: zod ?? msg }, { status: 400 });
}
