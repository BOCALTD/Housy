/**
 * "Confirm it's you" for sensitive areas. Opening or saving in one of them asks for the account password again (and the
 * two-step code when it is on) unless the person confirmed in the last 15 minutes on this session. Working there
 * keeps it fresh; 15 minutes away asks again. Five wrong tries end the session (the person signs in again) and the account owner is told.
 *
 * Sensitive areas: the platform administrator's settings, connections, payments and finance, people, companies, plans,
 * sign-in locks, identity checks, legal pages, rewards, referrals and promotions; and in a company workspace, anything that needs
 * settings, team, billing, API, identity-check or payout-approval permission.
 */
import { prisma } from "../db";
import { logActivity } from "../audit";
import { verifyPassword } from "../auth-hash";
import { rateLimit } from "../ratelimit";
import { checkSecondStep } from "./account";
import { enqueueEmail } from "./notifications";

export { REAUTH_MINUTES, REAUTH_MAX_FAILS, SENSITIVE_ADMIN_PATHS, SENSITIVE_ACTIONS, isSensitivePath, isSensitiveAction, confirmedRecently } from "../reauth-rules";
import { REAUTH_MINUTES, REAUTH_MAX_FAILS } from "../reauth-rules";

/** Restart the window after a confirmed save in a sensitive area. */
export async function touchReauth(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, reauthAt: { gt: new Date(Date.now() - REAUTH_MINUTES * 60_000) } }, data: { reauthAt: new Date() } });
}

export type ConfirmResult = { ok: true } | { ok: false; error: string; signedOut?: boolean };

/** Check the password (and the two-step code when on). Five wrong tries in a row end the session. */
export async function confirmIdentity(sessionId: string, password: string, code: string): Promise<ConfirmResult> {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: { select: { id: true, passwordHash: true, mfaEnabledAt: true } } } });
  if (!s || s.expiresAt < new Date()) return { ok: false, error: "Your session has ended. Sign in again.", signedOut: true };
  if (!(await rateLimit(`reauth:${s.userId}`, 20, 15 * 60_000))) return { ok: false, error: "Too many tries. Wait 15 minutes and try again." };
  const passOk = password.length > 0 && password.length <= 200 && (await verifyPassword(password, s.user.passwordHash));
  const codeOk = passOk && (!s.user.mfaEnabledAt || (code.trim() !== "" && (await checkSecondStep(s.userId, code.trim()))));
  if (passOk && codeOk) {
    await prisma.session.update({ where: { id: sessionId }, data: { reauthAt: new Date(), reauthFails: 0 } });
    await prisma.$transaction((tx) => logActivity(tx, { companyId: null, actorId: s.userId, entityType: "user", entityId: s.userId, action: "security.reconfirmed", detail: {} }));
    return { ok: true };
  }
  const fails = s.reauthFails + 1;
  if (fails >= REAUTH_MAX_FAILS) {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    await prisma.$transaction(async (tx) => {
      await logActivity(tx, { companyId: null, actorId: s.userId, entityType: "user", entityId: s.userId, action: "security.reconfirm_locked", detail: { fails } });
      await enqueueEmail(tx, s.userId, { kind: "security.reconfirm_locked", template: "security_notice", vars: { title: "Someone could not confirm it was you", body: `There were ${fails} wrong tries to confirm your password on a signed-in device, so that device was signed out. If this was not you, change your password now.` }, ref: `reconfirm-locked:${sessionId}` });
    });
    return { ok: false, error: "Too many wrong tries. You have been signed out for safety; sign in again.", signedOut: true };
  }
  await prisma.session.update({ where: { id: sessionId }, data: { reauthFails: fails } });
  const left = REAUTH_MAX_FAILS - fails;
  return { ok: false, error: `${!passOk ? "That password is not right." : "That code is not right."} ${left} ${left === 1 ? "try" : "tries"} left before you are signed out.` };
}
