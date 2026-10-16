import { test } from "node:test";
import assert from "node:assert/strict";
import { countedEngagement, decay, isLikeMilestone, rankFeed, sniffVideo, type Engagement, type FeedReel } from "../../src/lib/social-rules";

const now = new Date("2026-10-16T12:00:00Z");
const old = new Date("2026-01-01T00:00:00Z");
const eng = (kind: Engagement["kind"], userId: string, created = old, at = now): Engagement => ({ kind, userId, userCreatedAt: created, at });

test("only other people's engagement from established accounts counts, once per kind", () => {
  const r = countedEngagement("author", [
    eng("like", "author"),                                   // own like
    eng("like", "a"), eng("like", "a"),                      // twice from one person
    eng("like", "new", new Date(now.getTime() - 3600_000)),  // an hour-old account
    eng("comment", "a"), eng("share", "b"), eng("save", "b"),
  ]);
  assert.deepEqual(r.by, { like: 1, comment: 1, save: 1, share: 1 });
  assert.equal(r.score, 1 + 2 + 2 + 3);
});

test("a flood of brand-new accounts moves nothing", () => {
  const fresh = new Date(now.getTime() - 60_000);
  const bots = Array.from({ length: 200 }, (_, i) => eng("like", `bot${i}`, fresh));
  assert.equal(countedEngagement("author", bots).score, 0);
});

test("reach halves every three days", () => {
  assert.ok(Math.abs(decay(new Date(now.getTime() - 72 * 3600_000), now) - 0.5) < 1e-9);
  assert.equal(decay(now, now), 1);
});

const reel = (id: string, over: Partial<FeedReel> = {}): FeedReel => ({ id, authorId: `u-${id}`, companyId: `c-${id}`, city: "Lagos", publishedAt: now, engagement: 0, ...over });

test("ranking is reproducible and ignores input order", () => {
  const reels = [reel("a", { engagement: 5 }), reel("b", { engagement: 20 }), reel("c", { engagement: 5, publishedAt: new Date(now.getTime() - 864e5) })];
  const one = rankFeed(reels, now), two = rankFeed([...reels].reverse(), now);
  assert.deepEqual(one, two);
  assert.deepEqual(one.map((r) => r.id), ["b", "a", "c"]);
});

test("people you follow and places you care about come first, and nothing about payment is an input", () => {
  const reels = [reel("pop", { engagement: 40, city: "Abuja" }), reel("friend", { engagement: 0, authorId: "me-follows" }), reel("near", { engagement: 0, city: "Lekki" })];
  const viewer = { followedAuthors: new Set(["me-follows"]), followedCompanies: new Set<string>(), cities: new Set(["lekki"]) };
  const order = rankFeed(reels, now, viewer);
  assert.equal(order[0].id, "friend");
  assert.ok(order[0].why.includes("You follow them"));
  assert.ok(order.find((o) => o.id === "near")!.why[0].startsWith("Near"));
  assert.equal(Object.keys(reels[0]).some((k) => /plan|tier|promo|gold|paid/i.test(k)), false);
});

test("clips are checked by their first bytes", () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
  assert.ok(sniffVideo("video/mp4", mp4) && sniffVideo("video/webm", webm));
  assert.ok(!sniffVideo("video/mp4", webm) && !sniffVideo("video/webm", mp4) && !sniffVideo("image/png", mp4));
});

test("like notices come at milestones only", () => {
  assert.deepEqual([1, 2, 9, 10, 11, 50, 99, 100, 150, 200].filter(isLikeMilestone), [1, 10, 50, 100, 200]);
});
