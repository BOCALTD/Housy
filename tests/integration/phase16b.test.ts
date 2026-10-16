/**
 * Phase 16b: account recovery and two-step sign-in. Reset links are single-use, expire, and say nothing about who has an account.
 * A code from the authenticator works once. Recovery codes work once. Changing a password signs other devices out.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { verifyPassword } from "../../src/lib/auth-hash";
import { hashToken } from "../../src/lib/tokens";
import { changePassword, checkSecondStep, confirmMfa, disableMfa, mfaStatus, requestPasswordReset, resetLinkIsValid, resetPassword, signOutOtherDevices, startMfa } from "../../src/lib/services/account";
import { codeFor, openSecret, stepAt } from "../../src/lib/totp";
import { newCompany, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const outbox = (userId: string) => withPlatformAdmin("system", (tx) => tx.emailOutbox.findMany({ where: { userId, kind: "security.password_reset" }, orderBy: { createdAt: "asc" } }));
const tokenOf = (row: { vars: unknown }) => new URL(`http://x${(row.vars as { link: string }).link}`).searchParams.get("t")!;
async function person(label: string) {
  const c = await newCompany(label);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  return { ...c, email: u.email };
}
const sessionFor = (userId: string, token: string) => prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 864e5) } });
const visitor = () => `v-${Math.random().toString(36).slice(2, 8)}`;

test("a reset link is mailed only to a real account, but the answer is the same either way", async () => {
  const p = await person("reset-a");
  await requestPasswordReset("nobody-here@example.test", visitor()); // no error, no leak
  await requestPasswordReset("not an email", visitor());
  assert.equal((await outbox(p.userId)).length, 0);
  await requestPasswordReset(p.email.toUpperCase(), visitor());
  const rows = await outbox(p.userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "ESSENTIAL", "security mail is not subject to the person's email choices");
  assert.equal(rows[0].template, "password_reset");
  assert.match((rows[0].vars as { link: string }).link, /^\/reset\?t=[\w-]{40,}$/);
  // The database holds only a hash of the link's secret.
  const stored = await prisma.passwordReset.findMany({ where: { userId: p.userId } });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].tokenHash, hashToken(tokenOf(rows[0])));
  assert.notEqual(stored[0].tokenHash, tokenOf(rows[0]));
});

test("a reset link works once, then the old password stops working and every device is signed out", async () => {
  const p = await person("reset-b");
  await sessionFor(p.userId, `s1-${p.userId}`); await sessionFor(p.userId, `s2-${p.userId}`);
  await requestPasswordReset(p.email, visitor());
  const token = tokenOf((await outbox(p.userId))[0]);
  assert.equal(await resetLinkIsValid(token), true);
  assert.equal(await resetLinkIsValid(token + "x"), false);
  assert.equal(await resetLinkIsValid(""), false);
  await assert.rejects(resetPassword(token, "short"), /at least 10/);
  assert.equal(await resetLinkIsValid(token), true, "a rejected password does not use the link up");
  await assert.rejects(resetPassword("made-up-token", "a-new-password-1"), /invalid or has expired/);

  await resetPassword(token, "a-brand-new-password-1");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
  assert.equal(await verifyPassword("a-brand-new-password-1", u.passwordHash), true);
  assert.equal(await verifyPassword(PASSWORD, u.passwordHash), false);
  assert.equal(await prisma.session.count({ where: { userId: p.userId } }), 0, "every signed-in device is signed out");
  assert.equal(await resetLinkIsValid(token), false);
  await assert.rejects(resetPassword(token, "another-password-12"), /invalid or has expired/);
  // The person is told it happened.
  const notices = await withPlatformAdmin("system", (tx) => tx.emailOutbox.findMany({ where: { userId: p.userId, kind: "security.password_changed" } }));
  assert.equal(notices.length, 1);
});

test("a newer link replaces an older one, and an old link has a time limit", async () => {
  const p = await person("reset-c");
  await requestPasswordReset(p.email, visitor());
  await requestPasswordReset(p.email, visitor());
  const [first, second] = (await outbox(p.userId)).map(tokenOf);
  assert.equal(await resetLinkIsValid(first), false, "asking again cancels the earlier link");
  assert.equal(await resetLinkIsValid(second), true);
  await prisma.passwordReset.updateMany({ where: { userId: p.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await resetLinkIsValid(second), false);
  await assert.rejects(resetPassword(second, "a-brand-new-password-2"), /invalid or has expired/);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
  assert.equal(await verifyPassword(PASSWORD, u.passwordHash), true, "the password is unchanged");
});

test("someone cannot flood an inbox with reset mail", async () => {
  const p = await person("reset-d");
  for (let i = 0; i < 6; i++) await requestPasswordReset(p.email, visitor());
  assert.equal((await outbox(p.userId)).length, 3, "three per hour per address");
  const ip = visitor();
  let refused = 0;
  for (let i = 0; i < 12; i++) { try { await requestPasswordReset(`someone-${i}@example.test`, ip); } catch (e) { assert.match((e as Error).message, /Too many/); refused++; } }
  assert.ok(refused >= 2, "ten per hour per visitor");
});

test("changing the password needs the current one and signs the other devices out", async () => {
  const p = await person("change");
  await sessionFor(p.userId, `here-${p.userId}`); await sessionFor(p.userId, `phone-${p.userId}`); await sessionFor(p.userId, `laptop-${p.userId}`);
  await assert.rejects(changePassword(p.userId, "wrong-password-1", "a-new-password-12", `here-${p.userId}`), /current password is not right/);
  await assert.rejects(changePassword(p.userId, PASSWORD, PASSWORD, `here-${p.userId}`), /different/);
  await assert.rejects(changePassword(p.userId, PASSWORD, "short", `here-${p.userId}`), /at least 10/);
  await changePassword(p.userId, PASSWORD, "a-new-password-12", `here-${p.userId}`);
  const left = await prisma.session.findMany({ where: { userId: p.userId } });
  assert.deepEqual(left.map((s) => s.tokenHash), [hashToken(`here-${p.userId}`)], "only this device stays signed in");
  await sessionFor(p.userId, `again-${p.userId}`);
  assert.equal(await signOutOtherDevices(p.userId, `here-${p.userId}`), 1);
  assert.equal(await prisma.session.count({ where: { userId: p.userId } }), 1);
});

test("two-step sign-in: set up, prove it works, then each code works once", async () => {
  const p = await person("mfa");
  assert.deepEqual(await mfaStatus(p.userId), { enabled: false, pending: false, recoveryLeft: 0 });
  assert.equal(await checkSecondStep(p.userId, "000000"), true, "nothing is asked of an account without it");

  const { secret, uri } = await startMfa(p.userId);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.match(uri, /^otpauth:\/\/totp\/Housy:/);
  assert.equal((await mfaStatus(p.userId)).enabled, false, "not on until a code is confirmed");
  assert.equal(await checkSecondStep(p.userId, "000000"), true);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
  assert.ok(stored.mfaSecret && !stored.mfaSecret.includes(secret), "the secret is stored encrypted");
  assert.equal(openSecret(stored.mfaSecret!), secret);

  await assert.rejects(confirmMfa(p.userId, "123456"), /not right/);
  const step = stepAt(Date.now());
  const codes = await confirmMfa(p.userId, codeFor(secret, step));
  assert.equal(codes.length, 10);
  assert.deepEqual(await mfaStatus(p.userId), { enabled: true, pending: false, recoveryLeft: 10 });
  const hashes = await prisma.mfaRecovery.findMany({ where: { userId: p.userId } });
  assert.ok(hashes.every((h) => !codes.includes(h.codeHash)), "recovery codes are stored only as hashes");
  await assert.rejects(startMfa(p.userId), /already on/);

  // The code used to confirm cannot be used again; the next one can, once.
  assert.equal(await checkSecondStep(p.userId, codeFor(secret, step)), false);
  const next = codeFor(secret, stepAt(Date.now()) + 1);
  assert.equal(await checkSecondStep(p.userId, next), true);
  assert.equal(await checkSecondStep(p.userId, next), false, "replaying a code fails");
  assert.equal(await checkSecondStep(p.userId, "000000"), false);
  assert.equal(await checkSecondStep(p.userId, ""), false);
  assert.equal(await checkSecondStep(p.userId, "not a code at all"), false);

  // A recovery code works once, in any spelling.
  assert.equal(await checkSecondStep(p.userId, codes[0].toUpperCase().replace(/-/g, " ")), true);
  assert.equal(await checkSecondStep(p.userId, codes[0]), false);
  assert.equal((await mfaStatus(p.userId)).recoveryLeft, 9);
  assert.equal(await checkSecondStep(p.userId, "abcd-efgh-jkmn"), false);
});

test("two-step sign-in needs the password to turn off, and two people cannot use one code at the same moment", async () => {
  const p = await person("mfa-off");
  const { secret } = await startMfa(p.userId);
  await confirmMfa(p.userId, codeFor(secret, stepAt(Date.now())));
  await assert.rejects(disableMfa(p.userId, "wrong-password-1"), /password is not right/);
  assert.equal((await mfaStatus(p.userId)).enabled, true);

  // Ten attempts with the same fresh code at once: exactly one succeeds.
  const code = codeFor(secret, stepAt(Date.now()) + 1);
  const results = await Promise.all(Array.from({ length: 10 }, () => checkSecondStep(p.userId, code)));
  assert.equal(results.filter(Boolean).length, 1);

  await disableMfa(p.userId, PASSWORD);
  assert.deepEqual(await mfaStatus(p.userId), { enabled: false, pending: false, recoveryLeft: 0 });
  assert.equal(await prisma.mfaRecovery.count({ where: { userId: p.userId } }), 0);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
  assert.equal(u.mfaSecret, null);
});

test("one person's recovery code cannot be used by another", async () => {
  const a = await person("mfa-x"), b = await person("mfa-y");
  const sa = await startMfa(a.userId), sb = await startMfa(b.userId);
  const ca = await confirmMfa(a.userId, codeFor(sa.secret, stepAt(Date.now())));
  await confirmMfa(b.userId, codeFor(sb.secret, stepAt(Date.now())));
  assert.equal(await checkSecondStep(b.userId, ca[1]), false);
  assert.equal(await checkSecondStep(b.userId, codeFor(sa.secret, stepAt(Date.now()) + 1)), false, "nor a code from someone else's app");
  assert.equal(await checkSecondStep(a.userId, ca[1]), true);
});
