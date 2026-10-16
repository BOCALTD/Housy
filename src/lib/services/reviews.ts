import { z } from "zod";
import { prisma, withInviteToken, withPublic, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { hashToken, newToken, randomRef } from "../tokens";
import {
  BASIS_LABEL, FORMULA_VERSION, computeReputation, inputsHash, reviewSignals, textHash,
  type Basis, type ReputationInputs, type ReviewFact,
} from "../reputation-rules";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";
import { system } from "./rewards";

// Verified reviews and reputation. A review needs a real interaction behind it: a conversation the agent really answered, or a
// single-use link a company gives for a viewing or deal it completed. Reviews that look manipulated are held for a person.
// Reputation is worked out only from reviews, response behaviour, completed deals and upheld complaints. Plans and promotions
// are not inputs.

export const REVIEW_PAGE = 6;
export const INVITE_DAYS = 30;
export const ENQUIRY_MIN_AGE_HOURS = 24;
const DAY = 864e5;
const SYSTEM_USER = "system";

const score = (label: string, required: boolean) => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)),
  required ? z.number({ required_error: `Give an overall rating`, invalid_type_error: `Give an overall rating` }).int().min(1, "Choose 1 to 5").max(5, "Choose 1 to 5")
    : z.number().int().min(1, `${label}: choose 1 to 5`).max(5, `${label}: choose 1 to 5`).optional());
const reviewSchema = z.object({
  overall: score("Overall", true),
  communication: score("Communication", false), professionalism: score("Professionalism", false), accuracy: score("Listing accuracy", false),
  responsiveness: score("Responsiveness", false), serviceQuality: score("Service quality", false), handling: score("Transaction handling", false),
  body: z.string().trim().max(2000, "Keep the review under 2000 characters").default(""),
});
export type ReviewInput = z.input<typeof reviewSchema>;

