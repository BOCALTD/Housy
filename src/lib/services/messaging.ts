import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, withPlatformAdmin, withTenant, withUser, type Tx } from "../db";
import { parseDateOnly, todayInLagos, formatDate } from "../dates";
import { maskContactDetails, hasContactDetails } from "../subscription-rules";
import { participantActive } from "../collab-rules";
import { readSettings } from "./platform-settings";
import { entitlementIn } from "./subscriptions";
import { notify } from "./notifications";
import type { Actor } from "./collab";

// Secure internal messaging. A conversation is private to its members; nobody is given a phone number or email through it unless
// the sender's plan includes contact details. The platform administrator reads a message only after someone reports it.

const run = <T>(a: Actor, fn: (tx: Tx) => Promise<T>) => (a.companyId ? withTenant(a.companyId, a.userId, fn) : withUser(a.userId, fn));
const BLOCKED = "You cannot message this person.";
const bodySchema = z.string().trim().max(4000, "Keep the message under 4,000 characters");

async function nameOf(tx: Tx, id: string) {
  return (await tx.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "Someone";
}

async function mayShareContacts(tx: Tx, a: Actor): Promise<boolean> {
  const user = await entitlementIn(tx, { kind: "USER", userId: a.userId }, "CONTACT_DETAILS");
  if (user.access === "FULL") return true;
  if (!a.companyId) return false;
  return (await entitlementIn(tx, { kind: "COMPANY", companyId: a.companyId }, "CONTACT_DETAILS")).access === "FULL";
}

/** Apply the platform's contact-detail policy to text this person is about to send. */
async function screen(tx: Tx, a: Actor, text: string): Promise<{ text: string; masked: boolean }> {
  if (!text || !hasContactDetails(text) || (await mayShareContacts(tx, a))) return { text, masked: false };
  const { contactPolicy } = await readSettings();
  if (contactPolicy === "BLOCK") throw new Error("Phone numbers and email addresses cannot be sent on your plan. Remove them, or ask the platform about a plan that includes contact details.");
  return { text: maskContactDetails(text), masked: true };
}

async function assertMayPost(tx: Tx, a: Actor) {
  const r = await tx.messagingRestriction.findFirst({ where: { userId: a.userId, liftedAt: null } });
  if (r) throw new Error(`Your messaging is paused: ${r.reason}`);
  const { messagesPerMinute } = await readSettings();
  const recent = await tx.message.count({ where: { senderId: a.userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (recent >= messagesPerMinute) throw new Error("You are sending messages too quickly. Wait a minute and try again.");
}

async function blockedBetween(tx: Tx, me: string, other: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ b: boolean }[]>`SELECT msg_blocked(${me}, ${other}) AS b`;
  return rows[0]?.b === true;
}

async function membersOf(tx: Tx, conversationId: string) {
  return tx.conversationMember.findMany({ where: { conversationId } });
}

interface Post { kind: "TEXT" | "PROPERTY" | "INSPECTION_REQUEST" | "INSPECTION_REPLY"; body: string; details?: Prisma.InputJsonValue; replyToId?: string | null }

/** Add a message, move the conversation up, mark it read for the sender, and tell the others once rather than once per message. */
async function post(tx: Tx, a: Actor, conversationId: string, p: Post) {
  const members = await membersOf(tx, conversationId);
  const me = members.find((m) => m.userId === a.userId);
  if (!me) throw new Error("Conversation not found");
  const others = members.filter((m) => m.userId !== a.userId);
  for (const o of others) if (await blockedBetween(tx, a.userId, o.userId)) throw new Error(BLOCKED);
  // A flatmate chat room stops taking messages once it is closed.
  const room = await tx.flatmateRoom.findUnique({ where: { conversationId }, select: { status: true } });
  if (room && room.status !== "OPEN") throw new Error("This chat room is closed.");
  // A conversation that belongs to a collaboration lasts only as long as everyone in it still has access to a live workspace.
  const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { collaborationId: true } });
  if (conv?.collaborationId) {
    const live = await tx.collaboration.findFirst({ where: { id: conv.collaborationId, status: "ACTIVE" } });
    const people = await tx.collabParticipant.findMany({ where: { collaborationId: conv.collaborationId, userId: { in: members.map((m) => m.userId) } } });
    if (!live || people.length !== members.length || !people.every((p) => participantActive(p, new Date()))) throw new Error("This conversation belongs to a collaboration that is no longer open to everyone in it.");
  }
  await assertMayPost(tx, a);
  const screened = await screen(tx, a, p.body);
  const now = new Date();
  const msg = await tx.message.create({ data: { conversationId, senderId: a.userId, senderName: me.name, kind: p.kind, body: screened.text, masked: screened.masked, details: p.details ?? {}, replyToId: p.replyToId ?? null, createdAt: now } });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
  await tx.conversationMember.update({ where: { id: me.id }, data: { lastReadAt: now } });
  for (const o of others) {
    const alreadyWaiting = (await tx.message.count({ where: { conversationId, senderId: a.userId, createdAt: { gt: o.lastReadAt ?? new Date(0), lt: now } } })) > 0;
    if (!alreadyWaiting) await notify(tx, o.userId, { kind: "message.new", title: `New message from ${me.name}`, body: msg.kind === "TEXT" ? screened.text.slice(0, 80) : "", link: `/messages/${conversationId}` });
  }
  return msg;
}

// ---------- Starting and continuing ----------

const startSchema = z.object({ toUserId: z.string().min(1), subject: z.string().trim().max(160).default(""), body: bodySchema.pipe(z.string().min(1, "Write a message")), collaborationId: z.string().trim().optional() });

/**
 * Start a conversation, or carry on the one that exists. Cold messages go only to agents who chose to take them;
 * people who share a live collaboration can always message each other. Nobody can cold-message a seeker.
 */
export async function startConversation(a: Actor, raw: z.input<typeof startSchema>) {
  const d = startSchema.parse(raw);
  if (d.toUserId === a.userId) throw new Error("You cannot message yourself");
  return run(a, async (tx) => {
    if (await blockedBetween(tx, a.userId, d.toUserId)) throw new Error(BLOCKED);
    const target = await tx.user.findUnique({ where: { id: d.toUserId }, select: { id: true, name: true } });
    if (!target) throw new Error(BLOCKED);
    let allowed = false;
    if (d.collaborationId) {
      const rows = await tx.collabParticipant.findMany({ where: { collaborationId: d.collaborationId, userId: { in: [a.userId, d.toUserId] } } });
      const live = await tx.collaboration.findFirst({ where: { id: d.collaborationId, status: { in: ["ACTIVE", "SUSPENDED"] } } });
      allowed = !!live && rows.length === 2 && rows.every((r) => participantActive(r, new Date()));
      if (!allowed) throw new Error("You can message people in a collaboration only while you both have access to it.");
    } else {
      const profile = await tx.agentProfile.findFirst({ where: { userId: d.toUserId, listed: true, acceptsMessages: true } });
      allowed = !!profile;
    }
    const existing = await tx.conversation.findFirst({ where: { collaborationId: d.collaborationId ?? null, flatmateRoom: { is: null }, AND: [{ members: { some: { userId: a.userId } } }, { members: { some: { userId: d.toUserId } } }] } });
    if (existing) { await post(tx, a, existing.id, { kind: "TEXT", body: d.body }); return existing; }
    if (!allowed) throw new Error("This person is not taking messages from new people.");
    const { newConversationsPerDay } = await readSettings();
    const dayStart = new Date(todayInLagos().getTime() - 3600_000);
    const today = await tx.conversation.count({ where: { createdById: a.userId, createdAt: { gte: dayStart } } });
    if (today >= newConversationsPerDay) throw new Error(`You can start ${newConversationsPerDay} new conversations a day. Carry on with an existing one, or try again tomorrow.`);
    const mine = await nameOf(tx, a.userId);
    const c = await tx.conversation.create({ data: { createdById: a.userId, subject: d.subject, collaborationId: d.collaborationId ?? null } });
    await tx.conversationMember.createMany({ data: [{ conversationId: c.id, userId: a.userId, name: mine }, { conversationId: c.id, userId: target.id, name: target.name }] });
    await post(tx, a, c.id, { kind: "TEXT", body: d.body });
    return c;
  });
}

export async function sendMessage(a: Actor, conversationId: string, bodyRaw: string, replyToId?: string) {
  const body = bodySchema.pipe(z.string().min(1, "Write a message")).parse(bodyRaw);
  return run(a, async (tx) => {
    if (replyToId && !(await tx.message.findFirst({ where: { id: replyToId, conversationId } }))) throw new Error("That message is not in this conversation");
    return post(tx, a, conversationId, { kind: "TEXT", body, replyToId });
  });
}

/** Share a published listing. Only its public details are copied. */
export async function sendPropertyCard(a: Actor, conversationId: string, listingRef: string, noteRaw = "") {
  const note = bodySchema.parse(noteRaw);
  return run(a, async (tx) => {
    const l = await tx.listing.findFirst({ where: { publicRef: listingRef.trim(), status: "PUBLISHED" } });
    if (!l) throw new Error("That listing is not published");
    const details = { publicRef: l.publicRef, title: l.title, city: l.city, state: l.state, purpose: l.purpose, priceKobo: l.priceKobo === null ? null : l.priceKobo.toString(), bedrooms: l.bedrooms, bathrooms: l.bathrooms };
    return post(tx, a, conversationId, { kind: "PROPERTY", body: note, details });
  });
}

const inspectionSchema = z.object({
  listingRef: z.string().trim().optional(),
  date: z.string().trim().min(1, "Choose a date").transform((v) => parseDateOnly(v)),
  time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time"),
  note: bodySchema.default(""),
});
export async function requestInspection(a: Actor, conversationId: string, raw: z.input<typeof inspectionSchema>) {
  const d = inspectionSchema.parse(raw);
  if (d.date.getTime() < todayInLagos().getTime()) throw new Error("Choose a date that has not passed");
  return run(a, async (tx) => {
    let title = "";
    if (d.listingRef) {
      const l = await tx.listing.findFirst({ where: { publicRef: d.listingRef, status: "PUBLISHED" } });
      if (!l) throw new Error("That listing is not published");
      title = l.title;
    }
    const details = { date: d.date.toISOString().slice(0, 10), time: d.time, listingRef: d.listingRef ?? null, title };
    return post(tx, a, conversationId, { kind: "INSPECTION_REQUEST", body: d.note, details });
  });
}

/** The other person answers an inspection request, once. */
export async function respondInspection(a: Actor, requestId: string, decision: "accept" | "decline", noteRaw = "") {
  const note = bodySchema.parse(noteRaw);
  return run(a, async (tx) => {
    const req = await tx.message.findFirst({ where: { id: requestId, kind: "INSPECTION_REQUEST" } });
    if (!req) throw new Error("Request not found");
    if (req.senderId === a.userId) throw new Error("The other person answers an inspection request");
    const answered = await tx.message.findFirst({ where: { conversationId: req.conversationId, kind: "INSPECTION_REPLY", details: { path: ["requestId"], equals: requestId } } });
    if (answered) throw new Error("This request was already answered");
    return post(tx, a, req.conversationId, { kind: "INSPECTION_REPLY", body: note, details: { requestId, decision: decision === "accept" ? "ACCEPTED" : "DECLINED" }, replyToId: requestId });
  });
}

// ---------- Reading ----------

export const THREAD_PAGE = 40;
export const INBOX_PAGE = 15;

export async function listConversations(a: Actor, page = 1) {
  return run(a, async (tx) => {
    const mine = await tx.conversationMember.findMany({ where: { userId: a.userId }, select: { conversationId: true, lastReadAt: true } });
    const readAt = new Map(mine.map((m) => [m.conversationId, m.lastReadAt]));
    const rows = await tx.conversation.findMany({
      where: { id: { in: mine.map((m) => m.conversationId) } }, orderBy: { lastMessageAt: "desc" }, skip: (page - 1) * INBOX_PAGE, take: INBOX_PAGE + 1,
      include: { members: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const items = rows.slice(0, INBOX_PAGE).map((c) => {
      const last = c.messages[0] ?? null;
      const seen = readAt.get(c.id);
      return {
        id: c.id, subject: c.subject, lastMessageAt: c.lastMessageAt,
        others: c.members.filter((m) => m.userId !== a.userId).map((m) => m.name),
        preview: last ? (last.kind === "TEXT" ? last.body : last.kind === "PROPERTY" ? "Shared a property" : last.kind === "INSPECTION_REQUEST" ? "Asked to arrange an inspection" : "Answered an inspection request") : "",
        lastFromMe: last?.senderId === a.userId,
        unread: !!last && last.senderId !== a.userId && (!seen || seen < c.lastMessageAt),
      };
    });
    return { items, more: rows.length > INBOX_PAGE };
  });
}

export async function unreadConversationCount(a: Actor): Promise<number> {
  return run(a, async (tx) => {
    const rows = await tx.conversationMember.findMany({ where: { userId: a.userId }, include: { conversation: { select: { lastMessageAt: true } } }, take: 500 });
    const candidates = rows.filter((m) => !m.lastReadAt || m.lastReadAt < m.conversation.lastMessageAt);
    let n = 0;
    for (const m of candidates) {
      const last = await tx.message.findFirst({ where: { conversationId: m.conversationId }, orderBy: { createdAt: "desc" }, select: { senderId: true } });
      if (last && last.senderId !== a.userId) n++;
    }
    return n;
  });
}

/** Open a conversation: the newest messages first fetched, shown oldest to newest, and marked read. */
export async function getConversation(a: Actor, id: string, before?: Date) {
  return run(a, async (tx) => {
    const c = await tx.conversation.findUnique({ where: { id }, include: { members: true } });
    const me = c?.members.find((m) => m.userId === a.userId);
    if (!c || !me) throw new Error("Conversation not found");
    const batch = await tx.message.findMany({ where: { conversationId: id, ...(before ? { createdAt: { lt: before } } : {}) }, orderBy: { createdAt: "desc" }, take: THREAD_PAGE + 1 });
    const messages = batch.slice(0, THREAD_PAGE).reverse();
    const others = c.members.filter((m) => m.userId !== a.userId);
    const replies = await tx.message.findMany({ where: { conversationId: id, kind: "INSPECTION_REPLY" }, select: { details: true } });
    const answered = new Map(replies.map((r) => [String((r.details as { requestId?: string }).requestId), String((r.details as { decision?: string }).decision)]));
    const blocked = (await tx.userBlock.count({ where: { blockerId: a.userId, blockedId: { in: others.map((o) => o.userId) } } })) > 0;
    const unblockedByThem = !blocked && (await Promise.all(others.map((o) => blockedBetween(tx, a.userId, o.userId)))).some(Boolean);
    const reported = new Set((await tx.messageReport.findMany({ where: { reporterId: a.userId, messageId: { in: messages.map((m) => m.id) } }, select: { messageId: true } })).map((r) => r.messageId));
    if (!before) await tx.conversationMember.update({ where: { id: me.id }, data: { lastReadAt: new Date() } });
    const othersSeen = others.map((o) => o.lastReadAt).filter((x): x is Date => !!x);
    return {
      conversation: c, others, messages, olderFrom: batch.length > THREAD_PAGE ? messages[0]?.createdAt ?? null : null,
      answered, iBlocked: blocked, cannotReply: blocked || unblockedByThem, reported,
      seenUpTo: othersSeen.length ? new Date(Math.min(...othersSeen.map((d) => d.getTime()))) : null,
    };
  });
}

/** Search the messages this person can read. */
export async function searchMessages(a: Actor, qRaw: string) {
  const q = qRaw.trim();
  if (q.length < 2) return [];
  return run(a, (tx) => tx.message.findMany({ where: { kind: "TEXT", body: { contains: q, mode: "insensitive" } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, conversationId: true, senderName: true, body: true, createdAt: true } }));
}

// ---------- Safety ----------

export async function blockUser(a: Actor, userId: string) {
  if (userId === a.userId) throw new Error("You cannot block yourself");
  return run(a, async (tx) => {
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: a.userId, blockedId: userId } }, create: { blockerId: a.userId, blockedId: userId }, update: {} });
  });
}
export async function unblockUser(a: Actor, userId: string) {
  return run(a, async (tx) => { await tx.userBlock.deleteMany({ where: { blockerId: a.userId, blockedId: userId } }); });
}

