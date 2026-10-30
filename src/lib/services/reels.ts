import { z } from "zod";
import { prisma, withPublic, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { rateLimit } from "../ratelimit";
import {
  REEL_MAX_BYTES, REEL_TYPES, FEED_WINDOW_DAYS, REPORTS_TO_HIDE_COMMENT, REPORTS_TO_HIDE_REEL, countedEngagement, isLikeMilestone, rankFeed, sniffVideo,
  type Engagement, type FeedReel, type Viewer,
} from "../social-rules";
import { notify } from "./notifications";
import { system } from "./rewards";
import { shortName } from "./reviews";
import { reelTaste } from "./signals";

// Reels: short property videos by listed agents. Every reel is checked by the platform before it is public. People can like, save,
// share, comment and report. Reach is organic: it comes from other people's engagement and never from a plan or a promotion.

export const FEED_PAGE = 6;
export const COMMENT_PAGE = 10;
export type Tab = "foryou" | "following" | "trending";

async function adminOnly(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Posting ----------

const postSchema = z.object({
  caption: z.string().trim().max(300, "Keep the caption to 300 characters").default(""),
  city: z.string().trim().max(80).default(""),
  listingId: z.string().trim().optional(),
});

/** Post a reel for checking, or keep it as a draft only its author can see until they send it. */
export async function uploadReel(userId: string, input: z.input<typeof postSchema>, file: { type: string; bytes: Uint8Array }, opts: { draft?: boolean } = {}) {
  const d = postSchema.parse(input);
  if (!(REEL_TYPES as readonly string[]).includes(file.type)) throw new Error("Upload an MP4 or WebM video");
  if (file.bytes.byteLength === 0) throw new Error("The video is empty");
  if (file.bytes.byteLength > REEL_MAX_BYTES) throw new Error("Videos must be 4 MB or smaller for now. Trim the clip or lower its quality.");
  if (!sniffVideo(file.type, file.bytes)) throw new Error("The file contents do not match its type");
  return system(async (tx) => {
    const profile = await tx.agentProfile.findFirst({ where: { userId, listed: true }, orderBy: { createdAt: "asc" } });
    if (!profile) throw new Error("Only a listed agent can post reels. Add your agent profile first and tick the box to list it.");
    let listingId: string | null = null, city = d.city;
    if (d.listingId) {
      const l = await tx.listing.findFirst({ where: { id: d.listingId, companyId: profile.companyId, status: "PUBLISHED" } });
      if (!l) throw new Error("Choose one of your company's published properties");
      listingId = l.id; city = city || l.city;
    }
    const since = new Date(Date.now() - 864e5);
    if ((await tx.reel.count({ where: { authorId: userId, createdAt: { gte: since } } })) >= 5) throw new Error("You have posted five reels today. Please come back tomorrow.");
    if (!opts.draft && (await tx.reel.count({ where: { authorId: userId, status: "PENDING" } })) >= 3) throw new Error("You already have three reels waiting for review. Save this one as a draft for now.");
    if (opts.draft && (await tx.reel.count({ where: { authorId: userId, status: "DRAFT" } })) >= 10) throw new Error("You have ten drafts. Send or delete some first.");
    const reel = await tx.reel.create({ data: { authorId: userId, companyId: profile.companyId, listingId, caption: d.caption, city, mimeType: file.type, sizeBytes: file.bytes.byteLength, status: opts.draft ? "DRAFT" : "PENDING" } });
    await tx.reelMedia.create({ data: { reelId: reel.id, bytes: Buffer.from(file.bytes) } });
    await logActivity(tx, { companyId: profile.companyId, actorId: userId, entityType: "reel", entityId: reel.id, action: "reel.posted", detail: { listingId } });
    return reel;
  });
}

/** Send a draft for checking, with its caption as it now reads. */
export async function sendDraft(userId: string, reelId: string, caption?: string) {
  const text = caption === undefined ? undefined : postSchema.shape.caption.parse(caption);
  return system(async (tx) => {
    const r = await tx.reel.findFirst({ where: { id: reelId, authorId: userId } });
    if (!r || r.status !== "DRAFT") throw new Error("That draft was not found");
    if ((await tx.reel.count({ where: { authorId: userId, status: "PENDING" } })) >= 3) throw new Error("You already have three reels waiting for review. Send this one when one of them is checked.");
    await tx.reel.update({ where: { id: r.id }, data: { status: "PENDING", ...(text !== undefined ? { caption: text } : {}) } });
    await logActivity(tx, { companyId: r.companyId, actorId: userId, entityType: "reel", entityId: r.id, action: "reel.posted", detail: { fromDraft: true } });
  });
}

export async function withdrawReel(userId: string, reelId: string) {
  await system(async (tx) => {
    const r = await tx.reel.findFirst({ where: { id: reelId, authorId: userId } });
    if (!r) throw new Error("Reel not found");
    if (r.status === "REMOVED") throw new Error("This reel is already removed");
    await tx.reel.update({ where: { id: r.id }, data: { status: "REMOVED", reviewNote: r.status === "PUBLISHED" || r.status === "PENDING" ? "Withdrawn by the author" : r.reviewNote } });
    await logActivity(tx, { companyId: r.companyId, actorId: userId, entityType: "reel", entityId: r.id, action: "reel.withdrawn", detail: {} });
  });
}

// ---------- Platform check ----------

export async function moderateReel(adminId: string, reelId: string, action: "publish" | "hide" | "remove", note: string) {
  await adminOnly(adminId);
  const why = note.trim();
  if (action !== "publish" && why.length < 3) throw new Error("Say why, so the agent knows what to change");
  const told = await system(async (tx) => {
    const r = await tx.reel.findUnique({ where: { id: reelId } });
    if (!r) throw new Error("Reel not found");
    if (r.status === "REMOVED" && action !== "remove") throw new Error("A removed reel cannot be restored");
    const first = action === "publish" && !r.publishedAt;
    await tx.reel.update({
      where: { id: r.id },
      data: action === "publish"
        ? { status: "PUBLISHED", reviewNote: why, reviewedById: adminId, publishedAt: r.publishedAt ?? new Date() }
        : { status: action === "hide" ? "HIDDEN" : "REMOVED", reviewNote: why, reviewedById: adminId },
    });
    await notify(tx, r.authorId, action === "publish"
      ? { kind: "reel", title: "Your reel is live", body: r.caption.slice(0, 120), link: `/reels/${r.id}` }
      : { kind: "reel", title: action === "hide" ? "Your reel was hidden" : "Your reel was removed", body: why, link: "/reels/mine" });
    await logActivity(tx, { companyId: r.companyId, actorId: adminId, entityType: "reel", entityId: r.id, action: `reel.${action}`, detail: { note: why } });
    if (!first) return 0;
    // Tell the people who follow this agent or their company, once, when the reel first goes live.
    const profile = await tx.agentProfile.findFirst({ where: { userId: r.authorId }, select: { displayName: true } });
    const follows = await tx.follow.findMany({ where: { OR: [{ targetKind: "AGENT", targetId: r.authorId }, { targetKind: "COMPANY", targetId: r.companyId }] }, select: { followerId: true }, take: 500 });
    for (const id of [...new Set(follows.map((f) => f.followerId))].filter((id) => id !== r.authorId)) await notify(tx, id, { kind: "reel", title: `New reel from ${profile?.displayName ?? "an agent you follow"}`, body: r.caption.slice(0, 120), link: `/reels/${r.id}` });
    return follows.length;
  });
  return told;
}

export async function reelQueue(adminId: string) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const pending = await tx.reel.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 50 });
    const reports = await tx.socialReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 200 });
    const groups = new Map<string, { kind: string; targetId: string; reelId: string; reasons: string[]; count: number }>();
    for (const r of reports) {
      const k = `${r.targetKind}:${r.targetId}`;
      const g = groups.get(k) ?? { kind: r.targetKind, targetId: r.targetId, reelId: r.reelId, reasons: [], count: 0 };
      g.count++; g.reasons.push(r.reason); groups.set(k, g);
    }
    const reelIds = [...new Set([...pending.map((p) => p.id), ...[...groups.values()].map((g) => g.reelId)])];
    const reels = await tx.reel.findMany({ where: { id: { in: reelIds } } });
    const comments = await tx.reelComment.findMany({ where: { id: { in: [...groups.values()].filter((g) => g.kind === "COMMENT").map((g) => g.targetId) } } });
    const authors = await tx.agentProfile.findMany({ where: { userId: { in: reels.map((r) => r.authorId) } }, select: { userId: true, displayName: true } });
    const name = (id: string) => authors.find((a) => a.userId === id)?.displayName ?? "Agent";
    return {
      pending: pending.map((r) => ({ ...r, authorName: name(r.authorId) })),
      reports: [...groups.values()].map((g) => { const reel = reels.find((r) => r.id === g.reelId); return { ...g, reelStatus: reel?.status ?? "REMOVED", authorName: reel ? name(reel.authorId) : "Agent", caption: g.kind === "COMMENT" ? comments.find((c) => c.id === g.targetId)?.body ?? "" : reel?.caption ?? "" }; }),
    };
  });
}

