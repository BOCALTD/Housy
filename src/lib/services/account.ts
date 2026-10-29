import { guardKey } from "./login-guard";
import { z } from "zod";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../auth-hash";
import { hashToken, newToken } from "../tokens";
import { rateLimit } from "../ratelimit";
import { enqueueEmail } from "./notifications";
import { hashRecovery, newRecoveryCodes, newSecret, normaliseRecovery, openSecret, otpauthUri, sealSecret, verifyCode } from "../totp";

// Account recovery and two-step sign-in. These work on the account itself, not on a company.

export const RESET_MINUTES = 60;
const passwordRule = z.string().min(10, "Use a password of at least 10 characters").max(200);
const ISSUER = "Housy";

/**
 * Ask for a reset link. The answer never says whether the email has an account, and the number of requests is limited
 * per address and per visitor so this cannot be used to flood someone's inbox.
 */
export async function requestPasswordReset(rawEmail: string, visitorKey: string): Promise<void> {
  const email = z.string().trim().toLowerCase().email().safeParse(rawEmail);
  if (!email.success) return;
  if (!(await rateLimit(`reset-ip:${visitorKey}`, 10, 60 * 60 * 1000))) throw new Error("Too many requests. Try again in an hour.");
  if (!(await rateLimit(`reset-email:${email.data}`, 3, 60 * 60 * 1000))) return; // quietly: the person already has recent links
  const user = await prisma.user.findUnique({ where: { email: email.data }, select: { id: true, name: true } });
  if (!user) return;
  const token = newToken();
  const tokenHash = hashToken(token);
  await prisma.$transaction(async (tx) => {
    await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
    await enqueueEmail(tx, user.id, { kind: "security.password_reset", template: "password_reset", vars: { name: user.name, link: `/reset?t=${token}` }, dedupeKey: `reset:${tokenHash}` });
  });
}

export async function resetLinkIsValid(token: string): Promise<boolean> {
  if (!token) return false;
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!r && !r.usedAt && r.expiresAt > new Date();
}

/** Choose a new password from a reset link. The link works once; every signed-in device is signed out. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const pw = passwordRule.parse(newPassword);
  const hash = await hashPassword(pw);
  await prisma.$transaction(async (tx) => {
    const r = await tx.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!r || r.usedAt || r.expiresAt < new Date()) throw new Error("This link is invalid or has expired. Ask for a new one.");
    const claimed = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("This link is invalid or has expired. Ask for a new one.");
    const owner = await tx.user.update({ where: { id: r.userId }, data: { passwordHash: hash } });
    // The email link proves the owner, so a temporary sign-in lock ends here; a closed account stays closed.
    await tx.loginGuard.deleteMany({ where: { key: guardKey(owner.email), bannedAt: null } });
    await tx.session.deleteMany({ where: { userId: r.userId } });
    await tx.passwordReset.updateMany({ where: { userId: r.userId, usedAt: null }, data: { usedAt: new Date() } });
    await enqueueEmail(tx, r.userId, { kind: "security.password_changed", template: "security_notice", vars: { title: "Your password was changed", body: "Your password was reset and you were signed out everywhere." }, ref: "reset" });
  });
}

/** Change the password while signed in. Other devices are signed out; this one stays. */
export async function changePassword(userId: string, current: string, next: string, keepSessionToken: string | null): Promise<void> {
  const pw = passwordRule.parse(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new Error("Your current password is not right.");
  if (current === pw) throw new Error("Choose a password different from the current one.");
  const hash = await hashPassword(pw);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    await tx.session.deleteMany({ where: { userId, ...(keepSessionToken ? { tokenHash: { not: hashToken(keepSessionToken) } } : {}) } });
    await enqueueEmail(tx, userId, { kind: "security.password_changed", template: "security_notice", vars: { title: "Your password was changed", body: "Your password was changed and your other devices were signed out." }, ref: "change" });
  });
}

export async function signOutOtherDevices(userId: string, keepSessionToken: string | null): Promise<number> {
  const r = await prisma.session.deleteMany({ where: { userId, ...(keepSessionToken ? { tokenHash: { not: hashToken(keepSessionToken) } } : {}) } });
  return r.count;
}

// ---------- two-step sign-in ----------

export async function mfaStatus(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true, mfaSecret: true } });
  const left = u.mfaEnabledAt ? await prisma.mfaRecovery.count({ where: { userId, usedAt: null } }) : 0;
  return { enabled: !!u.mfaEnabledAt, pending: !u.mfaEnabledAt && !!u.mfaSecret, recoveryLeft: left };
}

/** Make a new secret to add to an authenticator app. Two-step sign-in is not on until a code from the app is confirmed. */
export async function startMfa(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.mfaEnabledAt) throw new Error("Two-step sign-in is already on.");
  const secret = newSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecret: sealSecret(secret), mfaLastStep: null } });
  return { secret, uri: otpauthUri(secret, u.email, ISSUER) };
}

/** Turn it on by proving the app works. Returns the recovery codes, shown once. */
export async function confirmMfa(userId: string, code: string): Promise<string[]> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.mfaEnabledAt || !u.mfaSecret) throw new Error("Start again to set up two-step sign-in.");
  const step = verifyCode(openSecret(u.mfaSecret), code, Date.now(), null);
  if (step === null) throw new Error("That code is not right. Check the code in your app and try again.");
  const codes = newRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date(), mfaLastStep: BigInt(step) } });
    await tx.mfaRecovery.deleteMany({ where: { userId } });
    await tx.mfaRecovery.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecovery(c) })) });
    await enqueueEmail(tx, userId, { kind: "security.mfa_on", template: "security_notice", vars: { title: "Two-step sign-in was turned on", body: "Your account now asks for a code from your authenticator app when you sign in." }, ref: "mfa-on" });
  });
  return codes;
}

export async function disableMfa(userId: string, password: string): Promise<void> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(password, u.passwordHash))) throw new Error("Your password is not right.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } });
    await tx.mfaRecovery.deleteMany({ where: { userId } });
    await enqueueEmail(tx, userId, { kind: "security.mfa_off", template: "security_notice", vars: { title: "Two-step sign-in was turned off", body: "Your account no longer asks for a code when you sign in." }, ref: "mfa-off" });
  });
}

/** Check the second step at sign-in: a current code (each works once) or an unused recovery code. */
export async function checkSecondStep(userId: string, submitted: string): Promise<boolean> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.mfaEnabledAt || !u.mfaSecret) return true;
  const step = verifyCode(openSecret(u.mfaSecret), submitted, Date.now(), u.mfaLastStep);
  if (step !== null) {
    const claimed = await prisma.user.updateMany({ where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] }, data: { mfaLastStep: BigInt(step) } });
    return claimed.count === 1;
  }
  if (normaliseRecovery(submitted).length === 12) {
    const used = await prisma.mfaRecovery.updateMany({ where: { userId, codeHash: hashRecovery(submitted), usedAt: null }, data: { usedAt: new Date() } });
    return used.count === 1;
  }
  return false;
}

