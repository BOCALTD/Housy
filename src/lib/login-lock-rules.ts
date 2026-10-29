/**
 * Locking an account after wrong passwords. Every 3 wrong passwords in a row lock the account: 4 hours the first time, then
 * 3 hours longer each time (7, 10, 13, 16, 19, 22 hours). Three more wrong passwords after the 22-hour lock close the account
 * for good, until the platform team reviews it. A right password resets the count. Pure functions, tested on their own.
 */

export const TRIES_PER_ROUND = 3;
export const FIRST_LOCK_HOURS = 4;
export const STEP_HOURS = 3;
export const LAST_LOCK_HOURS = 22;
const HOUR = 3_600_000;

export type Guard = { failed: number; rounds: number; lockedUntil: Date | null; bannedAt: Date | null };
export const FRESH: Guard = { failed: 0, rounds: 0, lockedUntil: null, bannedAt: null };

/** How long the nth lock lasts, or null when the nth round closes the account. */
export function lockHours(round: number): number | null {
  const h = FIRST_LOCK_HOURS + STEP_HOURS * (round - 1);
  return round >= 1 && h <= LAST_LOCK_HOURS ? h : null;
}

/** Every lock in order, for the help text: [4, 7, 10, 13, 16, 19, 22]. */
export const LADDER = Array.from({ length: 20 }, (_, k) => lockHours(k + 1)).filter((h): h is number => h !== null);

export type State = { kind: "open"; triesLeft: number } | { kind: "locked"; until: Date } | { kind: "banned" };

export function stateOf(g: Guard, now = new Date()): State {
  if (g.bannedAt) return { kind: "banned" };
  if (g.lockedUntil && g.lockedUntil.getTime() > now.getTime()) return { kind: "locked", until: g.lockedUntil };
  return { kind: "open", triesLeft: TRIES_PER_ROUND - g.failed };
}

/** A wrong password while the account is open. Attempts during a lock are refused before the password is checked, so they never count. */
export function afterFailure(g: Guard, now = new Date()): { guard: Guard; event: "counted" | "locked" | "banned"; hours?: number; triesLeft: number } {
  const failed = g.failed + 1;
  if (failed < TRIES_PER_ROUND) return { guard: { ...g, failed, lockedUntil: null }, event: "counted", triesLeft: TRIES_PER_ROUND - failed };
  const rounds = g.rounds + 1;
  const hours = lockHours(rounds);
  if (hours === null) return { guard: { failed: 0, rounds, lockedUntil: null, bannedAt: now }, event: "banned", triesLeft: 0 };
  return { guard: { failed: 0, rounds, lockedUntil: new Date(now.getTime() + hours * HOUR), bannedAt: null }, event: "locked", hours, triesLeft: 0 };
}

/** How a lock reads to a person: "3 h 59 min", "45 min". */
export function waitText(until: Date, now = new Date()): string {
  const min = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
