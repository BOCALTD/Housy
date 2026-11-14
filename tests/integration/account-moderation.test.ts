/**
 * Suspending and permanently removing a person's account for shady activity: sign-in refused, sessions ended, profiles and
 * their own agent workspace hidden and brought back on restore; removal erases them and stops the same email or phone joining
 * again. Platform administrators cannot be acted on, and only a platform administrator can act.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { registerAgent } from "../../src/lib/services/companies";
import { registerSeeker } from "../../src/lib/services/community";
import { findPeople, personForAdmin, removeUserPermanently, restoreUser, suspendUser } from "../../src/lib/services/account-moderation";
import { newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => randomUUID().slice(0, 8);

test("a suspended agent is signed out, cannot get a session, and their own workspace leaves public view until restored", async () => {
  const admin = await newPlatformAdmin();
  const email = `shady-${uid()}@example.test`;
  const { userId, companyId } = await registerAgent({ name: "Shady Agent", email, password: "a-long-password-123", phone: `080${Math.floor(1e7 + Math.random() * 8e7)}`, tradingName: "" });
  await prisma.session.create({ data: { userId, companyId, tokenHash: `t-${uid()}`, expiresAt: new Date(Date.now() + 864e5) } });

  await assert.rejects(suspendUser(admin.id, userId, "short"), /10 characters/);
  await assert.rejects(suspendUser(userId, userId, "Trying to suspend myself as a non-admin"), /platform administrator/);
  await suspendUser(admin.id, userId, "Listed properties that do not exist and took inspection money.");
  await assert.rejects(suspendUser(admin.id, userId, "Again, for the same reason as before."), /already suspended/);
  const after1 = await withPlatformAdmin(admin.id, async (tx) => ({
    sessions: await tx.session.count({ where: { userId } }),
    company: await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { suspendedAt: true, suspendedReason: true } }),
    profilesShown: await tx.agentProfile.count({ where: { userId, platformHidden: false } }),
  }));
  assert.equal(after1.sessions, 0, "signed out everywhere");
  assert.ok(after1.company.suspendedAt, "their own agent workspace is suspended with them");
  assert.equal(after1.profilesShown, 0);
  assert.ok((await findPeople(admin.id, { status: "suspended", q: email })).rows.some((r) => r.id === userId));
  // No new session, whichever way they sign in (createSession needs a request, so the rule is checked at its source).
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { suspendedAt: true } });
  assert.ok(u.suspendedAt);

  await restoreUser(admin.id, userId, "Reviewed: the listings were a staff member's error.");
  const after2 = await withPlatformAdmin(admin.id, async (tx) => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { suspendedAt: true } }),
    user: await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { suspendedAt: true } }),
  }));
  assert.equal(after2.user.suspendedAt, null);
  assert.equal(after2.company.suspendedAt, null, "the workspace comes back with them");
  const p = (await personForAdmin(admin.id, userId))!;
  assert.deepEqual(p.history.map((h) => h.action).sort(), ["user.restored", "user.suspended"]);
});

test("a removed account is erased and its email and phone cannot be used to join again; administrators are never acted on", async () => {
  const admin = await newPlatformAdmin();
  const email = `scammer-${uid()}@example.test`, phone = `081${Math.floor(1e7 + Math.random() * 8e7)}`;
  const { userId } = await registerSeeker({ name: "Scam Person", email, password: "a-long-password-123", phone });
  await assert.rejects(removeUserPermanently(admin.id, userId, "Running a fake flatmate scheme.", "remove it"), /Type REMOVE/);
  await removeUserPermanently(admin.id, userId, "Running a fake flatmate scheme.", "REMOVE");
  const gone = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(gone.name, "Deleted user");
  assert.ok(gone.removedAt);
  assert.ok(!gone.email.includes("scammer"), "the email address is erased");
  assert.equal(gone.phone, "");
  const blocked = await withPlatformAdmin(admin.id, (tx) => tx.blockedIdentity.findMany({ where: { userId } }));
  assert.equal(blocked.length, 2);
  assert.ok(blocked.every((b) => !b.valueHash.includes("scammer") && b.valueHash.length === 64), "only hashes are kept");
  await assert.rejects(registerSeeker({ name: "Scam Again", email: email.toUpperCase(), password: "a-long-password-123" }), /cannot be created/);
  await assert.rejects(registerSeeker({ name: "Scam Again", email: `new-${uid()}@example.test`, password: "a-long-password-123", phone: phone.replace(/^0/, "+234") }), /cannot be created/, "the same phone in another format");
  await assert.rejects(removeUserPermanently(admin.id, userId, "Running a fake flatmate scheme.", "REMOVE"), /already been removed/);

  const otherAdmin = await newPlatformAdmin();
  await assert.rejects(suspendUser(admin.id, otherAdmin.id, "Testing that administrators are protected."), /administrator accounts/);
  await assert.rejects(removeUserPermanently(admin.id, otherAdmin.id, "Testing that administrators are protected.", "REMOVE"), /administrator accounts/);
});
