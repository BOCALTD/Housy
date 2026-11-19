"use server";

import { getSession } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { reactionSummary, setReaction, setShared, type Kind, type Summary, type Value } from "@/lib/services/reactions";

type Result = { ok: true; summary: Summary } | { ok: false; error: string; signIn?: boolean };
const KINDS: Kind[] = ["LISTING", "REEL", "BANNER"];

/** Like, dislike or clear (the buttons offer Undo by setting back what was there). */
export async function reactAction(kind: Kind, id: string, value: Value): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Sign in to like or dislike.", signIn: true };
  if (!KINDS.includes(kind) || (value !== null && value !== "LIKE" && value !== "DISLIKE")) return { ok: false, error: "That is not something you can react to." };
  try { return { ok: true, summary: await setReaction(s.userId, kind, String(id).slice(0, 64), value) }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}

/** Record a share, or take it back. */
export async function shareStateAction(kind: Kind, id: string, on: boolean): Promise<Result> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Sign in to keep track of what you share.", signIn: true };
  if (!KINDS.includes(kind)) return { ok: false, error: "That is not something you can share." };
  try { return { ok: true, summary: await setShared(s.userId, kind, String(id).slice(0, 64), !!on) }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}

/** Counts and your own reaction for one item (for panels that open later, such as a reel's "More"). */
export async function reactionSummaryAction(kind: Kind, id: string): Promise<Result> {
  if (!KINDS.includes(kind)) return { ok: false, error: "Not found." };
  const s = await getSession();
  try { return { ok: true, summary: await reactionSummary(kind, String(id).slice(0, 64), s?.userId ?? null) }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
