// Flatmate and roommate matching. Profiles are seen only by other signed-in people with an active profile; nobody can
// message until both have said they are interested; contact details are never on a profile; anyone can hide or report.
import { z } from "zod";
import { withPlatformAdmin, withPublic, withUser, type Tx } from "../db";
import { parseNaira } from "../portal-rules";
import {
  GUESTS, HOUSEHOLD, I_AM, MODES, PETS, SCHEDULE, SMOKING, TIDINESS, checkProfileInput, compatible, matchScore, rankMatches,
  type Profile,
} from "../flatmate-rules";
import { notify } from "./notifications";
import { openCase } from "./trust-cases";

const SYSTEM = "system";
/** Profiles not updated for this long drop out of other people's matches until their owner touches them again. */
export const STALE_DAYS = 120;

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  mode: z.enum(keys(MODES)),
  city: z.string().trim().min(2).max(80),
  areas: z.string().trim().max(300).default(""),
  budgetMin: z.string().default(""),
  budgetMax: z.string(),
  moveInFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose when you could move in"),
  stayMonths: z.string().default(""),
  smoking: z.enum(keys(SMOKING)),
  pets: z.enum(keys(PETS)),
  schedule: z.enum(keys(SCHEDULE)),
  tidiness: z.enum(keys(TIDINESS)),
  guests: z.enum(keys(GUESTS)),
  household: z.enum(keys(HOUSEHOLD)).default("ANY"),
  iAm: z.enum(keys(I_AM)).default("UNSAID"),
  occupation: z.string().trim().max(80).default(""),
  about: z.string().trim().max(800).default(""),
  roomListingRef: z.string().trim().max(40).default(""),
  adult: z.boolean(),
});

const toRule = (p: { userId: string; mode: string; city: string; areas: string; budgetMinKobo: bigint; budgetMaxKobo: bigint; moveInFrom: Date; smoking: string; pets: string; schedule: string; tidiness: string; guests: string; household: string; iAm: string }): Profile => p as Profile;

export async function myProfile(userId: string) {
  return withUser(userId, (tx) => tx.flatmateProfile.findUnique({ where: { userId } }));
}

export async function saveProfile(userId: string, input: z.input<typeof profileSchema>) {
  const d = profileSchema.parse(input);
  const budgetMaxKobo = parseNaira(d.budgetMax) ?? BigInt(0);
  const budgetMinKobo = parseNaira(d.budgetMin) ?? BigInt(0);
  const problems = checkProfileInput({ city: d.city, budgetMinKobo, budgetMaxKobo, about: d.about, displayName: d.displayName, adult: d.adult });
  if (problems.length) throw new Error(problems.join(". "));
  const stay = d.stayMonths ? Number.parseInt(d.stayMonths, 10) : null;
  if (stay !== null && (!Number.isInteger(stay) || stay < 1 || stay > 60)) throw new Error("Enter how many months you plan to stay (1 to 60), or leave it blank");
  let roomListingRef = "";
  if (d.mode === "HAS_ROOM" && d.roomListingRef) {
    const l = await withPublic((tx) => tx.listing.findFirst({ where: { publicRef: d.roomListingRef.toUpperCase(), status: "PUBLISHED" }, select: { publicRef: true } }));
    if (!l) throw new Error("That property reference is not a published listing. Leave it blank or check it");
    roomListingRef = l.publicRef;
  }
  const data = {
    displayName: d.displayName, mode: d.mode, city: d.city, areas: d.areas, budgetMinKobo, budgetMaxKobo, moveInFrom: new Date(`${d.moveInFrom}T00:00:00Z`), stayMonths: stay,
    smoking: d.smoking, pets: d.pets, schedule: d.schedule, tidiness: d.tidiness, guests: d.guests, household: d.household, iAm: d.iAm,
    occupation: d.occupation, about: d.about, roomListingRef,
  };
  await withUser(userId, (tx) => tx.flatmateProfile.upsert({
    where: { userId },
    create: { userId, ...data, status: "ACTIVE", adultConfirmedAt: new Date() },
    update: { ...data, adultConfirmedAt: new Date() },
  }));
}

