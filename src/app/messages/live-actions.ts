"use server";

import { currentActor } from "@/lib/collab-session";
import { messageFor } from "@/lib/forms";
import { reactToMessage, sendMessage, setTyping } from "@/lib/services/messaging";
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

/** Tell the others this person is typing (the chat calls this at most every few seconds while they type). */
export async function typingAction(conversationId: string): Promise<void> {
  try { const { actor } = await currentActor(); await setTyping(actor, conversationId); } catch { /* not important enough to report */ }
}

/** Add, change or take away a reaction. Returns the message's reactions afterwards. */
export async function reactAction(messageId: string, emoji: string | null): Promise<{ ok: true; reactions: { emoji: string; userId: string }[] } | { ok: false; error: string }> {
  try {
    const { actor } = await currentActor();
    return { ok: true, reactions: await reactToMessage(actor, messageId, emoji) };
  } catch (e) {
    return { ok: false, error: messageFor(e) };
  }
}