/** Decide every open report on one reel or comment together. */
export async function decideReports(adminId: string, kind: "REEL" | "COMMENT", targetId: string, decision: "uphold" | "dismiss", note: string) {
  await adminOnly(adminId);
  const why = note.trim();
  if (why.length < 3) throw new Error("Give a short reason");
  await system(async (tx) => {
    const open = await tx.socialReport.findMany({ where: { targetKind: kind, targetId, status: "OPEN" } });
    if (!open.length) throw new Error("There is nothing open to decide");
    const stamp = { status: decision === "uphold" ? ("ACTIONED" as const) : ("DISMISSED" as const), decidedById: adminId, decidedAt: new Date() };
    await tx.socialReport.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: stamp });
    if (kind === "REEL") {
      const r = await tx.reel.findUnique({ where: { id: targetId } });
      if (r && r.status !== "REMOVED") {
        const status = decision === "uphold" ? "REMOVED" : r.publishedAt ? "PUBLISHED" : "PENDING";
        await tx.reel.update({ where: { id: r.id }, data: { status, reviewNote: why, reviewedById: adminId } });
        if (decision === "uphold") await notify(tx, r.authorId, { kind: "reel", title: "Your reel was removed after a report", body: why, link: "/reels/mine" });
      }
    } else {
      const c = await tx.reelComment.findUnique({ where: { id: targetId } });
      if (c) {
        await tx.reelComment.update({ where: { id: c.id }, data: { status: decision === "uphold" ? "HIDDEN" : "VISIBLE" } });
        if (decision === "uphold") await notify(tx, c.userId, { kind: "reel", title: "Your comment was removed", body: why });
      }
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "social_report", entityId: targetId, action: `social.reports_${decision}`, detail: { kind, note: why } });
  });
}

