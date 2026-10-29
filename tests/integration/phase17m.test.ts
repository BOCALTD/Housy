/**
 * Phase 17m: sign-in locks. Three wrong passwords lock sign-in for 4 hours, each later round 3 hours longer up to 22 hours,
 * then the account is closed until the platform team reopens it. Locks count per email address (also for unknown addresses),
 * the owner is told, a reset link ends a lock but not a closure, and only the platform team can reopen.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withUser } from "../../src/lib/db";
import { guardKey, liftSignInLock, lockedMessage, recordFailedSignIn, recordSuccessfulSignIn, signInLocks, signInState } from "../../src/lib/services/login-guard";
import { lockHours } from "../../src/lib/login-lock-rules";
import { newPlatformAdmin } from "./helpers";
import { registerSeeker } from "../../src/lib/services/community";

after(() => prisma.$disconnect());
const H = 3_600_000;

test("wrong passwords lock, the lock grows each round, and the eighth round closes the account", async () => {
  const email = `lock-${randomUUID().slice(0, 8)}@example.test`;
  const { userId } = await registerSeeker({ name: "Lock Test", email, password: "integration-test-pw" });
  const admin = await newPlatformAdmin();
  let now = new Date(Date.now() + 1000);

  // Two wrong passwords, then a right one: the count starts again.
  await recordFailedSignIn(email, userId, now); await recordFailedSignIn(email, userId, now);
  assert.deepEqual(await signInState(email, now), { kind: "open", triesLeft: 1 });
  await recordSuccessfulSignIn(email);
  assert.deepEqual(await signInState(email, now), { kind: "open", triesLeft: 3 });

  for (let round = 1; round <= 7; round++) {
    const a = await recordFailedSignIn(email, userId, now), b = await recordFailedSignIn(email, userId, now), c = await recordFailedSignIn(email, userId, now);
    assert.deepEqual([a.event, b.event, c.event], ["counted", "counted", "locked"]);
    const s = await signInState(email, now);
    assert.equal(s.kind, "locked");
    assert.equal((s as { until: Date }).until.getTime() - now.getTime(), lockHours(round)! * H);
    // While locked, more wrong passwords are refused and not counted.
    assert.equal((await recordFailedSignIn(email, userId, now)).event, "refused");
    assert.match(lockedMessage(s, now)!, new RegExp(`locked for ${lockHours(round)} h`));
    now = new Date(now.getTime() + lockHours(round)! * H + 1000);
  }
  await recordFailedSignIn(email, userId, now); await recordFailedSignIn(email, userId, now);
  assert.equal((await recordFailedSignIn(email, userId, now)).event, "banned");
  assert.equal((await signInState(email, new Date(now.getTime() + 1000 * 24 * H))).kind, "banned", "a closure never wears off");
  // A right password does not reopen a closed account.
  await recordSuccessfulSignIn(email);
  assert.equal((await signInState(email)).kind, "banned");

  // The owner was told about each lock and the closure, in the app (and so by email).
  const notes = await withUser(userId, (tx) => tx.notification.findMany({ where: { userId, kind: "security.account_locked" }, orderBy: { createdAt: "asc" } }));
  assert.equal(notes.length, 8);
  assert.match(notes[0].title, /locked for 4 hours/);
  assert.match(notes[7].title, /closed/);

  // The platform team sees it with the person's name, must give a reason, and can reopen it.
  const listed = (await signInLocks(admin.id)).find((r) => r.key === guardKey(email));
  assert.equal(listed?.user?.email, email);
  await assert.rejects(liftSignInLock(admin.id, guardKey(email), "ok"), /Say why/);
  await liftSignInLock(admin.id, guardKey(email), "Owner confirmed by phone and ID");
  assert.deepEqual(await signInState(email), { kind: "open", triesLeft: 3 });
});

test("an email with no account locks exactly the same way, so the sign-in page reveals nothing", async () => {
  const email = `nobody-${randomUUID().slice(0, 8)}@example.test`;
  const now = new Date(Date.now() + 1000);
  for (let k = 0; k < 3; k++) await recordFailedSignIn(email, null, now);
  assert.equal((await signInState(email, now)).kind, "locked");
  // Only a hash of the address is stored.
  const row = await prisma.loginGuard.findUniqueOrThrow({ where: { key: guardKey(email) } });
  assert.ok(!JSON.stringify(row).includes(email.split("@")[0]));
  // Wrong passwords sent at the same moment are all counted.
  const burst = `burst-${randomUUID().slice(0, 8)}@example.test`;
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => recordFailedSignIn(burst, null, now)));
  assert.deepEqual(results.map((r) => r.event).sort(), ["counted", "counted", "locked", "refused", "refused"]);
});
