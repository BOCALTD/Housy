// Flatmate and roommate matching (master prompt module 18).
//
// Profiles are private to people who have an active profile themselves. Two people are matched only when both agree:
// one sends a request, the other accepts. On a match they are taken into a chat room together (a private conversation with
// the usual blocking, reporting and contact-detail rules). A room member can add other people they are matched with, up to six.
import { z } from "zod";
import { withPlatformAdmin, withUser, type Tx } from "../db";
import { parseDateOnly, todayInLagos } from "../dates";
import { parseNaira } from "../portal-rules";
import { rateLimit } from "../ratelimit";
import { hasContactDetails } from "../subscription-rules";
import {
  AGE_BANDS, FACTORS, GENDER_PREFS, GENDERS, INTENTS, MUST_KEYS, MUST_MAX, ROOM_MAX, checkAnswers, excluded, match, publicName,
  type AgeBand, type Answers, type Gender, type GenderPref, type Intent, type Profile,
} from "../flatmate-rules";
import { notify } from "./notifications";
import { sendMessage } from "./messaging";
import { asPerson } from "./collab";

type Row = {
  userId: string; status: string; displayName: string; intent: string; country: string; city: string; areas: string;
  budgetMinKobo: bigint; budgetMaxKobo: bigint; moveInFrom: Date; stayMonths: number | null; ageBand: string; agePref: string;
  gender: string; genderPref: string; showGender: boolean; answers: unknown; mustMatch: string; occupation: string; about: string;
  roomListingRef: string; updatedAt: Date;
};

const asProfile = (r: Row): Profile => ({
  userId: r.userId, intent: r.intent as Intent, country: r.country, city: r.city, budgetMinKobo: r.budgetMinKobo, budgetMaxKobo: r.budgetMaxKobo,
  moveIn: r.moveInFrom, ageBand: r.ageBand as AgeBand, agePref: r.agePref === "SIMILAR" ? "SIMILAR" : "ANY", gender: r.gender as Gender,
  genderPref: r.genderPref as GenderPref, answers: (r.answers ?? {}) as Answers, must: r.mustMatch ? r.mustMatch.split(",").filter(Boolean) : [],
});

/** What other people may see of a profile. Gender only if the person chose to show it; the household-inclusiveness answer never. */
function publicView(r: Row) {
  const answers = (r.answers ?? {}) as Answers;
  return {
    userId: r.userId, displayName: r.displayName, intent: r.intent as Intent, city: r.city, areas: r.areas, country: r.country,
    budgetMinKobo: r.budgetMinKobo, budgetMaxKobo: r.budgetMaxKobo, moveInFrom: r.moveInFrom, stayMonths: r.stayMonths,
    ageBand: r.ageBand as AgeBand, gender: r.showGender && r.gender !== "UNSAID" ? (r.gender as Gender) : null, occupation: r.occupation, about: r.about,
    roomListingRef: r.roomListingRef, updatedAt: r.updatedAt,
    lifestyle: FACTORS.filter((f) => f.shown).map((f) => ({ key: f.key, question: f.question, answer: f.options.find((o) => o.code === answers[f.key])?.label ?? "" })).filter((x) => x.answer),
  };
}

// ---------- My profile ----------

const enumOf = <T extends Record<string, string>>(m: T) => z.string().refine((v): v is Extract<keyof T, string> => v in m, "Choose an option");

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the name to show (a first name is enough)").max(40),
  intent: enumOf(INTENTS),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose a country"),
  city: z.string().trim().min(2, "Enter the city").max(80),
  areas: z.string().trim().max(300).default(""),
  budgetMin: z.string(),
  budgetMax: z.string(),
  moveInFrom: z.string().min(1, "Choose when you can move in"),
  stayMonths: z.string().default(""),
  ageBand: enumOf(AGE_BANDS),
  agePref: z.enum(["ANY", "SIMILAR"]).default("ANY"),
  gender: enumOf(GENDERS).default("UNSAID"),
  genderPref: enumOf(GENDER_PREFS).default("ANY"),
  showGender: z.boolean().default(false),
  answers: z.record(z.string()),
  must: z.array(z.string()).default([]),
  occupation: z.string().trim().max(80).default(""),
  about: z.string().trim().max(800, "Keep the description under 800 characters").default(""),
  roomListingRef: z.string().trim().max(40).default(""),
  adult: z.boolean(),
});

