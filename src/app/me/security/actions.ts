"use server";

import { currentSessionToken, requireUser } from "@/lib/auth";
import { act, messageFor, str, withNotice } from "@/lib/forms";
import { changePassword, confirmMfa, disableMfa, signOutOtherDevices, startMfa } from "@/lib/services/account";
import { rateLimit } from "@/lib/ratelimit";

const BACK = "/me/security";

export async function changePasswordAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    if (!(await rateLimit(`pwchange:${u.id}`, 10, 60 * 60 * 1000))) throw new Error("Too many attempts. Try again later.");
    await changePassword(u.id, str(form, "current"), str(form, "next"), await currentSessionToken());
    return withNotice(BACK, "Your password was changed. Other devices were signed out.");
  });
}

export async function signOutOthersAction() {
  return act(BACK, async () => {
    const u = await requireUser();
    const n = await signOutOtherDevices(u.id, await currentSessionToken());
    return withNotice(BACK, n ? `Signed out of ${n} other ${n === 1 ? "device" : "devices"}.` : "No other devices were signed in.");
  });
}

export async function startMfaAction() {
  return act(BACK, async () => {
    const u = await requireUser();
    await startMfa(u.id);
    return BACK;
  });
}

export type ConfirmState = { error?: string; codes?: string[] };
/** Returns the recovery codes to the page instead of redirecting, so they are shown once and never stored in a URL or cookie. */
export async function confirmMfaAction(form: FormData): Promise<ConfirmState> {
  try {
    const u = await requireUser();
    if (!(await rateLimit(`mfa-setup:${u.id}`, 10, 15 * 60 * 1000))) throw new Error("Too many attempts. Wait 15 minutes.");
    return { codes: await confirmMfa(u.id, str(form, "code")) };
  } catch (e) {
    if (typeof (e as { digest?: unknown } | null)?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")) throw e;
    return { error: messageFor(e) };
  }
}

export async function disableMfaAction(form: FormData) {
  return act(BACK, async () => {
    const u = await requireUser();
    if (!(await rateLimit(`mfa-off:${u.id}`, 5, 15 * 60 * 1000))) throw new Error("Too many attempts. Wait 15 minutes.");
    await disableMfa(u.id, str(form, "password"));
    return withNotice(BACK, "Two-step sign-in is off.");
  });
}
