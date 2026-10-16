/**
 * Phase 12c: reels and social. Posting rules, platform checking, privacy of what is not yet public, interactions, reports that hide,
 * discovery that cannot be bought or faked, personal suggestions, notices, and reels counting toward the monthly ranking.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { follow, registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { myNotifications } from "../../src/lib/services/notifications";
import {
  addComment, commentsFor, decideReports, discover, getReel, listingChoices, moderateReel, myReels, mySaved, recordShare, reelQueue, reelVideo, reportTarget,
  toggleLike, toggleSave, uploadReel, withdrawReel,
} from "../../src/lib/services/reels";
import { computeMonth } from "../../src/lib/services/awards";
import { MONTHLY_REEL_CAP } from "../../src/lib/social-rules";
import { monthRange } from "../../src/lib/award-rules";
import type { Ctx } from "../../src/lib/services/context";
import { newCompany, newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const person = async (label = "p", ageDays = 30) => {
  const id = (await registerSeeker({ name: `${label} Person ${uid()}`, email: `${label}-${uid()}@example.test`, password: PASSWORD })).userId;
  if (ageDays) await prisma.user.update({ where: { id }, data: { createdAt: new Date(Date.now() - ageDays * 864e5) } });
  return id;
};
async function agent(label: string) {
  const co = await newCompany(label);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} Homes ${uid()}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: `${label} Agent ${uid()}`, headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  return co;
}
const post = (co: Ctx, caption = `Reel ${uid()}`, extra: { city?: string; listingId?: string } = {}) => uploadReel(co.userId, { caption, ...extra }, { type: "video/mp4", bytes: MP4 });

test("who can post, what is accepted, and the limits", async () => {
  const co = await agent("rl");
  const stranger = await person("nolist");
  await assert.rejects(uploadReel(stranger, {}, { type: "video/mp4", bytes: MP4 }), /Only a listed agent/);
  await assert.rejects(uploadReel(co.userId, {}, { type: "image/png", bytes: MP4 }), /MP4 or WebM/);
  await assert.rejects(uploadReel(co.userId, {}, { type: "video/mp4", bytes: new Uint8Array(0) }), /empty/);
  await assert.rejects(uploadReel(co.userId, {}, { type: "video/mp4", bytes: new Uint8Array(4 * 1024 * 1024 + 1) }), /4 MB/);
  await assert.rejects(uploadReel(co.userId, {}, { type: "video/mp4", bytes: WEBM }), /do not match/);
  await assert.rejects(uploadReel(co.userId, { caption: "x".repeat(301) }, { type: "video/mp4", bytes: MP4 }), /300/);
  await assert.rejects(uploadReel(co.userId, { listingId: "not-a-listing" }, { type: "video/mp4", bytes: MP4 }), /published properties/);
  const ok = await uploadReel(co.userId, { caption: "Walk-through" }, { type: "video/webm", bytes: WEBM });
  assert.equal(ok.status, "PENDING");
  await post(co); await post(co);
  await assert.rejects(post(co), /three reels waiting/);
  const c = await listingChoices(co.userId);
  assert.ok(c.listed);
  assert.equal((await listingChoices(stranger)).listed, false);
});

test("a reel is private until the platform publishes it, and the platform decides with a reason", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("pv");
  const fan = await person("fan");
  await follow(fan, "AGENT", co.userId);
  const reel = await post(co, "Quiet street, big garden", { city: "Ikeja" });

  assert.equal(await getReel(reel.id, null), null, "the public cannot see a pending reel");
  assert.equal(await getReel(reel.id, fan), null);
  assert.equal(await reelVideo(reel.id, null), null);
  assert.equal(await reelVideo(reel.id, fan), null);
  assert.equal((await getReel(reel.id, co.userId))!.status, "PENDING", "the author can see their own");
  assert.ok((await reelVideo(reel.id, co.userId))!.bytes.byteLength > 0);
  await assert.rejects(toggleLike(fan, reel.id), /not available/);
  await assert.rejects(addComment(fan, reel.id, "hello"), /not available/);

  await assert.rejects(moderateReel(co.userId, reel.id, "publish", ""), /Only the platform administrator/);
  await assert.rejects(moderateReel(admin.id, reel.id, "hide", ""), /Say why/);
  assert.ok((await reelQueue(admin.id)).pending.some((p) => p.id === reel.id));
  const told = await moderateReel(admin.id, reel.id, "publish", "");
  assert.ok(told >= 1, "followers are told");
  assert.ok((await myNotifications(fan)).some((n) => n.kind === "reel" && n.link === `/reels/${reel.id}`));
  assert.ok((await myNotifications(co.userId)).some((n) => n.title === "Your reel is live"));
  assert.equal((await getReel(reel.id, null))!.status, "PUBLISHED");
  assert.equal((await reelVideo(reel.id, null))!.type, "video/mp4");
  assert.equal(await moderateReel(admin.id, reel.id, "publish", ""), 0, "followers are told only the first time");

  // Hiding and withdrawing take it away again, and a removed reel stays removed.
  await moderateReel(admin.id, reel.id, "hide", "Please show the whole house");
  assert.equal(await getReel(reel.id, null), null);
  await moderateReel(admin.id, reel.id, "publish", "");
  await withdrawReel(co.userId, reel.id);
  assert.equal(await getReel(reel.id, null), null);
  await assert.rejects(moderateReel(admin.id, reel.id, "publish", ""), /cannot be restored/);
  await assert.rejects(withdrawReel(fan, reel.id), /not found/);
  assert.ok((await myReels(co.userId)).some((r) => r.id === reel.id && r.status === "REMOVED"));
});

test("likes, saves, shares and comments: one per person, private saves, no links, notices at milestones", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("ix");
  const reel = await post(co);
  await moderateReel(admin.id, reel.id, "publish", "");
  const a = await person("a"), b = await person("b");

  let r = await toggleLike(a, reel.id);
  assert.deepEqual(r, { liked: true, count: 1 });
  assert.equal((await toggleLike(a, reel.id)).count, 0, "liking again takes it back");
  await toggleLike(a, reel.id); await toggleLike(b, reel.id);
  assert.equal((await getReel(reel.id, a))!.likes, 2);
  assert.equal((await getReel(reel.id, a))!.liked, true);
  assert.equal((await getReel(reel.id, null))!.liked, false);
  const notes = (await myNotifications(co.userId)).filter((n) => n.kind === "reel" && /liked/.test(n.title));
  assert.ok(notes.length >= 1 && notes.length <= 2, "the first like is announced; a busy reel does not flood the author");

  assert.equal((await toggleSave(a, reel.id)).saved, true);
  assert.equal((await getReel(reel.id, a))!.saved, true);
  assert.equal((await getReel(reel.id, b))!.saved, false, "saves are private");
  assert.equal((await mySaved(a)).total, 1);
  assert.equal((await mySaved(b)).total, 0);

  assert.equal((await recordShare(a, reel.id)).count, 1);
  assert.equal((await recordShare(a, reel.id)).count, 1, "a share counts once per person");
  assert.equal((await recordShare(b, reel.id)).count, 2);

  await assert.rejects(addComment(a, reel.id, "   "), /Write a comment/);
  await assert.rejects(addComment(a, reel.id, "x".repeat(501)), /500/);
  await assert.rejects(addComment(a, reel.id, "great, see https://spam.example"), /Links are not allowed/);
  await addComment(a, reel.id, "Is the garden shared?");
  await assert.rejects(addComment(a, reel.id, "Is the garden shared?"), /already said/);
  const cs = await commentsFor(reel.id);
  assert.equal(cs.total, 1);
  assert.match(cs.rows[0].authorName, /^a \S\.$/, "comments show a short name only");
  assert.ok((await myNotifications(co.userId)).some((n) => /commented/.test(n.title)));
});

test("reports: not your own, once each, several hide it, the platform decides", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("rp");
  const reel = await post(co);
  await moderateReel(admin.id, reel.id, "publish", "");
  const [a, b, c] = [await person("r1"), await person("r2"), await person("r3")];
  await assert.rejects(reportTarget(co.userId, "REEL", reel.id, "mine"), /own post/);
  await assert.rejects(reportTarget(a, "REEL", reel.id, "x"), /briefly/);
  await reportTarget(a, "REEL", reel.id, "Not the property shown");
  await assert.rejects(reportTarget(a, "REEL", reel.id, "Not the property shown"), /already reported/);
  await reportTarget(b, "REEL", reel.id, "Misleading price");
  assert.equal((await getReel(reel.id, null))!.status, "PUBLISHED", "two reports are not enough");
  await reportTarget(c, "REEL", reel.id, "Looks like a scam");
  assert.equal(await getReel(reel.id, null), null, "three different people hide it until it is checked");
  const group = (await reelQueue(admin.id)).reports.find((g) => g.targetId === reel.id)!;
  assert.equal(group.count, 3);
  await assert.rejects(decideReports(admin.id, "REEL", reel.id, "dismiss", "x"), /short reason/);
  await decideReports(admin.id, "REEL", reel.id, "dismiss", "Checked, it is accurate");
  assert.equal((await getReel(reel.id, null))!.status, "PUBLISHED", "dismissed reports put it back");
  await assert.rejects(decideReports(admin.id, "REEL", reel.id, "uphold", "again"), /nothing open/);

  // Comments: two reports hide, upholding keeps it hidden and tells the writer.
  const w = await person("w");
  const cm = await addComment(w, reel.id, "Buy my crypto now");
  await reportTarget(a, "COMMENT", cm.id, "Spam");
  await assert.rejects(reportTarget(w, "COMMENT", cm.id, "self"), /own post/);
  await reportTarget(b, "COMMENT", cm.id, "Spam");
  assert.equal((await commentsFor(reel.id)).total, 0);
  await decideReports(admin.id, "COMMENT", cm.id, "uphold", "Spam removed");
  assert.equal((await commentsFor(reel.id)).total, 0);
  assert.ok((await myNotifications(w)).some((n) => /comment was removed/.test(n.title)));

  // Upholding a report on a reel removes it for good.
  const bad = await post(co);
  await moderateReel(admin.id, bad.id, "publish", "");
  await reportTarget(a, "REEL", bad.id, "Fake listing");
  await decideReports(admin.id, "REEL", bad.id, "uphold", "Fake");
  assert.equal(await getReel(bad.id, null), null);
  assert.ok((await myReels(co.userId)).some((x) => x.id === bad.id && x.status === "REMOVED"));
});

test("discovery follows real engagement; fakes, self-likes, payment and input order do not move it; suggestions are personal", async () => {
  const admin = await newPlatformAdmin();
  const A = await agent("dA"), B = await agent("dB"), C = await agent("dC");
  const ra = await post(A, "A quiet one", { city: "Zzzville" }), rb = await post(B, "B quiet one", { city: "Qqqtown" }), rc = await post(C, "C quiet one", { city: "Zzzville" });
  for (const r of [ra, rb, rc]) await moderateReel(admin.id, r.id, "publish", "");
  const mine = new Set([ra.id, rb.id, rc.id]);
  const order = async (viewer?: string, tab?: "foryou" | "following" | "trending") => (await discover({ viewerId: viewer ?? null, tab, page: 0 })).ranked.filter((x) => mine.has(x.id)).map((x) => x.id);

  const base = await order();
  assert.deepEqual(await order(), base, "the same data gives the same order");

  // Brand-new accounts and the author's own likes change nothing.
  await toggleLike(A.userId, ra.id);
  for (let i = 0; i < 6; i++) await toggleLike(await person("bot", 0), rb.id);
  assert.deepEqual(await order(), base, "new accounts and self-likes do not count");

  // A Gold plan does not help either.
  const gold = await withUser("plan-reader", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } }));
  await assignSubscription(admin.id, { planId: gold.id, periodEnd: relativeDate(60), companyId: C.companyId });
  assert.deepEqual(await order(), base, "paying does not move a reel");

  // Established people engaging for real does.
  const real = [await person("o1"), await person("o2"), await person("o3")];
  for (const p of real) { await toggleLike(p, rc.id); await recordShare(p, rc.id); }
  assert.equal((await order())[0], rc.id);

  // Personal suggestions: following B puts B first for that person only, and the Following tab shows only followed agents.
  const me = await person("me");
  assert.deepEqual((await discover({ viewerId: me, tab: "following" })).rows, [], "following nobody shows nothing");
  await follow(me, "AGENT", B.userId);
  assert.equal((await order(me, "foryou"))[0], rb.id);
  assert.deepEqual((await discover({ viewerId: me, tab: "following" })).rows.map((r) => r.id), [rb.id]);
  assert.ok((await discover({ viewerId: me, tab: "foryou" })).rows.find((r) => r.id === rb.id)!.why.includes("You follow them"));
  assert.equal((await order(real[0], "foryou"))[0], rc.id, "someone else still sees what is popular first");
  // Liking a reel from a place leans suggestions toward that place.
  const me2 = await person("me2");
  await toggleLike(me2, ra.id);
  const near = (await discover({ viewerId: me2, tab: "foryou" })).ranked;
  assert.ok(near.find((x) => x.id === rc.id)!.why.some((w) => /Zzzville/.test(w)), "same area is noted");
  // Paging: a short page, then the rest.
  const p0 = await discover({ viewerId: null, tab: "trending", page: 0 });
  assert.ok(p0.rows.length <= 6 && p0.pages >= 1);
});

test("published reels count as posts for the monthly ranking, up to a cap", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("aw");
  // A past month that no other test ranks, so it is never frozen.
  const THIS = "2026-03";
  const AFTER = new Date(monthRange(THIS).end.getTime() + 864e5);
  // Made directly, because an agent may post only five reels a day.
  await withPlatformAdmin(admin.id, async (tx) => {
    for (let i = 0; i < MONTHLY_REEL_CAP + 2; i++) {
      await tx.reel.create({ data: { authorId: co.userId, companyId: co.companyId, caption: `Cap ${i}`, mimeType: "video/mp4", sizeBytes: 20, status: "PUBLISHED", publishedAt: new Date(monthRange(THIS).start.getTime() + (i + 1) * 3600_000), reviewedById: admin.id } });
    }
  });
  const run = await computeMonth(admin.id, THIS, AFTER);
  const e = await withPlatformAdmin(admin.id, (tx) => tx.awardEntry.findFirst({ where: { runId: run.id, userId: co.userId } }));
  assert.ok(e, "an agent with only reels is in the ranking");
  assert.equal(e!.posts, MONTHLY_REEL_CAP, "volume is capped");
  assert.equal(e!.eligible, false, "posts alone are not enough: a verified sale and reviews are still needed");
});
