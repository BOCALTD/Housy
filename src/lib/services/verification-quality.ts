/**
 * Verification network, stage 8: quality.
 *  - Complaints about a provider: by the customer it worked for, or by Housy. The provider sees and answers them; Housy decides.
 *  - Customers rate a delivered report (once).
 *  - Performance indicators per provider, from the records: acceptance, time to answer, on-time delivery, turnaround, reports
 *    sent back by Housy, disputes, revocations, ratings, complaints. Housy sees every provider; each provider sees its own.
 *  - Credential monitoring: licences and certificates about to expire or expired; owners are reminded once at each stage, Housy
 *    is told when one lapses, and a provider with no current licence or certificate of a kind it filed cannot be assigned cases.
 */
import { z } from "zod";
import { withPlatformAdmin, withUser, type Tx } from "../db";
import { lockKey } from "../locks";
import { rateLimit } from "../ratelimit";
import { logActivity } from "../audit";
import { notify } from "./notifications";
import { vpCan } from "../verification-network-rules";
import type { VpCtx } from "./verification-network";
import {
  COMPLAINT_CODES, EXPIRING_KINDS, canMoveComplaint, complaintRef, credentialState, expiredKinds, providerKpis,
  type CaseRecord, type ComplaintStatus,
} from "../verification-quality-rules";

const SYSTEM = "system";
const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);

async function notifyLeads(tx: Tx, providerId: string, roles: string[], n: Parameters<typeof notify>[2]) {
  const people = await tx.providerMember.findMany({ where: { providerId, status: "ACTIVE", role: { in: roles as never } }, select: { userId: true } });
  for (const p of people) await notify(tx, p.userId, n);
}
async function notifyAdmins(tx: Tx, n: Parameters<typeof notify>[2]) {
  for (const a of await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 })) await notify(tx, a.id, n);
}

// ---------- Ratings ----------

/** The customer rates a delivered report, once: 1 to 5, with an optional comment the provider sees. */
export async function rateCase(userId: string, ref: string, ratingInput: number, feedback: string) {
  const rating = z.number().int().min(1, "Choose from 1 to 5 stars").max(5, "Choose from 1 to 5 stars").parse(ratingInput);
  const text = feedback.trim().slice(0, 1000);
  const c = await withUser(userId, (tx) => tx.vpCase.findFirst({ where: { ref, requesterId: userId }, select: { id: true, status: true, customerRating: true, providerId: true } }));
  if (!c) throw new Error("That request was not found.");
  if (!["DELIVERED", "COMPLETED"].includes(c.status)) throw new Error("You can rate the report once it has been delivered.");
  if (c.customerRating !== null) throw new Error("You have already rated this report.");
  await system(async (tx) => {
    const n = await tx.vpCase.updateMany({ where: { id: c.id, customerRating: null }, data: { customerRating: rating, customerFeedback: text } });
    if (!n.count) throw new Error("You have already rated this report.");
    if (c.providerId) await notifyLeads(tx, c.providerId, ["OWNER", "ADMIN", "MANAGER"], { kind: "verification.quality", title: `Case ${ref} rated ${rating} out of 5`, body: text.slice(0, 200), link: `/provider/cases/${ref}` });
  });
}

// ---------- Complaints ----------

const complaintSchema = z.object({
  category: z.enum(COMPLAINT_CODES as [string, ...string[]], { message: "Choose what the complaint is about" }),
  description: z.string().trim().min(20, "Describe what happened (20 characters or more)").max(4000),
});

async function nextComplaintRef(tx: Tx) {
  await lockKey(tx, "vr-complaint-ref");
  const year = new Date().getFullYear();
  const n = await tx.vpComplaint.count({ where: { ref: { startsWith: `HVC-${year}-` } } });
  return complaintRef(year, n + 1);
}

