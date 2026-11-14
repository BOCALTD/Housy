import { requestIp } from "@/lib/request-ip";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getMember, getSession } from "@/lib/auth";
import { sameOriginRequest } from "@/lib/security";
import { assistantReply, type ChatTurn } from "@/lib/services/assistant-chat";
import { viewerKeyFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { rateLimit } from "@/lib/ratelimit";
import { messageFor } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * The assistant's conversation. Anyone may ask about Housy and search for homes (visitors are limited per day by the assistant
 * settings); a signed-in company member also gets answers from their own company's records. Same-site requests only.
 */
export async function POST(req: Request) {
  if (!sameOriginRequest(req.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const h = await headers();
  const ua = h.get("user-agent") ?? "";
  if (isBot(ua)) return NextResponse.json({ error: "Not available" }, { status: 403 });
  // A person types a few questions a minute; anything faster is a script.
  const ip = await requestIp(req);
  if (!(await rateLimit(`assistant:${ip}`, 20, 60_000)) || !(await rateLimit(`assistant-day:${ip}`, 400, 864e5))) {
    return NextResponse.json({ error: "That is a lot of questions in a short time. Wait a minute and ask again." }, { status: 429 });
  }
  let body: { messages?: ChatTurn[]; workspace?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const session = await getSession();
  const member = session && body.workspace ? await getMember().catch(() => null) : null;
  const visitorKey = viewerKeyFor(await requestIp(req), ua);
  try {
    const a = await assistantReply({ userId: session?.user.id ?? null, companyId: member?.companyId ?? null, visitorKey, name: session?.user.name ?? null, member }, messages);
    return NextResponse.json(a, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: messageFor(e) }, { status: 400 });
  }
}
