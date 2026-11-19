import { withPublic, withUser, type Tx } from "../db";
import { rateLimit } from "../ratelimit";
import { system } from "./rewards";

// Likes, dislikes and shares on properties, reels and promo banners. One reaction per person per item: like or dislike, and the same
// again clears it. A share records that the person shared it (the share sheet or link does the sending); taking it back removes it
// from the count and from their "Shared by you" list. Each button offers Undo, which simply puts back what was there before.

export type Kind = "LISTING" | "REEL" | "BANNER";
export type Value = "LIKE" | "DISLIKE" | null;
export type Summary = { likes: number; dislikes: number; shares: number; mine: Value; shared: boolean };

async function limited(key: string, n: number) {
  if (!(await rateLimit(key, n, 3600_000))) throw new Error("You are doing that very quickly. Please wait a little and try again.");
}

/** The item must be one the public can see. */
async function assertVisible(tx: Tx, kind: Kind, id: string) {
  const ok = kind === "LISTING" ? await tx.listing.findFirst({ where: { id, status: "PUBLISHED" }, select: { id: true } })
    : kind === "REEL" ? await tx.reel.findFirst({ where: { id, status: "PUBLISHED" }, select: { id: true } })
    : await tx.promoBanner.findFirst({ where: { id, active: true, deletedAt: null }, select: { id: true } });
  if (!ok) throw new Error(kind === "LISTING" ? "This property is no longer available" : kind === "REEL" ? "This reel is not available" : "This banner is no longer showing");
}

async function summaryIn(tx: Tx, kind: Kind, id: string, userId: string | null): Promise<Summary> {
  const [likes, dislikes, shares, mine, shared] = await Promise.all([
    kind === "REEL" ? tx.reelLike.count({ where: { reelId: id } }) : tx.contentReaction.count({ where: { kind, targetId: id, value: "LIKE" } }),
    tx.contentReaction.count({ where: { kind, targetId: id, value: "DISLIKE" } }),
    kind === "REEL" ? tx.reelShare.count({ where: { reelId: id } }) : tx.contentShare.count({ where: { kind, targetId: id } }),
    userId ? (kind === "REEL"
      ? Promise.all([tx.reelLike.findUnique({ where: { reelId_userId: { reelId: id, userId } } }), tx.contentReaction.findUnique({ where: { kind_targetId_userId: { kind, targetId: id, userId } } })]).then(([l, d]) => (l ? "LIKE" : d?.value === "DISLIKE" ? "DISLIKE" : null) as Value)
      : tx.contentReaction.findUnique({ where: { kind_targetId_userId: { kind, targetId: id, userId } } }).then((r) => (r?.value ?? null) as Value)) : Promise.resolve(null as Value),
    userId ? (kind === "REEL" ? tx.reelShare.findUnique({ where: { reelId_userId: { reelId: id, userId } } }) : tx.contentShare.findUnique({ where: { kind_targetId_userId: { kind, targetId: id, userId } } })).then((r) => !!r) : Promise.resolve(false),
  ]);
  return { likes, dislikes, shares, mine, shared };
}

/** Set your reaction: like, dislike, or none. Returns the counts afterwards. */
export async function setReaction(userId: string, kind: Kind, id: string, value: Value): Promise<Summary> {
  await limited(`react:${userId}`, 300);
  return system(async (tx) => {
    await assertVisible(tx, kind, id);
    if (kind === "REEL") {
      // Reel likes live with reels (they drive the author's milestones); dislikes live here.
      if (value === "LIKE") await tx.reelLike.upsert({ where: { reelId_userId: { reelId: id, userId } }, create: { reelId: id, userId }, update: {} });
      else await tx.reelLike.deleteMany({ where: { reelId: id, userId } });
      if (value === "DISLIKE") await tx.contentReaction.upsert({ where: { kind_targetId_userId: { kind, targetId: id, userId } }, create: { kind, targetId: id, userId, value }, update: { value } });
      else await tx.contentReaction.deleteMany({ where: { kind, targetId: id, userId } });
    } else if (value) {
      await tx.contentReaction.upsert({ where: { kind_targetId_userId: { kind, targetId: id, userId } }, create: { kind, targetId: id, userId, value }, update: { value, createdAt: new Date() } });
    } else {
      await tx.contentReaction.deleteMany({ where: { kind, targetId: id, userId } });
    }
    return summaryIn(tx, kind, id, userId);
  });
}

/** Share, or take your share back. */
export async function setShared(userId: string, kind: Kind, id: string, on: boolean): Promise<Summary> {
  await limited(`share:${userId}`, 120);
  return system(async (tx) => {
    if (on) await assertVisible(tx, kind, id);
    if (kind === "REEL") {
      if (on) await tx.reelShare.upsert({ where: { reelId_userId: { reelId: id, userId } }, create: { reelId: id, userId }, update: {} });
      else await tx.reelShare.deleteMany({ where: { reelId: id, userId } });
    } else if (on) {
      await tx.contentShare.upsert({ where: { kind_targetId_userId: { kind, targetId: id, userId } }, create: { kind, targetId: id, userId }, update: {} });
    } else {
      await tx.contentShare.deleteMany({ where: { kind, targetId: id, userId } });
    }
    return summaryIn(tx, kind, id, userId);
  });
}

/** Counts and your own state for one item. */
export async function reactionSummary(kind: Kind, id: string, userId: string | null): Promise<Summary> {
  return userId ? withUser(userId, (tx) => summaryIn(tx, kind, id, userId)) : withPublic((tx) => summaryIn(tx, kind, id, null));
}

/** Counts for many items at once (cards), with the viewer's own reactions. */
export async function reactionSummaries(kind: Exclude<Kind, "REEL">, ids: string[], userId: string | null): Promise<Map<string, Summary>> {
  const out = new Map<string, Summary>();
  if (!ids.length) return out;
  const [reacts, shares, mine, myShares] = await Promise.all([
    withPublic((tx) => tx.contentReaction.groupBy({ by: ["targetId", "value"], where: { kind, targetId: { in: ids } }, _count: { _all: true } })),
    withPublic((tx) => tx.contentShare.groupBy({ by: ["targetId"], where: { kind, targetId: { in: ids } }, _count: { _all: true } })),
    userId ? withUser(userId, (tx) => tx.contentReaction.findMany({ where: { kind, targetId: { in: ids }, userId }, select: { targetId: true, value: true } })) : Promise.resolve([]),
    userId ? withUser(userId, (tx) => tx.contentShare.findMany({ where: { kind, targetId: { in: ids }, userId }, select: { targetId: true } })) : Promise.resolve([]),
  ]);
  for (const id of ids) {
    out.set(id, {
      likes: reacts.find((r) => r.targetId === id && r.value === "LIKE")?._count._all ?? 0,
      dislikes: reacts.find((r) => r.targetId === id && r.value === "DISLIKE")?._count._all ?? 0,
      shares: shares.find((r) => r.targetId === id)?._count._all ?? 0,
      mine: (mine.find((m) => m.targetId === id)?.value ?? null) as Value,
      shared: myShares.some((m) => m.targetId === id),
    });
  }
  return out;
}

/** What the person shared (properties and banners), newest first. */
export async function mySharedListings(userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx.contentShare.findMany({ where: { userId, kind: "LISTING" }, orderBy: { createdAt: "desc" }, take: 60, select: { targetId: true, createdAt: true } });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.targetId) }, status: "PUBLISHED" }, select: { id: true, publicRef: true, title: true, city: true, state: true } });
    return rows.map((r) => ({ ...r, listing: listings.find((l) => l.id === r.targetId) ?? null })).filter((r) => r.listing);
  });
}
