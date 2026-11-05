import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { messagesSince } from "@/lib/services/messaging";
import { chatMessage } from "@/lib/chat-shape";

export const dynamic = "force-dynamic";

/** An open chat asks for what arrived since its last message. Only a member of the conversation gets anything. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get("after");
  const after = raw ? new Date(raw) : new Date(0);
  if (Number.isNaN(after.getTime())) return NextResponse.json({ error: "Bad time" }, { status: 400 });
  try {
    const { actor } = await currentActor();
    const r = await messagesSince(actor, id, after);
    return NextResponse.json({ messages: r.messages.map(chatMessage), seenUpTo: r.seenUpTo?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