// ---------- Reading ----------

export interface ReelCard {
  id: string; caption: string; city: string; publishedAt: Date | null; status: string; sizeBytes: number; mimeType: string;
  authorId: string; authorName: string; companyName: string; listingRef: string | null; listingTitle: string | null;
  likes: number; comments: number; shares: number; liked: boolean; saved: boolean; why: string[]; mine: boolean;
  /** The viewer follows the author. */
  following: boolean;
}

async function cards(reels: { id: string; authorId: string; listingId: string | null; caption: string; city: string; publishedAt: Date | null; status: string; sizeBytes: number; mimeType: string }[], viewerId: string | null, whyBy = new Map<string, string[]>()): Promise<ReelCard[]> {
  if (!reels.length) return [];
  const ids = reels.map((r) => r.id);
  const [likes, comments, shares, mine, authors, listings] = await Promise.all([
    withPublic((tx) => tx.reelLike.groupBy({ by: ["reelId"], where: { reelId: { in: ids } }, _count: true })),
    withPublic((tx) => tx.reelComment.groupBy({ by: ["reelId"], where: { reelId: { in: ids }, status: "VISIBLE" }, _count: true })),
    withPublic((tx) => tx.reelShare.groupBy({ by: ["reelId"], where: { reelId: { in: ids } }, _count: true })),
    viewerId ? withUser(viewerId, async (tx) => ({
      likes: await tx.reelLike.findMany({ where: { userId: viewerId, reelId: { in: ids } }, select: { reelId: true } }),
      saves: await tx.reelSave.findMany({ where: { userId: viewerId, reelId: { in: ids } }, select: { reelId: true } }),
      follows: await tx.follow.findMany({ where: { followerId: viewerId, targetKind: "AGENT", targetId: { in: [...new Set(reels.map((r) => r.authorId))] } }, select: { targetId: true } }),
    })) : Promise.resolve({ likes: [], saves: [], follows: [] as { targetId: string }[] }),
    withPublic((tx) => tx.agentProfile.findMany({ where: { userId: { in: [...new Set(reels.map((r) => r.authorId))] }, listed: true }, select: { userId: true, displayName: true, companyName: true } })),
    withPublic((tx) => tx.listing.findMany({ where: { id: { in: reels.map((r) => r.listingId).filter((x): x is string => !!x) }, status: "PUBLISHED" }, select: { id: true, publicRef: true, title: true } })),
  ]);
  const n = (rows: { reelId: string; _count: number }[], id: string) => rows.find((r) => r.reelId === id)?._count ?? 0;
  return reels.map((r) => {
    const a = authors.find((x) => x.userId === r.authorId), l = listings.find((x) => x.id === r.listingId);
    return {
      id: r.id, caption: r.caption, city: r.city, publishedAt: r.publishedAt, status: r.status, sizeBytes: r.sizeBytes, mimeType: r.mimeType,
      authorId: r.authorId, authorName: a?.displayName ?? "Agent", companyName: a?.companyName ?? "", listingRef: l?.publicRef ?? null, listingTitle: l?.title ?? null,
      likes: n(likes, r.id), comments: n(comments, r.id), shares: n(shares, r.id), liked: mine.likes.some((x) => x.reelId === r.id), saved: mine.saves.some((x) => x.reelId === r.id),
      why: whyBy.get(r.id) ?? [], mine: r.authorId === viewerId, following: mine.follows.some((f) => f.targetId === r.authorId),
    };
  });
}

