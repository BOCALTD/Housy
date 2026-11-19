import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { currentActor } from "@/lib/collab-session";
import { messageFor } from "@/lib/forms";
import { sendAttachment } from "@/lib/services/messaging";
import { chatMessage } from "@/lib/chat-shape";
import { MAX_FILE_BYTES } from "@/lib/chat-files";
import { sameOriginRequest } from "@/lib/security";

export const dynamic = "force-dynamic";

/** Send a file or a voice note into a chat the person is in. Answers with the message, as the chat shows it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to send files." }, { status: 401 });
  if (!sameOriginRequest(req.headers)) return NextResponse.json({ error: "Send files from the chat." }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 200_000) return NextResponse.json({ error: "Files can be up to 10 MB." }, { status: 413 });
  const { id } = await params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file to send." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Files can be up to 10 MB." }, { status: 413 });
    const kind = form.get("kind") === "VOICE" ? "VOICE" : "FILE";
    const { actor } = await currentActor();
    const m = await sendAttachment(actor, id, {
      kind, name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
      caption: String(form.get("caption") ?? ""), durationMs: Number(form.get("durationMs") ?? 0) || null,
    });
    return NextResponse.json({ message: chatMessage(m) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: messageFor(e) }, { status: 400 });
  }
}