/** A customer complains about the provider that handled their case. */
export async function fileComplaint(userId: string, caseRef: string, input: z.input<typeof complaintSchema>) {
  const d = complaintSchema.parse(input);
  if (!(await rateLimit(`vr-complaint:${userId}`, 5, 86_400_000))) throw new Error("Too many complaints today. Wait a little and try again, or contact Housy's support.");
  const c = await withUser(userId, (tx) => tx.vpCase.findFirst({ where: { ref: caseRef, requesterId: userId }, select: { id: true, providerId: true, status: true } }));
  if (!c) throw new Error("That request was not found.");
  const providerId = c.providerId ?? (await system((tx) => tx.vpAssignment.findFirst({ where: { caseId: c.id, status: "ACCEPTED" }, orderBy: { createdAt: "desc" }, select: { providerId: true } })))?.providerId;
  if (!providerId || c.status === "ASSIGNED") throw new Error("No provider has worked on this request yet. Contact Housy's support instead.");
  return system(async (tx) => {
    if (await tx.vpComplaint.findFirst({ where: { caseId: c.id, complainantId: userId, status: { in: ["OPEN", "INVESTIGATING"] } } })) throw new Error("You already have an open complaint about this request. Housy will reply to it.");
    const ref = await nextComplaintRef(tx);
    await tx.vpComplaint.create({ data: { ref, providerId, caseId: c.id, complainantId: userId, category: d.category, description: d.description } });
    await tx.vpCaseActivity.create({ data: { caseId: c.id, providerId, actorId: userId, actorKind: "customer", action: "complaint_filed", note: `Complaint ${ref}`, visibleToCustomer: true } });
    await notifyLeads(tx, providerId, ["OWNER", "ADMIN"], { kind: "verification.quality", title: `Complaint ${ref} about case ${caseRef}`, body: "Read it and give your account. Housy decides.", link: "/provider" });
    await notifyAdmins(tx, { kind: "verification.quality", title: `Complaint ${ref}`, body: d.description.slice(0, 200), link: "/admin/verification/quality" });
    return ref;
  });
}

/** Housy raises a complaint against a provider itself (from a check, a report from a third party, or a pattern it noticed). */
export async function fileComplaintByHousy(adminId: string, providerId: string, caseRef: string, input: z.input<typeof complaintSchema>) {
  const d = complaintSchema.parse(input);
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.serviceProvider.findUnique({ where: { id: providerId }, select: { id: true } });
    if (!p) throw new Error("Choose the provider.");
    const c = caseRef ? await tx.vpCase.findUnique({ where: { ref: caseRef.trim().toUpperCase() }, select: { id: true } }) : null;
    if (caseRef && !c) throw new Error("That case reference was not found.");
    const ref = await nextComplaintRef(tx);
    await tx.vpComplaint.create({ data: { ref, providerId, caseId: c?.id ?? null, complainantId: adminId, byHousy: true, category: d.category, description: d.description } });
    await notifyLeads(tx, providerId, ["OWNER", "ADMIN"], { kind: "verification.quality", title: `Housy opened complaint ${ref}`, body: "Read it and give your account.", link: "/provider" });
    return ref;
  });
}

export async function myComplaints(userId: string, caseRef?: string) {
  return withUser(userId, async (tx) => {
    const c = caseRef ? await tx.vpCase.findFirst({ where: { ref: caseRef, requesterId: userId }, select: { id: true } }) : null;
    return tx.vpComplaint.findMany({ where: { complainantId: userId, ...(caseRef ? { caseId: c?.id ?? "none" } : {}) }, orderBy: { createdAt: "desc" }, select: { ref: true, category: true, description: true, status: true, providerResponse: true, resolution: true, createdAt: true, resolvedAt: true } });
  });
}

export async function withdrawComplaint(userId: string, ref: string) {
  await system(async (tx) => {
    const c = await tx.vpComplaint.findUnique({ where: { ref } });
    if (!c || c.complainantId !== userId || c.byHousy) throw new Error("That complaint was not found.");
    if (!canMoveComplaint(c.status as ComplaintStatus, "WITHDRAWN")) throw new Error("This complaint has already been decided.");
    await tx.vpComplaint.update({ where: { id: c.id }, data: { status: "WITHDRAWN", resolution: "Withdrawn by the customer.", resolvedAt: new Date() } });
  });
}