export async function setPaused(userId: string, paused: boolean) {
  const r = await withUser(userId, (tx) => tx.flatmateProfile.updateMany({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: paused ? "PAUSED" : "ACTIVE" } }));
  if (r.count === 0) throw new Error("Create your flatmate profile first");
}

/** Remove the profile and everything about it: interests both ways and hides. */
export async function deleteProfile(userId: string) {
  await withPlatformAdmin(SYSTEM, async (tx) => {
    await tx.flatmateInterest.deleteMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } });
    await tx.flatmateProfile.deleteMany({ where: { userId } });
  });
  await withUser(userId, (tx) => tx.flatmateHide.deleteMany({ where: { userId } }));
}

/** People this person must never see: those they hid, those who hid them, and anyone blocked either way in messages. */
async function excluded(userId: string) {
  const [mine, theirs] = await Promise.all([
    withUser(userId, (tx) => tx.flatmateHide.findMany({ where: { userId }, select: { hiddenUserId: true } })),
    withPlatformAdmin(SYSTEM, async (tx) => ({
      hidMe: await tx.flatmateHide.findMany({ where: { hiddenUserId: userId }, select: { userId: true } }),
      blocks: await tx.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } }),
    })),
  ]);
  return new Set([...mine.map((h) => h.hiddenUserId), ...theirs.hidMe.map((h) => h.userId), ...theirs.blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))]);
}

const publicFields = { userId: true, displayName: true, mode: true, city: true, areas: true, budgetMinKobo: true, budgetMaxKobo: true, moveInFrom: true, stayMonths: true, smoking: true, pets: true, schedule: true, tidiness: true, guests: true, household: true, iAm: true, occupation: true, about: true, roomListingRef: true, updatedAt: true } as const;

async function interests(tx: Tx, userId: string) {
  const rows = await tx.flatmateInterest.findMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] }, select: { fromUserId: true, toUserId: true, createdAt: true } });
  const sent = new Set(rows.filter((r) => r.fromUserId === userId).map((r) => r.toUserId));
  const got = new Set(rows.filter((r) => r.toUserId === userId).map((r) => r.fromUserId));
  return { sent, got };
}

/** Suggested matches, people interested in you, and mutual matches. Only for someone with an active profile. */
export async function flatmateHome(userId: string, now = new Date()) {
  const me = await myProfile(userId);
  if (!me || me.status !== "ACTIVE") return { me, suggested: [], interestedInMe: [], mutual: [] };
  const hidden = await excluded(userId);
  const fresh = new Date(now.getTime() - STALE_DAYS * 864e5);
  const { others, sent, got } = await withUser(userId, async (tx) => {
    const others = await tx.flatmateProfile.findMany({ where: { status: "ACTIVE", userId: { not: userId }, city: { equals: me.city, mode: "insensitive" }, updatedAt: { gte: fresh } }, select: publicFields, take: 500, orderBy: { updatedAt: "desc" } });
    return { others, ...(await interests(tx, userId)) };
  });
  const ranked = rankMatches(toRule(me), others.map(toRule), hidden);
  const byId = new Map(others.map((o) => [o.userId, o]));
  const card = (m: { userId: string; score: number; reasons: string[]; cautions: string[] }) => ({ ...byId.get(m.userId)!, score: m.score, reasons: m.reasons, cautions: m.cautions, iSent: sent.has(m.userId), theySent: got.has(m.userId) });
  const all = ranked.map(card);
  return {
    me,
    mutual: all.filter((c) => c.iSent && c.theySent),
    interestedInMe: all.filter((c) => c.theySent && !c.iSent),
    suggested: all.filter((c) => !c.theySent),
  };
}