export async function myFlatmateProfile(userId: string) {
  return withUser(userId, (tx) => tx.flatmateProfile.findUnique({ where: { userId } }));
}

export async function saveFlatmateProfile(userId: string, input: z.input<typeof profileSchema>) {
  if (!input.adult) throw new Error("Flatmate matching is for adults (18 or over)");
  const d = profileSchema.parse(input);
  const problems = checkAnswers(d.answers, d.must);
  if (problems.length) throw new Error(problems.slice(0, 3).join(". "));
  if (d.genderPref === "SAME" && d.gender === "UNSAID") throw new Error("To share only with your own gender, say which gender you are");
  const min = parseNaira(d.budgetMin) ?? 0n, max = parseNaira(d.budgetMax);
  if (max === null || max <= 0n) throw new Error("Enter the most you can pay a month");
  if (min > max) throw new Error("The lowest budget must not be more than the highest");
  const moveIn = parseDateOnly(d.moveInFrom);
  if (moveIn.getTime() < todayInLagos().getTime() - 30 * 864e5) throw new Error("Choose a move-in date that has not long passed");
  const stay = d.stayMonths ? Number.parseInt(d.stayMonths, 10) : null;
  if (stay !== null && (!Number.isInteger(stay) || stay < 1 || stay > 60)) throw new Error("Stay length is 1 to 60 months");
  // Contact details are shared in the chat room after a match, never on the profile.
  for (const t of [d.about, d.occupation, d.areas, d.displayName]) if (hasContactDetails(t) || /https?:\/\//i.test(t)) throw new Error("Leave phone numbers, emails and links out of your profile. You can share them in the chat room once you match.");
  const answers = Object.fromEntries(FACTORS.map((f) => [f.key, d.answers[f.key]]));
  const data = {
    displayName: d.displayName, intent: d.intent, country: d.country, city: d.city, areas: d.areas, budgetMinKobo: min, budgetMaxKobo: max,
    moveInFrom: moveIn, stayMonths: stay, ageBand: d.ageBand, agePref: d.agePref, gender: d.gender, genderPref: d.genderPref, showGender: d.showGender,
    answers, mustMatch: [...new Set(d.must)].filter((m) => MUST_KEYS.includes(m)).slice(0, MUST_MAX).join(","), occupation: d.occupation, about: d.about,
    roomListingRef: /^PROP-[A-Z0-9]+$/.test(d.roomListingRef) ? d.roomListingRef : "",
  };
  await withUser(userId, async (tx) => {
    const existing = await tx.flatmateProfile.findUnique({ where: { userId } });
    if (existing?.status === "SUSPENDED") throw new Error("Your flatmate profile has been suspended. Contact support.");
    await tx.flatmateProfile.upsert({ where: { userId }, create: { userId, ...data, status: "ACTIVE", adultConfirmedAt: new Date() }, update: data });
  });
}

export async function setFlatmateStatus(userId: string, status: "ACTIVE" | "PAUSED") {
  await withUser(userId, async (tx) => {
    const p = await tx.flatmateProfile.findUnique({ where: { userId } });
    if (!p) throw new Error("Make a profile first");
    if (p.status === "SUSPENDED") throw new Error("Your flatmate profile has been suspended. Contact support.");
    await tx.flatmateProfile.update({ where: { userId }, data: { status } });
  });
}

/** Delete the profile, withdraw waiting requests, and leave nothing searchable. Chat rooms stay with their history. */
export async function deleteFlatmateProfile(userId: string) {
  await withUser(userId, async (tx) => {
    await tx.flatmateRequest.updateMany({ where: { fromUserId: userId, status: "PENDING" }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
    await tx.flatmateRequest.updateMany({ where: { toUserId: userId, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
    await tx.flatmateProfile.deleteMany({ where: { userId } });
  });
}

// ---------- Matches ----------

const PAGE = 20;

async function blockedIds(tx: Tx, userId: string): Promise<Set<string>> {
  const mine = await tx.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  const hides = await tx.flatmateHide.findMany({ where: { userId }, select: { hiddenUserId: true } });
  return new Set([...mine.map((b) => b.blockedId), ...hides.map((h) => h.hiddenUserId)]);
}

/** People who could share with me, best match first. */
export async function myMatches(userId: string, opts: { minScore?: number; page?: number } = {}) {
  return withUser(userId, async (tx) => {
    const me = await tx.flatmateProfile.findUnique({ where: { userId } });
    if (!me || me.status !== "ACTIVE") return { me, rows: [], total: 0, pages: 1 };
    const others = await tx.flatmateProfile.findMany({
      where: { status: "ACTIVE", country: me.country, city: { equals: me.city, mode: "insensitive" }, userId: { not: userId } },
      orderBy: { updatedAt: "desc" }, take: 1000,
    });
    const skip = await blockedIds(tx, userId);
    // Someone who blocked me must not see me either; the block check is symmetric.
    const blockedMe = await tx.$queryRaw<{ id: string }[]>`SELECT u AS id FROM unnest(${others.map((o) => o.userId)}::text[]) u WHERE msg_blocked(${userId}, u)`;
    for (const b of blockedMe) skip.add(b.id);
    const requests = await tx.flatmateRequest.findMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } });
    const mine = asProfile(me);
    const scored = others
      .filter((o) => !skip.has(o.userId) && !excluded(mine, asProfile(o)))
      .map((o) => {
        const r = requests.find((q) => (q.fromUserId === userId && q.toUserId === o.userId) || (q.toUserId === userId && q.fromUserId === o.userId));
        return { profile: publicView(o), match: match(mine, asProfile(o)), request: r ? { id: r.id, status: r.status, mine: r.fromUserId === userId, roomId: r.roomId } : null };
      })
      .filter((x) => x.match.score >= (opts.minScore ?? 0))
      .sort((a, b) => b.match.score - a.match.score);
    const page = Math.max(1, opts.page ?? 1);
    return { me, rows: scored.slice((page - 1) * PAGE, page * PAGE), total: scored.length, pages: Math.max(1, Math.ceil(scored.length / PAGE)) };
  });
}

/** One person's profile, with how they match me. Null when I may not see them. */
export async function flatmateView(userId: string, otherUserId: string) {
  return withUser(userId, async (tx) => {
    const me = await tx.flatmateProfile.findUnique({ where: { userId } });
    const other = await tx.flatmateProfile.findUnique({ where: { userId: otherUserId } });
    if (!me || me.status !== "ACTIVE" || !other || other.userId === userId) return null;
    if ((await blockedIds(tx, userId)).has(otherUserId)) return null;
    const blocked = await tx.$queryRaw<{ b: boolean }[]>`SELECT msg_blocked(${userId}, ${otherUserId}) AS b`;
    if (blocked[0]?.b) return null;
    const why = excluded(asProfile(me), asProfile(other));
    if (why) return null;
    const r = await tx.flatmateRequest.findFirst({ where: { OR: [{ fromUserId: userId, toUserId: otherUserId }, { fromUserId: otherUserId, toUserId: userId }] } });
    return { profile: publicView(other), match: match(asProfile(me), asProfile(other)), request: r ? { id: r.id, status: r.status, mine: r.fromUserId === userId, roomId: r.roomId, note: r.note } : null };
  });
}

// ---------- Requests and matching ----------

const noteSchema = z.string().trim().max(300, "Keep the note under 300 characters").default("");

/** Ask to match. If they already asked me, this is a match at once. */
export async function sendFlatmateRequest(userId: string, toUserId: string, noteRaw: string) {
  const note = noteSchema.parse(noteRaw);
  if (hasContactDetails(note)) throw new Error("Leave phone numbers and emails out of the note. Share them in the chat room once you match.");
  const view = await flatmateView(userId, toUserId);
  if (!view) throw new Error("This profile is not available");
  if (!(await rateLimit(`flatmate-req:${userId}`, 20, 864e5))) throw new Error("You can send 20 requests a day. Wait for some replies first.");
  if (view.request && !view.request.mine && view.request.status === "PENDING") return acceptFlatmateRequest(userId, view.request.id);
  if (view.request && ["PENDING", "ACCEPTED"].includes(view.request.status)) throw new Error(view.request.status === "ACCEPTED" ? "You are already matched" : "Your request is waiting for an answer");
  const me = await withUser(userId, async (tx) => {
    const mine = await tx.flatmateProfile.findUniqueOrThrow({ where: { userId } });
    // A declined or withdrawn request can be sent again, once.
    await tx.flatmateRequest.deleteMany({ where: { fromUserId: userId, toUserId, status: { in: ["WITHDRAWN"] } } });
    const prior = await tx.flatmateRequest.findUnique({ where: { fromUserId_toUserId: { fromUserId: userId, toUserId } } });
    if (prior) throw new Error(prior.status === "DECLINED" ? "They did not take up your request" : prior.status === "ENDED" ? "This match was ended" : "You have already asked");
    await tx.flatmateRequest.create({ data: { fromUserId: userId, toUserId, score: view.match.score, note } });
    await notify(tx, toUserId, { kind: "flatmate.request", title: `${mine.displayName} would like to match as flatmates (${view.match.score}%)`, body: note || view.match.band.label, link: `/flatmates/p/${userId}` });
    return mine;
  });
  return { matched: false, name: me.displayName };
}

/** Accept: the two are matched and taken into a new chat room together. */
export async function acceptFlatmateRequest(userId: string, requestId: string) {
  const r = await withUser(userId, (tx) => tx.flatmateRequest.findFirst({ where: { id: requestId, toUserId: userId, status: "PENDING" } }));
  if (!r) throw new Error("This request is no longer waiting");
  const view = await flatmateView(userId, r.fromUserId);
  if (!view) throw new Error("This profile is no longer available");
  const roomId = await withUser(userId, async (tx) => {
    const done = await tx.flatmateRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "ACCEPTED", decidedAt: new Date() } });
    if (done.count === 0) throw new Error("This request is no longer waiting");
    const mine = await tx.flatmateProfile.findUniqueOrThrow({ where: { userId } });
    const theirs = await tx.flatmateProfile.findUniqueOrThrow({ where: { userId: r.fromUserId } });
    const c = await tx.conversation.create({ data: { createdById: userId, subject: `Flatmates: ${theirs.displayName} and ${mine.displayName}` } });
    await tx.conversationMember.createMany({ data: [{ conversationId: c.id, userId, name: mine.displayName }, { conversationId: c.id, userId: r.fromUserId, name: theirs.displayName }] });
    const room = await tx.flatmateRoom.create({ data: { conversationId: c.id, createdById: userId } });
    await tx.flatmateRequest.update({ where: { id: r.id }, data: { roomId: room.id } });
    await notify(tx, r.fromUserId, { kind: "flatmate.match", title: `You matched with ${mine.displayName} (${view.match.score}%, ${view.match.band.label})`, body: "Your chat room is open.", link: `/messages/${c.id}` });
    return c.id;
  });
  await sendMessage(asPerson(userId), roomId, `We matched as flatmates: ${view.match.score}%, ${view.match.band.label}. Say hello! Tip: meet somewhere public first, and never pay money before you have seen the room and met the landlord or agent.`);
  return { matched: true, conversationId: roomId };
}