/** Complaints about this organisation, for its owner, administrators and managers. */
export async function providerComplaints(ctx: VpCtx) {
  if (!vpCan(ctx.role, "performance.view")) throw new Error("Your role in this organisation does not allow that.");
  const rows = await withUser(ctx.userId, (tx) => tx.vpComplaint.findMany({ where: { providerId: ctx.providerId }, orderBy: { createdAt: "desc" }, take: 200 }));
  const cases = new Map((await system((tx) => tx.vpCase.findMany({ where: { id: { in: rows.map((r) => r.caseId).filter(Boolean) as string[] } }, select: { id: true, ref: true } }))).map((c) => [c.id, c.ref]));
  return rows.map((r) => ({ ...r, caseRef: r.caseId ? cases.get(r.caseId) ?? "" : "" }));
}

/** The provider's account of what happened. Can be updated until Housy decides. */
export async function respondToComplaint(ctx: VpCtx, ref: string, response: string) {
  if (!["OWNER", "ADMIN"].includes(ctx.role)) throw new Error("Only the organisation's owner or an administrator can answer a complaint.");
  const text = z.string().trim().min(20, "Give your account (20 characters or more)").max(4000).parse(response);
  await system(async (tx) => {
    const c = await tx.vpComplaint.findUnique({ where: { ref } });
    if (!c || c.providerId !== ctx.providerId) throw new Error("That complaint was not found.");
    if (!["OPEN", "INVESTIGATING"].includes(c.status)) throw new Error("Housy has already decided this complaint.");
    await tx.vpComplaint.update({ where: { id: c.id }, data: { providerResponse: text, providerResponderId: ctx.userId, providerRespondedAt: new Date() } });
    await notifyAdmins(tx, { kind: "verification.quality", title: `The provider answered complaint ${ref}`, body: text.slice(0, 200), link: "/admin/verification/quality" });
  });
}

/** Housy looks into a complaint, then upholds it or not, with a resolution both sides see. */
export async function decideComplaint(adminId: string, ref: string, to: "INVESTIGATING" | "UPHELD" | "NOT_UPHELD", note: string) {
  const text = to === "INVESTIGATING" ? note.trim().slice(0, 2000) : z.string().trim().min(10, "Record the decision and why (10 characters or more): both sides see it").max(4000).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpComplaint.findUnique({ where: { ref } });
    if (!c) throw new Error("That complaint was not found.");
    if (!canMoveComplaint(c.status as ComplaintStatus, to)) throw new Error("This complaint cannot move to that step.");
    await tx.vpComplaint.update({ where: { id: c.id }, data: { status: to, ...(to === "INVESTIGATING" ? {} : { resolution: text, resolvedById: adminId, resolvedAt: new Date() }) } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_complaint", entityId: c.id, action: `verification.complaint_${to.toLowerCase()}`, detail: { ref, note: text.slice(0, 300) } });
    if (to !== "INVESTIGATING") {
      const body = `${to === "UPHELD" ? "Upheld" : "Not upheld"}: ${text}`.slice(0, 300);
      if (!c.byHousy) await notify(tx, c.complainantId, { kind: "verification.quality", title: `Your complaint ${ref}`, body, link: "/verification/cases" });
      await notifyLeads(tx, c.providerId, ["OWNER", "ADMIN"], { kind: "verification.quality", title: `Complaint ${ref} decided`, body, link: "/provider" });
    }
  });
}

