import { createHash } from "node:crypto";
import { prisma, withPlatformAdmin } from "../db";
import { logActivity } from "../audit";
import { FRESH, LADDER, afterFailure, stateOf, waitText, type Guard, type State } from "../login-lock-rules";
import { notify } from "./notifications";
import { formatDateTime } from "../dates";

/** The guard row for an email address. The address itself is never stored, only its hash. */
export const guardKey = (email: string) => createHash("sha256").update(`login:${email.trim().toLowerCase()}`).digest("hex");

const toGuard = (r: { failed: number; rounds: number; lockedUntil: Date | null; bannedAt: Date | null } | null): Guard =>
  r ? { failed: r.failed, rounds: r.rounds, lockedUntil: r.lockedUntil, bannedAt: r.bannedAt } : FRESH;

export async function signInState(email: string, now = new Date()): Promise<State> {
  return stateOf(toGuard(await prisma.loginGuard.findUnique({ where: { key: guardKey(email) } })), now);
}

/** The message for a locked or closed account. Identical whether or not an account exists for the email. */
export function lockedMessage(s: State, now = new Date()): string | null {
  if (s.kind === "banned") return "This account has been closed after repeated wrong passwords. Contact support to have it reviewed.";
  if (s.kind === "locked") return `Too many wrong passwords. Sign-in for this account is locked for ${waitText(s.until, now)} (until ${formatDateTime(s.until)}).`;
  return null;
}

/**
 * Count a wrong password. The row is locked while it is updated, so wrong passwords sent at the same moment are all counted.
 * When this locks or closes a real account, its owner is told, in the app and by email.
 */
export async function recordFailedSignIn(email: string, userId: string | null, now = new Date()) {
  const key = guardKey(email);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO login_guards (key, user_id) VALUES (${key}, ${userId}) ON CONFLICT (key) DO NOTHING`;
    const rows = await tx.$queryRaw<{ failed: number; rounds: number; locked_until: Date | null; banned_at: Date | null }[]>`SELECT failed, rounds, locked_until, banned_at FROM login_guards WHERE key = ${key} FOR UPDATE`;
    const g = toGuard(rows[0] ? { failed: rows[0].failed, rounds: rows[0].rounds, lockedUntil: rows[0].locked_until, bannedAt: rows[0].banned_at } : null);
    if (stateOf(g, now).kind !== "open") return { event: "refused" as const, guard: g, triesLeft: 0 };
    const r = afterFailure(g, now);
    await tx.loginGuard.update({ where: { key }, data: { ...r.guard, userId, lastFailedAt: now, updatedAt: now } });
    return r;
  });
  if (userId && (result.event === "locked" || result.event === "banned")) {
    await withPlatformAdmin("system", async (tx) => {
      await logActivity(tx, { companyId: null, actorId: null, entityType: "user", entityId: userId, action: result.event === "banned" ? "auth.account_closed" : "auth.account_locked", detail: { hours: "hours" in result ? result.hours : null, round: result.guard.rounds } });
      await notify(tx, userId, result.event === "banned"
        ? { kind: "security.account_locked", title: "Your account has been closed after repeated wrong passwords", body: "Someone typed a wrong password for your account many times. To protect it, sign-in is closed until our team reviews it. Contact support from the email address on the account.", link: "/support" }
        : { kind: "security.account_locked", title: `Sign-in to your account is locked for ${"hours" in result ? result.hours : ""} hours`, body: `Three wrong passwords were typed for your account. If that was not you, change your password once the lock ends and turn on two-step sign-in. Repeated locks last longer each time (${LADDER.join(", ")} hours), and then the account is closed.`, link: "/me/security" });
    }).catch((e) => console.error("lock notice failed", e));
  }
  return result;
}

/** A right password: start again from zero. */
export async function recordSuccessfulSignIn(email: string) {
  await prisma.loginGuard.deleteMany({ where: { key: guardKey(email), bannedAt: null } });
}

/** A password reset from the email link proves the owner: it ends a temporary lock, but never a closed account. */
export async function endTemporaryLock(email: string) {
  await prisma.loginGuard.deleteMany({ where: { key: guardKey(email), bannedAt: null } });
}

// ---------- Platform team ----------

export async function signInLocks(adminId: string, now = new Date()) {
  const rows = await prisma.loginGuard.findMany({ where: { OR: [{ bannedAt: { not: null } }, { lockedUntil: { gt: now } }] }, orderBy: { updatedAt: "desc" }, take: 200 });
  const users = await withPlatformAdmin(adminId, (tx) => tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } }));
  return rows.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) ?? null, state: stateOf(toGuard(r), now) }));
}

/** Lift a lock or reopen a closed account, with the reason recorded. */
export async function liftSignInLock(adminId: string, key: string, reason: string) {
  const why = reason.trim();
  if (why.length < 5) throw new Error("Say why the lock is being lifted (for example: owner confirmed by phone)");
  const row = await prisma.loginGuard.findUnique({ where: { key } });
  if (!row) throw new Error("That lock has already ended");
  await prisma.loginGuard.delete({ where: { key } });
  await withPlatformAdmin(adminId, (tx) => logActivity(tx, { companyId: null, actorId: adminId, entityType: "user", entityId: row.userId ?? key.slice(0, 12), action: row.bannedAt ? "auth.account_reopened" : "auth.lock_lifted", detail: { reason: why.slice(0, 300), rounds: row.rounds } }));
}