export async function declineFlatmateRequest(userId: string, requestId: string) {
  await withUser(userId, async (tx) => {
    const n = await tx.flatmateRequest.updateMany({ where: { id: requestId, toUserId: userId, status: "PENDING" }, data: { status: "DECLINED", decidedAt: new Date() } });
    if (n.count === 0) throw new Error("This request is no longer waiting");
  });
}

export async function withdrawFlatmateRequest(userId: string, requestId: string) {
  await withUser(userId, async (tx) => {
    const n = await tx.flatmateRequest.updateMany({ where: { id: requestId, fromUserId: userId, status: "PENDING" }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
    if (n.count === 0) throw new Error("This request is no longer waiting");
  });
}

/** End a match: neither can add the other to a room again, and the person ending it leaves the rooms they share. */
export async function endFlatmateMatch(userId: string, requestId: string) {
  const r = await withUser(userId, (tx) => tx.flatmateRequest.findFirst({ where: { id: requestId, status: "ACCEPTED", OR: [{ fromUserId: userId }, { toUserId: userId }] } }));
  if (!r) throw new Error("Match not found");
  const other = r.fromUserId === userId ? r.toUserId : r.fromUserId;
  await withUser(userId, (tx) => tx.flatmateRequest.update({ where: { id: r.id }, data: { status: "ENDED", decidedAt: new Date() } }));
  for (const room of await myRooms(userId)) if (room.members.some((m) => m.userId === other)) await leaveFlatmateRoom(userId, room.id);
}

export async function hideFlatmate(userId: string, otherUserId: string) {
  if (otherUserId === userId) return;
  await withUser(userId, (tx) => tx.flatmateHide.upsert({ where: { userId_hiddenUserId: { userId, hiddenUserId: otherUserId } }, create: { userId, hiddenUserId: otherUserId }, update: {} }));
}

// ---------- Requests, matches and rooms for one person ----------

export async function myFlatmateActivity(userId: string) {
  return withUser(userId, async (tx) => {
    const reqs = await tx.flatmateRequest.findMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] }, orderBy: { createdAt: "desc" }, take: 200 });
    const ids = [...new Set(reqs.map((r) => (r.fromUserId === userId ? r.toUserId : r.fromUserId)))];
    // Names come from the other person's profile when I can still see it, otherwise from the conversation.
    const profiles = await tx.flatmateProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true, city: true } });
    const name = (id: string) => profiles.find((p) => p.userId === id)?.displayName ?? "A former member";
    const rooms = await tx.flatmateRoom.findMany({ where: { id: { in: reqs.map((r) => r.roomId).filter((x): x is string => !!x) } }, select: { id: true, conversationId: true, status: true } });
    const view = (r: (typeof reqs)[number]) => {
      const other = r.fromUserId === userId ? r.toUserId : r.fromUserId;
      const room = rooms.find((x) => x.id === r.roomId) ?? null;
      return { id: r.id, other, name: name(other), score: r.score, note: r.note, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt, conversationId: room?.status === "OPEN" ? room.conversationId : null };
    };
    return {
      incoming: reqs.filter((r) => r.toUserId === userId && r.status === "PENDING").map(view),
      outgoing: reqs.filter((r) => r.fromUserId === userId && r.status === "PENDING").map(view),
      matches: reqs.filter((r) => r.status === "ACCEPTED").map(view),
    };
  });
}