/** One person's profile, as seen by another member. Null if they cannot see it. */
export async function viewProfile(userId: string, otherId: string) {
  if (userId === otherId) return null;
  const me = await myProfile(userId);
  if (!me || me.status !== "ACTIVE") return null;
  if ((await excluded(userId)).has(otherId)) return null;
  return withUser(userId, async (tx) => {
    const p = await tx.flatmateProfile.findFirst({ where: { userId: otherId, status: "ACTIVE" }, select: publicFields });
    if (!p) return null;
    const { sent, got } = await interests(tx, userId);
    const ok = compatible(toRule(me), toRule(p));
    return { ...p, compatible: ok, ...(ok ? matchScore(toRule(me), toRule(p)) : { score: 0, reasons: [], cautions: ["You may not suit each other's households, budgets or cities"] }), iSent: sent.has(otherId), theySent: got.has(otherId) };
  });
}

/** Say you are interested. When it becomes mutual, both are told and can message each other. */
export async function sendInterest(userId: string, otherId: string) {
  const view = await viewProfile(userId, otherId);
  if (!view) throw new Error("This profile is not available");
  if (view.iSent) return { mutual: view.theySent };
  const me = (await myProfile(userId))!;
  await withUser(userId, async (tx) => {
    await tx.flatmateInterest.create({ data: { fromUserId: userId, toUserId: otherId } });
  });
  await withPlatformAdmin(SYSTEM, async (tx) => {
    if (view.theySent) {
      await notify(tx, otherId, { kind: "flatmate.match", title: `You and ${me.displayName} are a flatmate match`, body: "You can now message each other.", link: `/flatmates/${userId}` });
      await notify(tx, userId, { kind: "flatmate.match", title: `You and ${view.displayName} are a flatmate match`, body: "You can now message each other.", link: `/flatmates/${otherId}`, email: false });
    } else {
      await notify(tx, otherId, { kind: "flatmate.interest", title: `${me.displayName} is interested in sharing with you`, body: "Look at their profile and say if you are interested too.", link: `/flatmates/${userId}` });
    }
  });
  return { mutual: view.theySent };
}

export async function withdrawInterest(userId: string, otherId: string) {
  await withUser(userId, (tx) => tx.flatmateInterest.deleteMany({ where: { fromUserId: userId, toUserId: otherId } }));
}

/** Never see this person again, and take back any interest in them. */
export async function hidePerson(userId: string, otherId: string) {
  if (userId === otherId) throw new Error("You cannot hide yourself");
  await withUser(userId, async (tx) => {
    await tx.flatmateHide.upsert({ where: { userId_hiddenUserId: { userId, hiddenUserId: otherId } }, create: { userId, hiddenUserId: otherId }, update: {} });
    await tx.flatmateInterest.deleteMany({ where: { fromUserId: userId, toUserId: otherId } });
  });
}

export const REPORT_REASONS = { FRAUD: "Asking for money or a scam", IDENTITY: "Not who they say they are", HARASSMENT: "Harassment or abuse", OTHER: "Something else" } as const;

/** Report a profile to Trust and Safety. The person is also hidden from the reporter straight away. */
export async function reportPerson(userId: string, otherId: string, reason: keyof typeof REPORT_REASONS, details: string) {
  if (!(reason in REPORT_REASONS)) throw new Error("Choose a reason");
  const text = details.trim();
  if (text.length < 10) throw new Error("Tell us briefly what happened");
  const ref = await openCase(userId, { category: reason, targetKind: "USER", targetRef: otherId, description: `[Flatmate profile] ${text}`.slice(0, 2000) }, []);
  await hidePerson(userId, otherId);
  return ref;
}

/** Whether two people have both said they are interested (used by messaging). */
export async function mutualMatch(tx: Tx, a: string, b: string) {
  const rows = await tx.flatmateInterest.findMany({ where: { OR: [{ fromUserId: a, toUserId: b }, { fromUserId: b, toUserId: a }] }, select: { fromUserId: true } });
  return rows.length === 2;
}