/** "Seyi Okoye" becomes "Seyi O." The public never sees a full name. */
export const shortName = (n: string) => { const p = n.trim().split(/\s+/); return p.length < 2 ? p[0] || "Member" : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`; };

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true, name: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return u;
}
const log = (tx: Tx, r: { id: string; reviewerId: string }, actorName: string, kind: string, note = "", toReviewer = false) =>
  tx.reviewEvent.create({ data: { reviewId: r.id, reviewerId: r.reviewerId, actorName, kind, note: note.slice(0, 600), toReviewer } });

// ---------- Invitations ----------

/** Give a client the means to review a completed viewing or deal. The link works once and is shown once. */
export async function issueInvite(ctx: Ctx, o: { basis: "INSPECTION" | "TRANSACTION"; basisRef: string; aboutCompany?: boolean }) {
  assertCan(ctx, "crm.manage");
  const token = newToken();
  const hash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * DAY);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    let ownerMembershipId: string, ref: string;
    if (o.basis === "TRANSACTION") {
      const d = await tx.deal.findFirst({ where: { id: o.basisRef, companyId: ctx.companyId } });
      if (!d) throw new Error("Deal not found");
      if (d.status !== "COMPLETED") throw new Error("A review link can only be given once the deal is completed");
      ownerMembershipId = d.ownerId; ref = d.id;
    } else {
      const v = await tx.viewing.findFirst({ where: { id: o.basisRef, companyId: ctx.companyId } });
      if (!v) throw new Error("Viewing not found");
      if (v.status !== "COMPLETED") throw new Error("A review link can only be given once the viewing has taken place");
      ownerMembershipId = v.agentId; ref = v.id;
    }
    const owner = await tx.membership.findFirst({ where: { id: ownerMembershipId, companyId: ctx.companyId }, select: { userId: true } });
    const manager = ctx.role === "COMPANY_SUPER_ADMIN" || ctx.role === "MANAGER";
    if (!manager && owner?.userId !== ctx.userId) throw new Error("Only the agent who handled this, or a manager, can give a review link");
    const agentUserId = o.aboutCompany ? null : owner?.userId ?? null;
    const existing = await tx.reviewInvite.findUnique({ where: { basis_basisRef: { basis: o.basis, basisRef: ref } } });
    if (existing?.usedAt) throw new Error("This one has already been reviewed");
    if (existing) await tx.reviewInvite.update({ where: { id: existing.id }, data: { tokenHash: hash, expiresAt, revokedAt: null, agentUserId, createdById: ctx.userId } });
    else await tx.reviewInvite.create({ data: { tokenHash: hash, companyId: ctx.companyId, agentUserId, basis: o.basis, basisRef: ref, createdById: ctx.userId, expiresAt } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "review_invite", entityId: ref, action: existing ? "review.invite_reissued" : "review.invite_issued", detail: { basis: o.basis } });
  });
  return { token, path: `/reviews/write?invite=${token}`, expiresAt };
}

export async function revokeInvite(ctx: Ctx, basis: "INSPECTION" | "TRANSACTION", basisRef: string) {
  assertCan(ctx, "crm.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.reviewInvite.updateMany({ where: { companyId: ctx.companyId, basis, basisRef, usedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new Error("No open link to cancel");
  });
}

type InviteRow = NonNullable<Awaited<ReturnType<typeof findInvite>>>;
const findInvite = (token: string) => withInviteToken(hashToken(token), (tx) => tx.reviewInvite.findUnique({ where: { tokenHash: hashToken(token) } }));
function inviteProblem(i: InviteRow | null, now = new Date()): string | null {
  if (!i) return "This review link is not valid.";
  if (i.usedAt) return "This review link has already been used.";
  if (i.revokedAt) return "This review link was cancelled.";
  if (i.expiresAt.getTime() <= now.getTime()) return "This review link has expired. Ask the company for a new one.";
  return null;
}
export async function inviteInfo(token: string) {
  const i = await findInvite(token);
  const problem = inviteProblem(i);
  if (!i || problem) return { ok: false as const, problem: problem ?? "This review link is not valid." };
  return system(async (tx) => {
    const [cp, ap] = await Promise.all([
      tx.companyProfile.findUnique({ where: { companyId: i.companyId } }),
      i.agentUserId ? tx.agentProfile.findFirst({ where: { userId: i.agentUserId, companyId: i.companyId } }) : null,
    ]);
    const co = cp?.displayName ?? (await tx.company.findUnique({ where: { id: i.companyId }, select: { name: true } }))?.name ?? "the company";
    return { ok: true as const, basis: i.basis as Basis, company: co, agent: ap?.displayName ?? null };
  });
}

// ---------- Reviewable conversations ----------

async function agentOfConversation(tx: Tx, conversationId: string, reviewerId: string) {
  const members = await tx.conversationMember.findMany({ where: { conversationId } });
  if (!members.some((m) => m.userId === reviewerId)) return null;
  const others = members.filter((m) => m.userId !== reviewerId);
  return system(async (s) => {
    for (const m of others) {
      const ap = await s.agentProfile.findFirst({ where: { userId: m.userId } });
      if (ap) return { agentUserId: m.userId, companyId: ap.companyId, agentName: ap.displayName };
    }
    return null;
  });
}

/** Conversations the person has had with agents that qualify for a review: both sides spoke and a day has passed. */
export async function reviewableConversations(userId: string, now = new Date()) {
  const convs = await withUser(userId, async (tx) => {
    const mine = await tx.conversationMember.findMany({ where: { userId }, select: { conversationId: true }, take: 200 });
    const out: { id: string; subject: string; agentUserId: string; agentName: string; companyId: string }[] = [];
    for (const m of mine) {
      const a = await agentOfConversation(tx, m.conversationId, userId);
      if (!a || a.agentUserId === userId) continue;
      const msgs = await tx.message.findMany({ where: { conversationId: m.conversationId }, select: { senderId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
      const mineSent = msgs.some((x) => x.senderId === userId), theirs = msgs.some((x) => x.senderId === a.agentUserId);
      if (!mineSent || !theirs || (msgs.length && now.getTime() - msgs[0].createdAt.getTime() < ENQUIRY_MIN_AGE_HOURS * 3600e3)) continue;
      const c = await tx.conversation.findUnique({ where: { id: m.conversationId }, select: { subject: true } });
      out.push({ id: m.conversationId, subject: c?.subject ?? "", ...a });
    }
    return out;
  });
  const done = await withUser(userId, (tx) => tx.review.findMany({ where: { reviewerId: userId, basis: "ENQUIRY" }, select: { basisRef: true } }));
  return convs.filter((c) => !done.some((d) => d.basisRef === c.id));
}

// ---------- Submitting ----------

export async function submitReview(reviewerId: string, o: { token?: string; conversationId?: string; now?: Date } & ReviewInput) {
  const d = reviewSchema.parse(o);
  const now = o.now ?? new Date();
  const reviewer = await prisma.user.findUnique({ where: { id: reviewerId }, select: { id: true, name: true, createdAt: true } });
  if (!reviewer) throw new Error("Sign in to write a review");

  let basis: Basis, basisRef: string, companyId: string, agentUserId: string | null, inviteId: string | null = null;
  if (o.token) {
    const inv = await findInvite(o.token);
    const problem = inviteProblem(inv, now);
    if (!inv || problem) throw new Error(problem ?? "This review link is not valid.");
    basis = inv.basis as Basis; basisRef = inv.basisRef; companyId = inv.companyId; agentUserId = inv.agentUserId; inviteId = inv.id;
  } else if (o.conversationId) {
    const a = await withUser(reviewerId, (tx) => agentOfConversation(tx, o.conversationId!, reviewerId));
    if (!a) throw new Error("That conversation was not found, or it was not with an agent");
    const ok = (await reviewableConversations(reviewerId, now)).some((c) => c.id === o.conversationId);
    if (!ok) throw new Error(`You can review an agent after both of you have written in the conversation and ${ENQUIRY_MIN_AGE_HOURS} hours have passed`);
    basis = "ENQUIRY"; basisRef = o.conversationId; companyId = a.companyId; agentUserId = a.agentUserId;
  } else throw new Error("A review needs a conversation with the agent or a review link from the company");

  const isMember = !!(await withUser(reviewerId, (tx) => tx.membership.findFirst({ where: { companyId, userId: reviewerId }, select: { id: true } })));
  const review = await system(async (tx) => {
    if (isMember) throw new Error("You cannot review your own company");
    if (agentUserId === reviewerId) throw new Error("You cannot review yourself");
    const since48 = new Date(now.getTime() - 2 * DAY), since24 = new Date(now.getTime() - DAY);
    const hash = textHash(d.body);
    const [forTarget, byReviewer, dup, referred] = await Promise.all([
      tx.review.count({ where: { companyId, agentUserId, createdAt: { gte: since48 } } }),
      tx.review.count({ where: { reviewerId, createdAt: { gte: since24 } } }),
      hash ? tx.review.count({ where: { bodyHash: hash, OR: [{ companyId, agentUserId }, { reviewerId }] } }) : 0,
      agentUserId ? tx.referralAttribution.count({ where: { referredUserId: reviewerId, referrerId: agentUserId } }) : 0,
    ]);
    const signals = reviewSignals({ reviewerAgeHours: (now.getTime() - reviewer.createdAt.getTime()) / 3600e3, referredByTarget: referred > 0, reviewsForTargetLast48h: forTarget, reviewerReviewsLast24h: byReviewer, sameTextElsewhere: dup > 0 });
    if (inviteId) {
      const used = await tx.reviewInvite.updateMany({ where: { id: inviteId, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, usedById: reviewerId } });
      if (used.count !== 1) throw new Error("This review link has already been used.");
    }
    const exists = await tx.review.findUnique({ where: { reviewerId_basis_basisRef: { reviewerId, basis, basisRef } } });
    if (exists) throw new Error("You have already reviewed this");
    const r = await tx.review.create({
      data: {
        ref: randomRef("REV", 7), companyId, agentUserId, reviewerId, reviewerName: reviewer.name, basis, basisRef, overall: d.overall as number,
        communication: d.communication ?? null, professionalism: d.professionalism ?? null, accuracy: d.accuracy ?? null, responsiveness: d.responsiveness ?? null,
        serviceQuality: d.serviceQuality ?? null, handling: d.handling ?? null, body: d.body, bodyHash: hash, status: signals.length ? "HELD" : "PUBLISHED", signals: signals.join(","),
      },
    });
    await log(tx, r, reviewer.name, "SUBMITTED", BASIS_LABEL[basis], true);
    if (signals.length) await log(tx, r, "Platform", "HELD", `Held for a person to check (${signals.join(", ")})`, true);
    return r;
  });
  if (review.status === "PUBLISHED") await afterReviewChange(review);
  return review;
}

async function afterReviewChange(r: { companyId: string; agentUserId: string | null; id: string; status: string }, announce = true) {
  await refreshReputation("COMPANY", r.companyId);
  if (r.agentUserId) await refreshReputation("AGENT", r.agentUserId);
  if (announce && r.status === "PUBLISHED") {
    const targets = r.agentUserId ? [r.agentUserId] : (await withTenant(r.companyId, SYSTEM_USER, (c) => c.membership.findMany({ where: { companyId: r.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true } }))).map((m) => m.userId);
    await system(async (tx) => {
      for (const u of targets) await notify(tx, u, { kind: "review", title: "You have a new review", body: "Open your reviews to read it and reply.", link: "/app/reviews" });
    });
  }
}

// ---------- Reviewed party's side ----------

async function reviewForCompany(tx: Tx, ctx: Ctx, id: string) {
  const r = await tx.review.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!r) throw new Error("Review not found");
  const manager = ctx.role === "COMPANY_SUPER_ADMIN" || ctx.role === "MANAGER";
  if (r.agentUserId && r.agentUserId !== ctx.userId && !manager) throw new Error("Only the reviewed agent or a manager can do that");
  return r;
}
export async function respondToReview(ctx: Ctx, id: string, text: string) {
  assertCan(ctx, "crm.manage");
  const t = z.string().trim().min(3, "Write your reply").max(1500, "Keep the reply under 1500 characters").parse(text);
  await system(async (tx) => {
    const r = await reviewForCompany(tx, ctx, id);
    if (r.status !== "PUBLISHED") throw new Error("Only a published review can be answered");
    if (r.response) throw new Error("You have already replied");
    await tx.review.update({ where: { id }, data: { response: t, respondedAt: new Date(), respondedById: ctx.userId } });
    await log(tx, r, "Reviewed party", "RESPONDED", "", true);
  });
}
export async function disputeReview(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "crm.manage");
  const why = z.string().trim().min(10, "Explain what is wrong with the review (at least 10 characters)").max(1000).parse(reason);
  await system(async (tx) => {
    const r = await reviewForCompany(tx, ctx, id);
    if (r.status !== "PUBLISHED") throw new Error("Only a published review can be disputed");
    if (await tx.reviewCase.findUnique({ where: { reviewId_kind: { reviewId: id, kind: "DISPUTE" } } })) throw new Error("This review has already been disputed once");
    await tx.reviewCase.create({ data: { reviewId: id, companyId: r.companyId, kind: "DISPUTE", openedById: ctx.userId, reason: why } });
    await log(tx, r, "Reviewed party", "DISPUTE_OPENED", why);
  });
}

// ---------- Anyone, and the reviewer ----------

export async function reportReview(userId: string, id: string, reason: string) {
  const why = z.string().trim().min(5, "Say what is wrong (at least 5 characters)").max(500).parse(reason);
  await withUser(userId, async (tx) => {
    const r = await tx.review.findFirst({ where: { id, status: "PUBLISHED" } });
    if (!r) throw new Error("Review not found");
    if (r.reviewerId === userId) throw new Error("You cannot report your own review");
    try { await tx.reviewReport.create({ data: { reviewId: id, reporterId: userId, reason: why } }); }
    catch { throw new Error("You have already reported this review"); }
  });
}
export async function appealReview(userId: string, id: string, reason: string) {
  const why = z.string().trim().min(10, "Explain why it should be restored (at least 10 characters)").max(1000).parse(reason);
  await system(async (tx) => {
    const r = await tx.review.findFirst({ where: { id, reviewerId: userId } });
    if (!r) throw new Error("Review not found");
    if (r.status !== "HIDDEN" && r.status !== "REMOVED") throw new Error("Only a review that was taken down can be appealed");
    if (await tx.reviewCase.findUnique({ where: { reviewId_kind: { reviewId: id, kind: "APPEAL" } } })) throw new Error("You have already appealed this decision");
    await tx.reviewCase.create({ data: { reviewId: id, companyId: r.companyId, kind: "APPEAL", openedById: userId, reason: why } });
    await log(tx, r, r.reviewerName, "APPEAL_OPENED", why, true);
  });
}
export async function myReviews(userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx.review.findMany({ where: { reviewerId: userId }, orderBy: { createdAt: "desc" }, take: 100 });
    const events = await tx.reviewEvent.findMany({ where: { reviewerId: userId, toReviewer: true }, orderBy: { createdAt: "asc" }, take: 500 });
    return rows.map((r) => ({ ...r, events: events.filter((e) => e.reviewId === r.id) }));
  });
}

// ---------- Moderation ----------

export async function moderationQueue(adminId: string) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const [held, reports, cases] = await Promise.all([
      tx.review.findMany({ where: { status: "HELD" }, orderBy: { createdAt: "asc" }, take: 100 }),
      tx.reviewReport.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100 }),
      tx.reviewCase.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 100 }),
    ]);
    const ids = [...new Set([...reports.map((r) => r.reviewId), ...cases.map((c) => c.reviewId)])];
    const rs = await tx.review.findMany({ where: { id: { in: ids } } });
    return { held, reports: reports.map((x) => ({ ...x, review: rs.find((r) => r.id === x.reviewId) ?? null })), cases: cases.map((x) => ({ ...x, review: rs.find((r) => r.id === x.reviewId) ?? null })) };
  });
}

export async function moderateReview(adminId: string, id: string, action: "release" | "hide" | "remove" | "restore", note: string) {
  const admin = await adminOnly(adminId);
  const why = note.trim();
  if ((action === "hide" || action === "remove") && why.length < 5) throw new Error("Say why (at least 5 characters)");
  const to = { release: "PUBLISHED", restore: "PUBLISHED", hide: "HIDDEN", remove: "REMOVED" }[action] as "PUBLISHED" | "HIDDEN" | "REMOVED";
  const r = await system(async (tx) => {
    const cur = await tx.review.findUnique({ where: { id } });
    if (!cur) throw new Error("Review not found");
    if (action === "release" && cur.status !== "HELD") throw new Error("Only a held review can be released");
    if (action === "restore" && cur.status !== "HIDDEN") throw new Error("Only a hidden review can be restored");
    if ((action === "hide") && cur.status !== "PUBLISHED" && cur.status !== "HELD") throw new Error("That review is not showing");
    if (cur.status === to) throw new Error("Nothing to change");
    const next = await tx.review.update({ where: { id }, data: { status: to } });
    await log(tx, cur, admin.name, action.toUpperCase(), why, true);
    await tx.reviewReport.updateMany({ where: { reviewId: id, status: "OPEN" }, data: { status: to === "PUBLISHED" ? "DISMISSED" : "ACTIONED", handledById: adminId, handledAt: new Date() } });
    await logActivity(tx, { companyId: cur.companyId, actorId: adminId, entityType: "review", entityId: id, action: `review.${action}`, detail: { note: why } });
    return next;
  });
  await afterReviewChange(r, action === "release");
}

export async function dismissReports(adminId: string, reviewId: string, note: string) {
  const admin = await adminOnly(adminId);
  await system(async (tx) => {
    const r = await tx.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new Error("Review not found");
    const n = await tx.reviewReport.updateMany({ where: { reviewId, status: "OPEN" }, data: { status: "DISMISSED", handledById: adminId, handledAt: new Date() } });
    if (n.count === 0) throw new Error("No open reports");
    await log(tx, r, admin.name, "REPORTS_DISMISSED", note);
  });
}

export async function decideCase(adminId: string, caseId: string, decision: "uphold" | "reject", note: string) {
  const admin = await adminOnly(adminId);
  const why = z.string().trim().min(5, "Give your reason (at least 5 characters)").parse(note);
  const r = await system(async (tx) => {
    const c = await tx.reviewCase.findUnique({ where: { id: caseId } });
    if (!c) throw new Error("Case not found");
    if (c.status !== "OPEN") throw new Error("This has already been decided");
    const rev = await tx.review.findUniqueOrThrow({ where: { id: c.reviewId } });
    // A dispute upheld takes the review down; an appeal upheld puts it back. Rejecting either leaves things as they are.
    const to = decision === "uphold" ? (c.kind === "DISPUTE" ? "HIDDEN" : "PUBLISHED") : rev.status;
    await tx.reviewCase.update({ where: { id: caseId }, data: { status: decision === "uphold" ? "UPHELD" : "REJECTED", decidedById: adminId, decidedAt: new Date(), decision: why } });
    const next = to !== rev.status ? await tx.review.update({ where: { id: rev.id }, data: { status: to } }) : rev;
    await log(tx, rev, admin.name, `${c.kind}_${decision === "uphold" ? "UPHELD" : "REJECTED"}`, why, true);
    await logActivity(tx, { companyId: rev.companyId, actorId: adminId, entityType: "review", entityId: rev.id, action: `review.${c.kind.toLowerCase()}_${decision}`, detail: { note: why } });
    await notify(tx, c.openedById, { kind: "review", title: `Your ${c.kind === "DISPUTE" ? "dispute" : "appeal"} was ${decision === "uphold" ? "upheld" : "not upheld"}`, body: why, link: c.kind === "DISPUTE" ? "/app/reviews" : "/me/reviews" });
    return next;
  });
  await afterReviewChange(r, false);
}

// ---------- Reading ----------

export type PublicReview = { id: string; ref: string; who: string; basis: Basis; overall: number; scores: Record<string, number>; body: string; response: string; createdAt: Date; agentName?: string };
const toPublic = (r: { id: string; ref: string; reviewerName: string; basis: string; overall: number; communication: number | null; professionalism: number | null; accuracy: number | null; responsiveness: number | null; serviceQuality: number | null; handling: number | null; body: string; response: string; createdAt: Date }): PublicReview => ({
  id: r.id, ref: r.ref, who: shortName(r.reviewerName), basis: r.basis as Basis, overall: r.overall, body: r.body, response: r.response, createdAt: r.createdAt,
  scores: Object.fromEntries(Object.entries({ communication: r.communication, professionalism: r.professionalism, accuracy: r.accuracy, responsiveness: r.responsiveness, serviceQuality: r.serviceQuality, handling: r.handling }).filter(([, v]) => v != null)) as Record<string, number>,
});
export async function publicReviews(kind: "AGENT" | "COMPANY", id: string, page = 0) {
  const where = kind === "AGENT" ? { agentUserId: id, status: "PUBLISHED" as const } : { companyId: id, status: "PUBLISHED" as const };
  return system(async (tx) => {
    const [total, rows] = await Promise.all([tx.review.count({ where }), tx.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: Math.max(0, page) * REVIEW_PAGE, take: REVIEW_PAGE })]);
    return { total, page, pages: Math.max(1, Math.ceil(total / REVIEW_PAGE)), rows: rows.map(toPublic) };
  });
}
export async function companyReviewDesk(ctx: Ctx) {
  assertCan(ctx, "crm.manage");
  const manager = ctx.role === "COMPANY_SUPER_ADMIN" || ctx.role === "MANAGER";
  const mine = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = manager ? null : (await tx.membership.findFirst({ where: { companyId: ctx.companyId, userId: ctx.userId }, select: { id: true } }))?.id;
    const deals = await tx.deal.findMany({ where: { companyId: ctx.companyId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 60, select: { id: true, ref: true, title: true, ownerId: true } });
    const viewings = await tx.viewing.findMany({ where: { companyId: ctx.companyId, status: "COMPLETED" }, orderBy: { startsAt: "desc" }, take: 60, select: { id: true, startsAt: true, agentId: true, dealId: true } });
    const invites = await tx.reviewInvite.findMany({ where: { companyId: ctx.companyId }, take: 300 });
    return { m, deals, viewings, invites };
  });
  return system(async (tx) => {
    const rows = await tx.review.findMany({ where: { companyId: ctx.companyId, status: { in: ["PUBLISHED", "HIDDEN"] }, ...(manager ? {} : { agentUserId: ctx.userId }) }, orderBy: { createdAt: "desc" }, take: 100 });
    const cases = await tx.reviewCase.findMany({ where: { reviewId: { in: rows.map((r) => r.id) }, kind: "DISPUTE" } });
    const dealsOk = mine.deals.filter((d) => manager || d.ownerId === mine.m);
    const viewsOk = mine.viewings.filter((v) => manager || v.agentId === mine.m);
    const state = (basis: string, ref: string) => { const i = mine.invites.find((x) => x.basis === basis && x.basisRef === ref); return i ? (i.usedAt ? "REVIEWED" : i.revokedAt ? "CANCELLED" : i.expiresAt < new Date() ? "EXPIRED" : "OPEN") : "NONE"; };
    return {
      reviews: rows.map((r) => ({ ...toPublic(r), status: r.status, dispute: cases.find((c) => c.reviewId === r.id) ?? null })),
      deals: dealsOk.map((d) => ({ ...d, invite: state("TRANSACTION", d.id) })),
      viewings: viewsOk.map((v) => ({ ...v, invite: state("INSPECTION", v.id) })),
    };
  });
}

// ---------- Reputation ----------

/** Work a subject's figure out from the facts and record it, unless nothing has changed since the last one. */
export async function refreshReputation(kind: "AGENT" | "COMPANY", id: string, asOf = new Date()) {
  return system(async (tx) => {
    const inputs = await gatherInputs(tx, kind, id, asOf);
    const hash = inputsHash(inputs);
    const last = await tx.reputationSnapshot.findFirst({ where: { subjectKind: kind, subjectId: id }, orderBy: { computedAt: "desc" } });
    if (last && last.inputsHash === hash && last.formula === FORMULA_VERSION) return last;
    const rep = computeReputation(inputs);
    return tx.reputationSnapshot.create({
      data: { subjectKind: kind, subjectId: id, score: rep.score, reviewCount: rep.reviewCount, average: rep.average, formula: FORMULA_VERSION, inputs: inputs as never, components: rep.components as never, badges: rep.badges as never, inputsHash: hash, computedAt: asOf },
    });
  });
}

async function gatherInputs(tx: Tx, kind: "AGENT" | "COMPANY", id: string, asOf: Date): Promise<ReputationInputs> {
  const where = kind === "AGENT" ? { agentUserId: id, status: "PUBLISHED" as const } : { companyId: id, status: "PUBLISHED" as const };
  const rs = await tx.review.findMany({ where, orderBy: { createdAt: "asc" }, take: 2000 });
  const reviews: ReviewFact[] = rs.map((r) => ({ o: r.overall, b: r.basis as Basis, d: r.createdAt.toISOString().slice(0, 10), l: r.body.length, a: r.accuracy }));
  // Deals and memberships belong to companies, so they are read inside the company's own scope.
  let deals = 0, userIds: string[] = [];
  if (kind === "AGENT") {
    const mine = await withUser(id, (u) => u.membership.findMany({ where: { userId: id }, select: { id: true, companyId: true } }));
    userIds = [id];
    for (const m of mine) deals += await withTenant(m.companyId, SYSTEM_USER, (c) => c.deal.count({ where: { status: "COMPLETED", ownerId: m.id } }));
  } else {
    const r = await withTenant(id, SYSTEM_USER, async (c) => ({ deals: await c.deal.count({ where: { status: "COMPLETED", companyId: id } }), users: await c.membership.findMany({ where: { companyId: id }, select: { userId: true } }) }));
    deals = r.deals; userIds = r.users.map((u) => u.userId);
  }
  const upheld = await tx.messageReport.count({ where: { senderId: { in: userIds }, status: "ACTIONED" } });
  let conversations = 0, replied = 0;
  if (kind === "AGENT") {
    const since = new Date(asOf.getTime() - 180 * DAY);
    const stats = await withUser(id, async (u) => {
      const mine = await u.conversationMember.findMany({ where: { userId: id, conversation: { createdAt: { gte: since }, createdById: { not: id } } }, select: { conversationId: true }, take: 400 });
      let n = 0, ok = 0;
      for (const m of mine) {
        const msgs = await u.message.findMany({ where: { conversationId: m.conversationId }, select: { senderId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
        const first = msgs.find((x) => x.senderId !== id);
        if (!first) continue;
        n++;
        const reply = msgs.find((x) => x.senderId === id && x.createdAt >= first.createdAt);
        if (reply && reply.createdAt.getTime() - first.createdAt.getTime() <= DAY) ok++;
      }
      return { n, ok };
    });
    conversations = stats.n; replied = stats.ok;
  }
  return { asOf: asOf.toISOString().slice(0, 10), reviews, conversations, repliedWithin24h: replied, completedDeals: deals, upheldComplaints: upheld };
}

export async function reputationOf(kind: "AGENT" | "COMPANY", id: string) {
  return system(async (tx) => tx.reputationSnapshot.findFirst({ where: { subjectKind: kind, subjectId: id }, orderBy: { computedAt: "desc" } }));
}
/** The current figure, worked out now if there has never been one. */
export async function ensureReputation(kind: "AGENT" | "COMPANY", id: string) {
  return (await reputationOf(kind, id)) ?? refreshReputation(kind, id);
}
export async function reputationMany(kind: "AGENT" | "COMPANY", ids: string[]) {
  const out = new Map<string, { score: number; reviewCount: number; average: number; badges: string[] }>();
  if (!ids.length) return out;
  const rows = await system((tx) => tx.reputationSnapshot.findMany({ where: { subjectKind: kind, subjectId: { in: ids } }, orderBy: { computedAt: "desc" } }));
  for (const r of rows) if (!out.has(r.subjectId)) out.set(r.subjectId, { score: r.score, reviewCount: r.reviewCount, average: r.average, badges: r.badges as string[] });
  return out;
}

/** Admin's recompute of everyone who has a record. Safe to run any time. */
export async function refreshAllReputation(adminId: string) {
  await adminOnly(adminId);
  const subjects = await system(async (tx) => {
    const a = await tx.review.findMany({ where: { agentUserId: { not: null } }, distinct: ["agentUserId"], select: { agentUserId: true } });
    const c = await tx.review.findMany({ distinct: ["companyId"], select: { companyId: true } });
    return { a: a.map((x) => x.agentUserId!), c: c.map((x) => x.companyId) };
  });
  for (const id of subjects.a) await refreshReputation("AGENT", id);
  for (const id of subjects.c) await refreshReputation("COMPANY", id);
  return subjects.a.length + subjects.c.length;
}

// ---------- Public profiles ----------

export const publicAgent = (userId: string) => withPublic((tx) => tx.agentProfile.findFirst({ where: { userId, listed: true } }));
export const publicCompany = (companyId: string) => withPublic((tx) => tx.companyProfile.findFirst({ where: { companyId, listed: true } }));
