"use server";

import { getSession } from "@/lib/auth";
import { getOrCreateCode } from "@/lib/services/referrals";
import { shareablePath } from "@/lib/share-rules";

/**
 * The invite code to put in a shared link, so a person who signs up through it counts as the sharer's referral.
 * Signed-out visitors can still share; their link simply has no code.
 */
export async function shareCodeAction(path: string): Promise<string | null> {
  if (!shareablePath(path)) return null;
  const session = await getSession();
  if (!session) return null;
  try { return (await getOrCreateCode(session.user.id)).code; } catch { return null; }
}