export async function myRooms(userId: string) {
  return withUser(userId, async (tx) => {
    const memberships = await tx.conversationMember.findMany({ where: { userId, conversation: { flatmateRoom: { isNot: null } } }, select: { conversationId: true } });
    const rooms = await tx.flatmateRoom.findMany({ where: { conversationId: { in: memberships.map((m) => m.conversationId) }, status: "OPEN" }, orderBy: { createdAt: "desc" } });
    const members = await tx.conversationMember.findMany({ where: { conversationId: { in: rooms.map((r) => r.conversationId) } }, select: { conversationId: true, userId: true, name: true } });
    return rooms.map((r) => ({ id: r.id, conversationId: r.conversationId, createdAt: r.createdAt, members: members.filter((m) => m.conversationId === r.conversationId) }));
  });
}

/** Add someone I am matched with to a room I am in. The database checks the match and that the room is open. */
export async function addToFlatmateRoom(userId: string, roomId: string, otherUserId: string) {
  const conversationId = await withUser(userId, async (tx) => {
    const room = await tx.flatmateRoom.findFirst({ where: { id: roomId, status: "OPEN" } });
    if (!room) throw new Error("Chat room not found");
    const members = await tx.conversationMember.findMany({ where: { conversationId: room.conversationId } });
    if (!members.some((m) => m.userId === userId)) throw new Error("Chat room not found");
    if (members.some((m) => m.userId === otherUserId)) throw new Error("They are already in this room");
    if (members.length >= ROOM_MAX) throw new Error(`A chat room holds up to ${ROOM_MAX} people`);
    const matched = await tx.flatmateRequest.findFirst({ where: { status: "ACCEPTED", OR: [{ fromUserId: userId, toUserId: otherUserId }, { fromUserId: otherUserId, toUserId: userId }] } });
    if (!matched) throw new Error("You can add only people you have matched with");
    const blocked = await tx.$queryRaw<{ b: boolean }[]>`SELECT bool_or(msg_blocked(${otherUserId}, m)) AS b FROM unnest(${members.map((m) => m.userId)}::text[]) m`;
    if (blocked[0]?.b) throw new Error("They cannot join this room");
    const theirs = await tx.flatmateProfile.findUnique({ where: { userId: otherUserId }, select: { displayName: true } });
    await tx.conversationMember.create({ data: { conversationId: room.conversationId, userId: otherUserId, name: theirs?.displayName ?? "Flatmate" } });
    await notify(tx, otherUserId, { kind: "flatmate.room", title: "You were added to a flatmate chat room", body: `${members.length + 1} people are looking for a place together.`, link: `/messages/${room.conversationId}` });
    return room.conversationId;
  });
  const me = await myFlatmateProfile(userId);
  const them = await withUser(userId, (tx) => tx.flatmateProfile.findUnique({ where: { userId: otherUserId }, select: { displayName: true } }));
  await sendMessage(asPerson(userId), conversationId, `${me?.displayName ?? "A member"} added ${them?.displayName ?? "a matched flatmate"} to the room.`);
}

