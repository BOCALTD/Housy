// Reels and social discovery: pure rules. Nothing here reads the database, so the same inputs always give the same order.
// Paid plans, promotions and Gold status are not inputs. Reach comes from real, independent people engaging.

export const REEL_MAX_BYTES = 4 * 1024 * 1024;
export const REEL_TYPES = ["video/mp4", "video/webm"] as const;
export const ENGAGER_MIN_AGE_HOURS = 24;     // an account must be a day old before its likes and comments move a reel
export const HALF_LIFE_HOURS = 72;           // a reel's reach halves every three days
export const FEED_WINDOW_DAYS = 60;
export const REPORTS_TO_HIDE_REEL = 3;
export const REPORTS_TO_HIDE_COMMENT = 2;
export const WEIGHTS = { like: 1, comment: 2, save: 2, share: 3 } as const;
export const FORMULA_VERSION = 1;

/** Check the first bytes of a clip against its declared type. */
export function sniffVideo(type: string, b: Uint8Array): boolean {
  if (type === "video/mp4") return b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // "ftyp"
  if (type === "video/webm") return b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return false;
}

export interface Engagement {
  kind: "like" | "comment" | "save" | "share";
  userId: string;
  userCreatedAt: Date;
  at: Date;
}

/** Only engagement from other people, from accounts old enough at the time, counts toward reach. One person counts once per kind. */
export function countedEngagement(authorId: string, items: Engagement[]) {
  const seen = new Set<string>();
  let score = 0, counted = 0;
  const by = { like: 0, comment: 0, save: 0, share: 0 };
  for (const e of items) {
    if (e.userId === authorId) continue;
    if (e.at.getTime() - e.userCreatedAt.getTime() < ENGAGER_MIN_AGE_HOURS * 3600_000) continue;
    const key = `${e.kind}:${e.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    score += WEIGHTS[e.kind]; counted++; by[e.kind]++;
  }
  return { score, counted, by };
}

export function decay(publishedAt: Date, now: Date): number {
  const hours = Math.max(0, (now.getTime() - publishedAt.getTime()) / 3600_000);
  return Math.pow(0.5, hours / HALF_LIFE_HOURS);
}

export interface FeedReel {
  id: string; authorId: string; companyId: string; city: string; publishedAt: Date;
  engagement: number;      // from countedEngagement
}
export interface Viewer { followedAuthors: Set<string>; followedCompanies: Set<string>; cities: Set<string> }

export interface Ranked { id: string; score: number; why: string[] }

/** Order reels for a person. With no viewer this is simply what is doing well; with one, people they follow and places they care about come first. */
export function rankFeed(reels: FeedReel[], now: Date, viewer?: Viewer | null): Ranked[] {
  return reels.map((r) => {
    const base = Math.log2(2 + r.engagement) * decay(r.publishedAt, now);
    const why: string[] = [];
    let score = base;
    if (viewer?.followedAuthors.has(r.authorId) || viewer?.followedCompanies.has(r.companyId)) { score += 5 * decay(r.publishedAt, now) + 1; why.push("You follow them"); }
    if (viewer && r.city && viewer.cities.has(r.city.toLowerCase())) { score += 1.5 * decay(r.publishedAt, now); why.push(`Near ${r.city}`); }
    if (!why.length && r.engagement > 0) why.push("Popular right now");
    return { id: r.id, score: Math.round(score * 1e9) / 1e9, why, t: r.publishedAt.getTime() };
  }).sort((a, b) => b.score - a.score || b.t - a.t || (a.id < b.id ? -1 : 1)).map(({ id, score, why }) => ({ id, score, why }));
}

/** How many likes make the author worth telling: the first one and then milestones, so a busy reel does not flood their notices. */
export const isLikeMilestone = (n: number) => n === 1 || n === 10 || n === 50 || (n >= 100 && n % 100 === 0);

/** Reels published in a month that count as posts for the Top Agent ranking. Capped so volume cannot buy a place. */
export const MONTHLY_REEL_CAP = 8;