async function viewerProfile(userId: string): Promise<Viewer & { any: boolean }> {
  const mine = await withUser(userId, async (tx) => ({
    follows: await tx.follow.findMany({ where: { followerId: userId }, select: { targetKind: true, targetId: true } }),
    liked: await tx.reelLike.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30, select: { reelId: true } }),
    saved: await tx.reelSave.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30, select: { reelId: true } }),
  }));
  const followedAuthors = new Set(mine.follows.filter((f) => f.targetKind === "AGENT").map((f) => f.targetId));
  const followedCompanies = new Set(mine.follows.filter((f) => f.targetKind !== "AGENT").map((f) => f.targetId));
  const touched = [...new Set([...mine.liked, ...mine.saved].map((x) => x.reelId))];
  const cities = new Set<string>();
  if (touched.length) for (const r of await withPublic((tx) => tx.reel.findMany({ where: { id: { in: touched }, status: "PUBLISHED" }, select: { city: true } }))) if (r.city) cities.add(r.city.toLowerCase());
  // What this person watches, likes and looks at elsewhere on the platform (their own signals) also shapes their reels.
  const t = await reelTaste(userId).catch(() => null);
  const watchedAuthors = new Set<string>();
  if (t) { for (const c of t.cities) if (c) cities.add(c); for (const a of t.authors) if (a && a !== userId && !followedAuthors.has(a)) watchedAuthors.add(a); }
  return { followedAuthors, followedCompanies, cities, watchedAuthors, any: followedAuthors.size + followedCompanies.size + cities.size + watchedAuthors.size > 0 };
}

/** What is engaging people, from the recorded engagement only. */
async function candidates(now: Date) {
  const since = new Date(now.getTime() - FEED_WINDOW_DAYS * 864e5);
  const reels = await withPublic((tx) => tx.reel.findMany({ where: { status: "PUBLISHED", publishedAt: { gte: since, lte: now } }, orderBy: { publishedAt: "desc" }, take: 300 }));
  const ids = reels.map((r) => r.id);
  // Saves are private, so they are not part of public reach; they only shape one person's own suggestions.
  const [likes, shares, comments] = await Promise.all([
    withPublic((tx) => tx.reelLike.findMany({ where: { reelId: { in: ids } } })),
    withPublic((tx) => tx.reelShare.findMany({ where: { reelId: { in: ids } } })),
    withPublic((tx) => tx.reelComment.findMany({ where: { reelId: { in: ids }, status: "VISIBLE" } })),
  ]);
  const userIds = [...new Set([...likes, ...shares, ...comments].map((x) => x.userId))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, createdAt: true } })).map((u) => [u.id, u.createdAt]));
  const feed: FeedReel[] = reels.map((r) => {
    const e: Engagement[] = [
      ...likes.filter((x) => x.reelId === r.id).map((x) => ({ kind: "like" as const, userId: x.userId, at: x.createdAt })),
      ...shares.filter((x) => x.reelId === r.id).map((x) => ({ kind: "share" as const, userId: x.userId, at: x.createdAt })),
      ...comments.filter((x) => x.reelId === r.id).map((x) => ({ kind: "comment" as const, userId: x.userId, at: x.createdAt })),
    ].map((x) => ({ ...x, userCreatedAt: users.get(x.userId) ?? x.at }));
    return { id: r.id, authorId: r.authorId, companyId: r.companyId, city: r.city, publishedAt: r.publishedAt!, engagement: countedEngagement(r.authorId, e).score };
  });
  return { reels, feed };
}

