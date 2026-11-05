/**
 * Phase 18a: one account, every hat; profile pictures; taking a break. A personal account becomes an agent without signing up
 * again and switches between the two; only real memberships can be switched to; pictures are checked; a break hides the
 * person and pauses their optional email, and signing in ends it.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { registerSeeker, saveAgentProfile, directory } from "../../src/lib/services/community";
import { becomeAgent, checkModeTarget, endBreak, onBreak, profileFor, profileImage, removeProfileImage, saveProfileImage, takeBreak, updateAbout } from "../../src/lib/services/profile";
import { newCompany } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => randomUUID().slice(0, 6);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

test("a personal account becomes an agent and switches between the two", async () => {
  const me = await registerSeeker({ name: "Ada Switch", email: `ada${uid()}@example.test`, password: "a long enough password" });
  assert.equal((await profileFor(me.userId)).agentBusiness, null);
  await assert.rejects(becomeAgent(me.userId, { tradingName: "", phone: "12" }), /phone/i);
  const companyId = await becomeAgent(me.userId, { tradingName: "Ada Homes", phone: "0803 123 4567" });
  const p = await profileFor(me.userId);
  assert.equal(p.agentBusiness?.companyId, companyId);
  assert.equal(p.agentBusiness?.company.name, "Ada Homes");
  assert.equal(p.phone, "+2348031234567");
  assert.equal(await becomeAgent(me.userId, { tradingName: "Again", phone: "0803 123 4567" }), companyId, "asking twice keeps one agent business");
  assert.equal(await checkModeTarget(me.userId, companyId), companyId);
  assert.equal(await checkModeTarget(me.userId, null), null, "personal is always allowed");
  const other = await newCompany("notmine");
  await assert.rejects(checkModeTarget(me.userId, other.companyId), /not an active member/);
  const agent = await withTenant(companyId, me.userId, (tx) => tx.agentProfile.findFirst({ where: { userId: me.userId } }));
  assert.ok(agent, "an agent profile is created");
});

test("profile name, bio and pictures", async () => {
  const me = await registerSeeker({ name: "Bola Pic", email: `bola${uid()}@example.test`, password: "a long enough password" });
  await updateAbout(me.userId, { name: "Bola Pictures", bio: "Looking for a 2-bed in Yaba." });
  await assert.rejects(updateAbout(me.userId, { name: "B", bio: "" }), /name/i);
  await assert.rejects(saveProfileImage(me.userId, "avatar", "image/png", JPG), /not the picture type/);
  await saveProfileImage(me.userId, "avatar", "image/jpeg", JPG);
  await saveProfileImage(me.userId, "cover", "image/jpeg", JPG);
  const p = await profileFor(me.userId);
  assert.equal(p.name, "Bola Pictures");
  assert.equal(p.bio, "Looking for a 2-bed in Yaba.");
  assert.match(p.avatarUrl ?? "", new RegExp(`^/u/${me.userId}/avatar\\?v=\\d+$`));
  assert.ok(p.coverUrl);
  assert.equal((await profileImage(me.userId, "avatar"))?.type, "image/jpeg");
  await removeProfileImage(me.userId, "avatar");
  assert.equal((await profileFor(me.userId)).avatarUrl, null);
  assert.equal(await profileImage(me.userId, "avatar"), null);
});

test("a break hides the agent, signs them out and ends at the next sign-in", async () => {
  const co = await newCompany("break");
  const name = `Break Agent ${uid()}`;
  await saveAgentProfile(co, { displayName: name, headline: "", bio: "", listed: true, acceptsMessages: true });
  await saveProfileImage(co.userId, "avatar", "image/jpeg", JPG);
  const seen = async () => (await directory({ kind: "agents", q: name, page: 1, viewerId: null })).rows.some((r) => r.name === name);
  assert.equal(await seen(), true);
  await prisma.session.create({ data: { userId: co.userId, tokenHash: `t${uid()}${uid()}`, companyId: null, expiresAt: new Date(Date.now() + 864e5) } });
  await takeBreak(co.userId, "month");
  assert.equal(await onBreak(co.userId), true);
  assert.equal(await prisma.session.count({ where: { userId: co.userId } }), 0, "signed out everywhere");
  assert.equal(await seen(), false, "hidden from the directory");
  assert.equal(await profileImage(co.userId, "avatar"), null, "no picture while away");
  const u = await prisma.user.findUnique({ where: { id: co.userId }, select: { breakUntil: true } });
  assert.ok(u?.breakUntil && u.breakUntil.getTime() > Date.now() + 25 * 864e5);
  await assert.rejects(takeBreak(co.userId, "forever" as never), /how long/);
  assert.equal(await endBreak(co.userId), true);
  assert.equal(await endBreak(co.userId), false, "only once");
  assert.equal(await seen(), true, "visible again");
});