export async function reportMessage(a: Actor, messageId: string, reasonRaw: string) {
  const reason = z.string().trim().min(3, "Say what is wrong").max(500).parse(reasonRaw);
  return run(a, async (tx) => {
    const m = await tx.message.findUnique({ where: { id: messageId } });
    if (!m) throw new Error("Message not found");
    if (m.senderId === a.userId) throw new Error("You cannot report your own message");
    const mine = await nameOf(tx, a.userId);
    try {
      await tx.messageReport.create({ data: { messageId, reporterId: a.userId, reporterName: mine, senderId: m.senderId, reason } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new Error("You already reported this message");
      throw e;
    }
  });
}

// ---------- Moderation (platform administrator) ----------

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

/** Open reports with the reported message, and the senders reported by enough different people to be flagged. */
export async function moderationQueue(adminId: string) {
  await adminOnly(adminId);
  const { reportMuteThreshold } = await readSettings();
  return withPlatformAdmin(adminId, async (tx) => {
    const open = await tx.messageReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 200, include: { message: true } });
    const bySender = new Map<string, Set<string>>();
    for (const r of open) bySender.set(r.senderId, (bySender.get(r.senderId) ?? new Set()).add(r.reporterId));
    const names = new Map((await tx.user.findMany({ where: { id: { in: [...bySender.keys()] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));
    const restricted = new Set((await tx.messagingRestriction.findMany({ where: { liftedAt: null }, select: { userId: true } })).map((r) => r.userId));
    return {
      threshold: reportMuteThreshold,
      reports: open.map((r) => ({ id: r.id, reason: r.reason, reporterName: r.reporterName, createdAt: r.createdAt, senderId: r.senderId, senderName: names.get(r.senderId)?.name ?? "Unknown", body: r.message.body, kind: r.message.kind, masked: r.message.masked, senderPaused: restricted.has(r.senderId) })),
      flagged: [...bySender.entries()].filter(([, who]) => who.size >= reportMuteThreshold).map(([id, who]) => ({ id, name: names.get(id)?.name ?? "Unknown", email: names.get(id)?.email ?? "", reporters: who.size, paused: restricted.has(id) })),
      paused: restricted.size,
    };
  });
}

export async function resolveReport(adminId: string, reportId: string, action: "dismiss" | "action", noteRaw: string, pauseSender = false) {
  await adminOnly(adminId);
  const note = z.string().trim().min(3, "Say what you decided and why").max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.messageReport.findUnique({ where: { id: reportId } });
    if (!r) throw new Error("Report not found");
    if (r.status !== "OPEN") throw new Error("This report was already handled");
    await tx.messageReport.update({ where: { id: reportId }, data: { status: action === "dismiss" ? "DISMISSED" : "ACTIONED", handledById: adminId, handledAt: new Date(), handlerNote: note } });
    if (action === "action" && pauseSender) await pause(tx, adminId, r.senderId, note);
    await notify(tx, r.reporterId, { kind: "message.report", title: "We looked at your report", body: action === "dismiss" ? "We found no breach of the rules." : "We acted on it.", link: "" });
  });
}

async function pause(tx: Tx, adminId: string, userId: string, reason: string) {
  await tx.messagingRestriction.upsert({ where: { userId }, create: { userId, reason, setById: adminId }, update: { reason, setById: adminId, liftedAt: null, liftedById: null, createdAt: new Date() } });
  await notify(tx, userId, { kind: "message.paused", title: "Your messaging was paused", body: reason, link: "" });
}
export async function pauseMessaging(adminId: string, userId: string, reasonRaw: string) {
  await adminOnly(adminId);
  const reason = z.string().trim().min(3, "Say why").max(500).parse(reasonRaw);
  return withPlatformAdmin(adminId, (tx) => pause(tx, adminId, userId, reason));
}
export async function liftMessagingPause(adminId: string, userId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.messagingRestriction.findFirst({ where: { userId, liftedAt: null } });
    if (!r) throw new Error("Nothing to lift");
    await tx.messagingRestriction.update({ where: { userId }, data: { liftedAt: new Date(), liftedById: adminId } });
    await notify(tx, userId, { kind: "message.resumed", title: "Your messaging was restored", body: "", link: "" });
  });
}
export const formatWhen = (d: Date) => formatDate(d);