export async function complaintsForAdmin(adminId: string, status?: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.vpComplaint.findMany({ where: status ? { status: status as ComplaintStatus } : { status: { in: ["OPEN", "INVESTIGATING"] } }, orderBy: { createdAt: "asc" }, take: 200 });
    const [providers, cases, people] = await Promise.all([
      tx.serviceProvider.findMany({ where: { id: { in: rows.map((r) => r.providerId) } }, select: { id: true, name: true } }),
      tx.vpCase.findMany({ where: { id: { in: rows.map((r) => r.caseId).filter(Boolean) as string[] } }, select: { id: true, ref: true } }),
      tx.user.findMany({ where: { id: { in: rows.map((r) => r.complainantId) } }, select: { id: true, name: true } }),
    ]);
    const pn = new Map(providers.map((p) => [p.id, p.name])), cr = new Map(cases.map((c) => [c.id, c.ref])), un = new Map(people.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, providerName: pn.get(r.providerId) ?? "", caseRef: r.caseId ? cr.get(r.caseId) ?? "" : "", complainant: r.byHousy ? "Housy" : un.get(r.complainantId) ?? "" }));
  });
}

// ---------- Performance ----------

async function recordsFor(tx: Tx, providerIds: string[]) {
  const offers = await tx.vpAssignment.findMany({ where: { providerId: { in: providerIds } }, select: { caseId: true, providerId: true, status: true, createdAt: true, decidedAt: true } });
  const caseIds = [...new Set(offers.map((o) => o.caseId))];
  const [cases, acts, complaints] = await Promise.all([
    tx.vpCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, providerId: true, deliveredAt: true, requiredBy: true, customerRating: true } }),
    tx.vpCaseActivity.findMany({ where: { caseId: { in: caseIds }, action: { in: ["platform_correction_requested", "disputed", "dispute_reopened", "report_revoked"] } }, select: { caseId: true, action: true } }),
    tx.vpComplaint.findMany({ where: { providerId: { in: providerIds } }, select: { providerId: true, status: true } }),
  ]);
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const count = (caseId: string, action: string) => acts.filter((a) => a.caseId === caseId && a.action === action).length;
  const out = new Map<string, { records: CaseRecord[]; complaints: { status: string }[] }>();
  for (const id of providerIds) out.set(id, { records: [], complaints: complaints.filter((c) => c.providerId === id) });
  for (const o of offers) {
    const c = byCase.get(o.caseId);
    // A case counts as this provider's delivery only if it is still the provider on the case (not one that declined or lost it).
    const mine = o.status === "ACCEPTED" && c?.providerId === o.providerId;
    out.get(o.providerId)!.records.push({
      offeredAt: o.createdAt, answer: o.status as CaseRecord["answer"], answeredAt: o.decidedAt, acceptedAt: o.status === "ACCEPTED" ? o.decidedAt : null,
      deliveredAt: mine ? c!.deliveredAt : null, requiredBy: c?.requiredBy ?? null, housyCorrections: mine ? count(o.caseId, "platform_correction_requested") : 0,
      disputed: mine && count(o.caseId, "disputed") > 0, disputeReopened: mine && count(o.caseId, "dispute_reopened") > 0, revoked: mine && count(o.caseId, "report_revoked") > 0,
      rating: mine ? c!.customerRating : null,
    });
  }
  return out;
}

async function credentialsFor(tx: Tx, providerIds: string[], today: Date) {
  const docs = await tx.vpDocument.findMany({ where: { providerId: { in: providerIds }, kind: { in: [...EXPIRING_KINDS] } }, select: { id: true, providerId: true, kind: true, title: true, fileName: true, expiresOn: true } });
  const out = new Map<string, { expired: string[]; expiring: { title: string; expiresOn: Date }[] }>();
  for (const id of providerIds) {
    const mine = docs.filter((d) => d.providerId === id);
    const expired = expiredKinds(mine, today);
    out.set(id, { expired, expiring: mine.filter((d) => credentialState(d.expiresOn, today) === "expiring").map((d) => ({ title: d.title || d.fileName, expiresOn: d.expiresOn! })) });
  }
  return out;
}