export async function discover(o: { viewerId?: string | null; tab?: Tab; page?: number; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const tab: Tab = o.tab ?? (o.viewerId ? "foryou" : "trending");
  const { reels, feed } = await candidates(now);
  const viewer = o.viewerId ? await viewerProfile(o.viewerId) : null;
  let pool = feed;
  if (tab === "following") pool = feed.filter((r) => viewer?.followedAuthors.has(r.authorId) || viewer?.followedCompanies.has(r.companyId));
  const ranked = rankFeed(pool, now, tab === "trending" ? null : viewer);
  const page = Math.max(0, o.page ?? 0);
  const slice = ranked.slice(page * FEED_PAGE, page * FEED_PAGE + FEED_PAGE);
  const rows = await cards(slice.map((s) => reels.find((r) => r.id === s.id)!), o.viewerId ?? null, new Map(slice.map((s) => [s.id, s.why])));
  return { tab, page, total: ranked.length, pages: Math.max(1, Math.ceil(ranked.length / FEED_PAGE)), rows, ranked };
}

export async function getReel(id: string, viewerId: string | null) {
  const r = viewerId ? await withUser(viewerId, (tx) => tx.reel.findUnique({ where: { id } })) : await withPublic((tx) => tx.reel.findUnique({ where: { id } }));
  if (!r) return null;
  return (await cards([r], viewerId))[0];
}

export async function myReels(userId: string) {
  const rows = await withUser(userId, (tx) => tx.reel.findMany({ where: { authorId: userId }, orderBy: { createdAt: "desc" }, take: 100 }));
  const c = await cards(rows, userId);
  return rows.map((r) => ({ ...c.find((x) => x.id === r.id)!, reviewNote: r.reviewNote, createdAt: r.createdAt }));
}

export async function mySaved(userId: string, page = 0) {
  const saves = await withUser(userId, (tx) => tx.reelSave.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }));
  const reels = await withPublic((tx) => tx.reel.findMany({ where: { id: { in: saves.map((s) => s.reelId) }, status: "PUBLISHED" } }));
  const ordered = saves.map((s) => reels.find((r) => r.id === s.reelId)).filter((r): r is NonNullable<typeof r> => !!r);
  const p = Math.max(0, page);
  return { page: p, total: ordered.length, pages: Math.max(1, Math.ceil(ordered.length / FEED_PAGE)), rows: await cards(ordered.slice(p * FEED_PAGE, p * FEED_PAGE + FEED_PAGE), userId) };
}

