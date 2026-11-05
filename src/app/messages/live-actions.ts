"use server";

import { currentActor } from "@/lib/collab-session";
import { messageFor } from "@/lib/forms";
import { sendMessage } from "@/lib/services/messaging";
import { chatMessage, type ChatMsg } from "@/lib/chat-shape";

/** Send from the open chat without reloading the page; the message comes back to replace the one shown while sending. */
export async function sendChatAction(conversationId: string, body: string, replyToId?: string): Promise<{ ok: true; message: ChatMsg } | { ok: false; error: string }> {
  try {
    const { actor } = await currentActor();
    const m = await sendMessage(actor, conversationId, body, replyToId);
    return { ok: true, message: chatMessage(m) };
  } catch (e) {
    return { ok: false, error: messageFor(e) };
  }
}