/** Leave a room. A room with fewer than two people left is closed. */
export async function leaveFlatmateRoom(userId: string, roomId: string) {
  const r = await withUser(userId, async (tx) => {
    const room = await tx.flatmateRoom.findFirst({ where: { id: roomId } });
    if (!room) throw new Error("Chat room not found");
    const left = await tx.conversationMember.findMany({ where: { conversationId: room.conversationId }, select: { userId: true } });
    if (left.length <= 2) await tx.flatmateRoom.update({ where: { id: room.id }, data: { status: "CLOSED" } });
    await tx.conversationMember.deleteMany({ where: { conversationId: room.conversationId, userId } });
    return { room, remaining: left.filter((m) => m.userId !== userId).map((m) => m.userId) };
  });
  if (r.remaining.length) {
    await withPlatformAdmin("system", async (tx) => {
      for (const u of r.remaining) await notify(tx, u, { kind: "flatmate.room", title: "Someone left your flatmate chat room", body: r.remaining.length < 2 ? "The room is now closed." : "", link: `/messages/${r.room.conversationId}`, email: false });
    });
  }
}

/** For the messages screen: whether a conversation is a flatmate room, and the room's state. */
export async function roomForConversation(userId: string, conversationId: string) {
  return withUser(userId, (tx) => tx.flatmateRoom.findUnique({ where: { conversationId }, select: { id: true, status: true } }));
}

/** For the menu badge: requests waiting for this person's answer. */
export async function waitingFlatmateRequests(userId: string) {
  return withUser(userId, (tx) => tx.flatmateRequest.count({ where: { toUserId: userId, status: "PENDING" } }));
}
