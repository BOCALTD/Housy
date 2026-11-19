"use server";

import { getMember, getSession } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { runUndo } from "@/lib/services/undo";
import "@/lib/services/undo-handlers";

/** The Undo button in a message: reverse what the person just did. */
export async function undoAction(id: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, error: "Sign in again to undo." };
    const member = await getMember().catch(() => null);
    const label = await runUndo({ userId: session.userId, member }, String(id ?? "").slice(0, 64));
    return { ok: true, message: `Undone: ${label}` };
  } catch (e) {
    return { ok: false, error: messageFor(e) };
  }
}