/** Every provider's indicators, flags, credentials and open complaints, for Housy. */
export async function qualityOverview(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const providers = await tx.serviceProvider.findMany({ where: { providerCode: { not: null } }, select: { id: true, name: true, providerCode: true, suspendedAt: true }, orderBy: { name: "asc" } });
    const ids = providers.map((p) => p.id);
    const [records, creds] = await Promise.all([recordsFor(tx, ids), credentialsFor(tx, ids, new Date())]);
    return providers.map((p) => {
      const r = records.get(p.id)!;
      const kpis = providerKpis(r.records, r.complaints);
      const c = creds.get(p.id)!;
      return { ...p, kpis, credentials: c, openComplaints: r.complaints.filter((x) => x.status === "OPEN" || x.status === "INVESTIGATING").length };
    }).sort((a, b) => b.kpis.flags.length + b.credentials.expired.length - (a.kpis.flags.length + a.credentials.expired.length) || a.name.localeCompare(b.name));
  });
}

/** This organisation's own indicators and credentials. */
export async function providerPerformance(ctx: VpCtx) {
  if (!vpCan(ctx.role, "performance.view")) throw new Error("Your role in this organisation does not allow that.");
  return system(async (tx) => {
    const [records, creds] = await Promise.all([recordsFor(tx, [ctx.providerId]), credentialsFor(tx, [ctx.providerId], new Date())]);
    const r = records.get(ctx.providerId)!;
    return { kpis: providerKpis(r.records, r.complaints), credentials: creds.get(ctx.providerId)! };
  });
}

// ---------- Credential monitoring ----------

/**
 * Remind owners once when a licence or certificate is about to expire, and tell them and Housy once when it has expired and
 * nothing current replaces it. Runs on a schedule. While a kind has lapsed, the provider cannot be assigned cases.
 */
export async function credentialSweep(now = new Date()) {
  let expiring = 0, expired = 0;
  const docs = await system((tx) => tx.vpDocument.findMany({ where: { providerId: { not: null }, kind: { in: [...EXPIRING_KINDS] }, expiresOn: { not: null } }, select: { id: true, providerId: true, kind: true, title: true, fileName: true, expiresOn: true, expiryNotice: true } }));
  const byProvider = new Map<string, typeof docs>();
  for (const d of docs) byProvider.set(d.providerId!, [...(byProvider.get(d.providerId!) ?? []), d]);
  for (const [providerId, mine] of byProvider) {
    const lapsed = expiredKinds(mine, now);
    for (const d of mine) {
      const state = credentialState(d.expiresOn, now);
      const label = d.title || d.fileName;
      if (state === "expiring" && d.expiryNotice === "") {
        await system(async (tx) => {
          const n = await tx.vpDocument.updateMany({ where: { id: d.id, expiryNotice: "" }, data: { expiryNotice: "expiring" } });
          if (n.count) await notifyLeads(tx, providerId, ["OWNER", "ADMIN"], { kind: "verification.quality", title: `${label} expires on ${d.expiresOn!.toISOString().slice(0, 10)}`, body: "Upload the renewed document before then, or Housy cannot assign you new cases.", link: "/provider" });
        });
        expiring++;
      } else if (state === "expired" && d.expiryNotice !== "expired" && lapsed.includes(d.kind)) {
        await system(async (tx) => {
          const n = await tx.vpDocument.updateMany({ where: { id: d.id, expiryNotice: { not: "expired" } }, data: { expiryNotice: "expired" } });
          if (!n.count) return;
          const p = await tx.serviceProvider.findUnique({ where: { id: providerId }, select: { name: true } });
          await notifyLeads(tx, providerId, ["OWNER", "ADMIN"], { kind: "verification.quality", title: `${label} has expired`, body: "Housy cannot assign you new cases until you upload a current one.", link: "/provider" });
          await notifyAdmins(tx, { kind: "verification.quality", title: `${p?.name ?? "A provider"}: ${label} expired`, body: "It cannot be assigned cases until a current document is filed.", link: `/admin/verification/providers/${providerId}` });
        });
        expired++;
      }
    }
  }
  return { expiring, expired };
}
