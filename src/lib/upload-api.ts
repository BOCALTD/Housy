import { getSession } from "./auth";
import { rateLimit } from "./ratelimit";
import { sameOriginRequest } from "./security";

/** The signed-in person sending a reel in pieces, or the response to send instead. */
export async function uploader(req: Request, write: boolean): Promise<string | Response> {
  if (write && !sameOriginRequest(req.headers)) return Response.json({ error: "Send this from the app" }, { status: 403 });
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in again, then choose the video again." }, { status: 401 });
  if (!(await rateLimit(`upload:${s.user.id}`, 600, 60_000))) return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
  return s.user.id;
}

/** A refusal the person can act on: the message of a checked error, never internals. */
export function uploadError(e: unknown) {
  const msg = e instanceof Error && e.message.length < 300 && !/prisma|invalid `|database|ENOENT|EACCES|ENOSPC/i.test(e.message) ? e.message : "The video could not be received. Try again.";
  return Response.json({ error: msg }, { status: 400 });
}