export async function reelsByAuthor(authorId: string, limit = 6) {
  const rows = await withPublic((tx) => tx.reel.findMany({ where: { authorId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: limit }));
  return cards(rows, null);
}

export async function commentsFor(reelId: string, page = 0) {
  const where = { reelId, status: "VISIBLE" as const };
  const [total, rows] = await Promise.all([withPublic((tx) => tx.reelComment.count({ where })), withPublic((tx) => tx.reelComment.findMany({ where, orderBy: { createdAt: "desc" }, skip: Math.max(0, page) * COMMENT_PAGE, take: COMMENT_PAGE }))]);
  return { total, page, pages: Math.max(1, Math.ceil(total / COMMENT_PAGE)), rows };
}

/** The clip itself. Anyone can get a published reel; an author can also see their own while it waits. */
export async function reelVideo(id: string, viewerId: string | null) {
  const out = async (tx: Tx) => {
    const reel = await tx.reel.findUnique({ where: { id } });
    const media = reel ? await tx.reelMedia.findUnique({ where: { reelId: id } }) : null;
    return reel && media ? { type: reel.mimeType, bytes: Buffer.from(media.bytes) } : null;
  };
  return viewerId ? withUser(viewerId, out) : withPublic(out);
}

// ---------- Interactions ----------

async function livereel(tx: Tx, id: string) {
  const r = await tx.reel.findUnique({ where: { id } });
  if (!r || r.status !== "PUBLISHED") throw new Error("This reel is not available");
  return r;
}
async function limited(key: string, n: number, hours = 1) {
  if (!(await rateLimit(key, n, hours * 3600_000))) throw new Error("You are doing that very quickly. Please wait a little and try again.");
}

export async function toggleLike(userId: string, reelId: string) {
  await limited(`reel-like:${userId}`, 120);
  return system(async (tx) => {
    const r = await livereel(tx, reelId);
    const had = await tx.reelLike.findUnique({ where: { reelId_userId: { reelId, userId } } });
    if (had) await tx.reelLike.delete({ where: { id: had.id } });
    else {
      await tx.reelLike.create({ data: { reelId, userId } });
      const n = await tx.reelLike.count({ where: { reelId } });
      if (r.authorId !== userId && isLikeMilestone(n)) await notify(tx, r.authorId, { kind: "reel", email: false, title: n === 1 ? "Someone liked your reel" : `Your reel has ${n} likes`, body: r.caption.slice(0, 120), link: `/reels/${r.id}` });
    }
    return { liked: !had, count: await tx.reelLike.count({ where: { reelId } }) };
  });
}

export async function toggleSave(userId: string, reelId: string) {
  await limited(`reel-save:${userId}`, 120);
  return system(async (tx) => {
    await livereel(tx, reelId);
    const had = await tx.reelSave.findUnique({ where: { reelId_userId: { reelId, userId } } });
    if (had) await tx.reelSave.delete({ where: { id: had.id } });
    else await tx.reelSave.create({ data: { reelId, userId } });
    return { saved: !had };
  });
}

/** A share counts once per person, however many times they press the button. */
export async function recordShare(userId: string, reelId: string) {
  await limited(`reel-share:${userId}`, 60);
  return system(async (tx) => {
    await livereel(tx, reelId);
    await tx.reelShare.upsert({ where: { reelId_userId: { reelId, userId } }, create: { reelId, userId }, update: {} });
    return { count: await tx.reelShare.count({ where: { reelId } }) };
  });
}

const commentSchema = z.string().trim().min(1, "Write a comment first").max(500, "Keep comments to 500 characters")
  .refine((v) => !/https?:\/\/|www\./i.test(v), "Links are not allowed in comments");

export async function addComment(userId: string, reelId: string, body: string) {
  const text = commentSchema.parse(body);
  await limited(`reel-comment:${userId}`, 10);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return system(async (tx) => {
    const r = await livereel(tx, reelId);
    if (await tx.reelComment.findFirst({ where: { reelId, userId, body: text } })) throw new Error("You already said that on this reel");
    const c = await tx.reelComment.create({ data: { reelId, userId, authorName: shortName(u.name), body: text } });
    if (r.authorId !== userId) await notify(tx, r.authorId, { kind: "reel", title: `${shortName(u.name)} commented on your reel`, body: text.slice(0, 120), link: `/reels/${r.id}` });
    return c;
  });
}

export async function reportTarget(userId: string, kind: "REEL" | "COMMENT", targetId: string, reason: string) {
  const why = z.string().trim().min(3, "Say briefly what is wrong").max(300).parse(reason);
  await limited(`reel-report:${userId}`, 20, 24);
  await system(async (tx) => {
    let reelId = targetId, owner: string;
    if (kind === "REEL") { const r = await livereel(tx, targetId); owner = r.authorId; }
    else {
      const c = await tx.reelComment.findUnique({ where: { id: targetId } });
      if (!c || c.status !== "VISIBLE") throw new Error("That comment is not available");
      await livereel(tx, c.reelId); reelId = c.reelId; owner = c.userId;
    }
    if (owner === userId) throw new Error("You cannot report your own post");
    if (await tx.socialReport.findUnique({ where: { targetKind_targetId_reporterId: { targetKind: kind, targetId, reporterId: userId } } })) throw new Error("You have already reported this");
    await tx.socialReport.create({ data: { targetKind: kind, targetId, reelId, reporterId: userId, reason: why } });
    // Several different people reporting the same thing hides it until the platform has looked.
    const distinct = (await tx.socialReport.findMany({ where: { targetKind: kind, targetId, status: "OPEN" }, select: { reporterId: true } })).length;
    if (kind === "REEL" && distinct >= REPORTS_TO_HIDE_REEL) await tx.reel.update({ where: { id: targetId }, data: { status: "HIDDEN", reviewNote: "Hidden while reports are checked" } });
    if (kind === "COMMENT" && distinct >= REPORTS_TO_HIDE_COMMENT) await tx.reelComment.update({ where: { id: targetId }, data: { status: "HIDDEN" } });
  });
}

/** The properties a listed agent can attach to a reel: their own company's published listings. */
export async function listingChoices(userId: string) {
  return system(async (tx) => {
    const p = await tx.agentProfile.findFirst({ where: { userId, listed: true }, orderBy: { createdAt: "asc" } });
    if (!p) return { listed: false as const, listings: [] };
    return { listed: true as const, listings: await tx.listing.findMany({ where: { companyId: p.companyId, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 100, select: { id: true, title: true, city: true } }) };
  });
}
