/**
 * Verification cases, stages 4 to 6 of the verification network (docs/VERIFICATION-NETWORK.md):
 *  4. A customer asks for verification of a property; Housy confirms the request, ranks eligible providers and assigns
 *     one (its own choice, the engine's suggestion or the customer's preference, every override recorded with a reason);
 *     the provider accepts or declines with a reason; an unanswered offer expires and the case is offered again.
 *  5. The provider's staff work the case: document review, questions to the customer, site inspections, evidence.
 *  6. The report: drafted, sent for the provider's internal review (a different person approves it), reviewed by Housy
 *     (separately from the provider's opinion), released to the customer with a fingerprint, never altered afterwards;
 *     corrections are new versions and the old ones are marked superseded; anyone can check a report is genuine.
 *
 * Every status move is checked here against the rules and again by a database trigger; every read and write runs as the
 * person (row-level security), Housy's administrators as themselves.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, withPlatformAdmin, withPublic, withUser, type Tx } from "../db";
import { notify } from "./notifications";
import { rateLimit } from "../ratelimit";
import { validateUpload } from "../storage";
import { STATES } from "../geo-rules";
import { providerContext, type VpCtx } from "./verification-network";
import { SERVICE_CODES, PROPERTY_TYPES, vpCan, type VpRole } from "../verification-network-rules";
import {
  canMoveCase, canonicalReport, caseRef, isHardReason, isCaseRef, rankProviders, reportGaps, FINDING_BASES, OPEN_PROVIDER_STATUSES, OUTCOME_CODES,
  type Candidate, type CaseStatus, type Mover, type ReportContent,
} from "../verification-case-rules";
import { renderVerificationReport } from "../verification-report-pdf";
import { EXPIRING_KINDS, expiredKinds } from "../verification-quality-rules";
import { asHousy, earningOnRelease, earningPayable, holdEarning } from "./verification-finance";

const SYSTEM = "system";
const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);
const STATE_NAMES = STATES.map((s) => s.name);
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const OFFER_HOURS = 48;
const PUBLIC_REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const publicRef = () => `VR-${[...randomBytes(10)].map((b) => PUBLIC_REF_ALPHABET[b % 32]).join("")}`;

async function limited(key: string, n: number, windowMs = 3_600_000) {
  if (!(await rateLimit(key, n, windowMs))) throw new Error("Too many attempts just now. Wait a little and try again.");
}

async function activity(tx: Tx, a: { caseId: string; providerId?: string | null; actorId: string; actorKind: "customer" | "platform" | "provider"; action: string; from?: string; to?: string; note?: string; visible?: boolean }) {
  await tx.vpCaseActivity.create({ data: { caseId: a.caseId, providerId: a.providerId ?? null, actorId: a.actorId, actorKind: a.actorKind, action: a.action, fromStatus: a.from ?? "", toStatus: a.to ?? "", note: (a.note ?? "").slice(0, 3000), visibleToCustomer: a.visible ?? true } });
}

async function notifyProviderLeads(tx: Tx, providerId: string, n: Parameters<typeof notify>[2]) {
  const leads = await tx.providerMember.findMany({ where: { providerId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MANAGER"] } }, select: { userId: true } });
  for (const l of leads) await notify(tx, l.userId, n);
}
async function notifyAdmins(tx: Tx, n: Parameters<typeof notify>[2]) {
  for (const a of await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 })) await notify(tx, a.id, n);
}

// ============================== Stage 4: requests ==============================

const requestSchema = z.object({
  listingRef: z.string().trim().max(40).default(""),
  propertyAddress: z.string().trim().min(5, "Enter the property's address or a clear description of where it is").max(400),
  state: z.string().trim().refine((s) => STATE_NAMES.includes(s), "Choose the property's state from the list"),
  area: z.string().trim().max(120).default(""),
  propertyType: z.enum(PROPERTY_TYPES, { message: "Choose the type of property" }),
  services: z.array(z.enum(SERVICE_CODES as [string, ...string[]])).min(1, "Choose at least one verification service"),
  documentsAvailable: z.string().trim().max(1500).default(""),
  ownerDetails: z.string().trim().max(1000).default(""),
  transactionContext: z.string().trim().max(1500).default(""),
  notes: z.string().trim().max(2000).default(""),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  preferredProviderId: z.string().uuid().optional(),
});

/** A customer asks for a property to be verified. Housy confirms the request and finds a provider. */
export async function requestVerification(userId: string, input: z.input<typeof requestSchema>) {
  const d = requestSchema.parse(input);
  await limited(`vr-request:${userId}`, 10, 86_400_000);
  let listingId: string | null = null;
  if (d.listingRef) {
    const l = await withPublic((tx) => tx.listing.findFirst({ where: { publicRef: d.listingRef, status: "PUBLISHED" }, select: { id: true } }));
    if (!l) throw new Error("That listing was not found. Check the property reference, or leave it empty.");
    listingId = l.id;
  }
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = await system((tx) => tx.vpCase.count({ where: { ref: { startsWith: `HVR-${year}-` } } }));
    const ref = caseRef(year, n + 1 + attempt);
    try {
      await withUser(userId, async (tx) => {
        const c = await tx.vpCase.create({ data: { ref, requesterId: userId, listingId, listingRef: d.listingRef, propertyAddress: d.propertyAddress, state: d.state, area: d.area, propertyType: d.propertyType, services: d.services, documentsAvailable: d.documentsAvailable, ownerDetails: d.ownerDetails, transactionContext: d.transactionContext, notes: d.notes, priority: d.priority, preferredProviderId: d.preferredProviderId ?? null }, select: { id: true } });
        await activity(tx, { caseId: c.id, actorId: userId, actorKind: "customer", action: "requested", to: "REQUESTED" });
        await notify(tx, userId, { kind: "verification.case", title: `Verification request ${ref} received`, body: "Housy will confirm it and find a qualified provider. You can follow every step here.", link: `/verification/cases/${ref}` });
      });
      await system((tx) => notifyAdmins(tx, { kind: "verification.case", title: `New verification request ${ref}`, body: `${d.propertyType.toLowerCase().replace(/_/g, " ")} in ${d.state}: ${d.services.length} service${d.services.length === 1 ? "" : "s"}.`, link: `/admin/verification/cases/${ref}` }));
      return ref;
    } catch (e) { if ((e as { code?: string }).code !== "P2002") throw e; }
  }
  throw new Error("Could not create the request just now. Try again.");
}

export async function myCases(userId: string) {
  return withUser(userId, (tx) => tx.vpCase.findMany({ where: { requesterId: userId }, orderBy: { createdAt: "desc" }, select: { ref: true, status: true, propertyAddress: true, state: true, services: true, createdAt: true, deliveredAt: true } }));
}

/** The customer's view: their case, the steps meant for them, their own documents, and the released report. */
export async function caseForCustomer(userId: string, ref: string) {
  if (!isCaseRef(ref)) return null;
  return withUser(userId, async (tx) => {
    const c = await tx.vpCase.findFirst({ where: { ref, requesterId: userId } });
    if (!c) return null;
    const [activities, files, report] = await Promise.all([
      tx.vpCaseActivity.findMany({ where: { caseId: c.id, visibleToCustomer: true }, orderBy: { createdAt: "asc" }, select: { action: true, toStatus: true, note: true, actorKind: true, createdAt: true } }),
      tx.vpCaseFile.findMany({ where: { caseId: c.id }, select: { id: true, title: true, fileName: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.vpReport.findFirst({ where: { caseId: c.id }, select: { publicRef: true, releasedVersion: true, versions: { where: { releasedAt: { not: null } }, orderBy: { version: "desc" }, select: { version: true, outcome: true, releasedAt: true, sha256: true, supersededAt: true, revokedAt: true, revokedReason: true, correctionReason: true } } } }),
    ]);
    const provider = c.providerId && !["ASSIGNED"].includes(c.status) ? await prisma.serviceProvider.findUnique({ where: { id: c.providerId }, select: { name: true, providerCode: true, country: true } }) : null;
    return { ...c, activities, files, report, provider };
  });
}

async function customerMove(userId: string, ref: string, to: CaseStatus, action: string, note: string, extra: Record<string, unknown> = {}, then?: (tx: Tx, caseId: string) => Promise<void>) {
  await withUser(userId, async (tx) => {
    const c = await tx.vpCase.findFirst({ where: { ref, requesterId: userId }, select: { id: true, status: true, providerId: true } });
    if (!c) throw new Error("That request was not found.");
    if (!canMoveCase(c.status as CaseStatus, to, { kind: "customer" })) throw new Error("That cannot be done at this stage of the request.");
    await tx.vpCase.update({ where: { id: c.id }, data: { status: to, ...extra } });
    await activity(tx, { caseId: c.id, actorId: userId, actorKind: "customer", action, from: c.status, to, note });
    if (then) await then(tx, c.id);
    if (c.providerId && to !== "CANCELLED") await system((t2) => notifyProviderLeads(t2, c.providerId!, { kind: "verification.case", title: `Case ${ref}: ${action.replace(/_/g, " ")}`, body: note.slice(0, 200), link: `/provider/cases/${ref}` }));
  });
  await system((tx) => notifyAdmins(tx, { kind: "verification.case", title: `Case ${ref}: customer ${action.replace(/_/g, " ")}`, body: note.slice(0, 200), link: `/admin/verification/cases/${ref}` }));
}

export async function cancelByCustomer(userId: string, ref: string, reason: string) {
  await customerMove(userId, ref, "CANCELLED", "cancelled", z.string().trim().max(1000).parse(reason), { closingNote: reason.slice(0, 1000) }, (tx, id) => asHousy(tx, async () => {
    await voidOpenInvoice(tx, id, "Cancelled by the customer");
    const paid = await tx.invoice.findFirst({ where: { subjectId: id, purpose: "VERIFICATION", status: "PAID" }, select: { ref: true } });
    if (paid) await notifyAdmins(tx, { kind: "verification.case", title: `Case ${ref} cancelled after payment`, body: `Refund invoice ${paid.ref} from Payments.`, link: "/admin/payments" });
  }));
}
export async function answerInformationRequest(userId: string, ref: string, answer: string) {
  await customerMove(userId, ref, "DOCUMENT_REVIEW", "information_provided", z.string().trim().min(5, "Write your answer (5 characters or more)").max(3000).parse(answer));
}
export async function acknowledgeReport(userId: string, ref: string) {
  // The provider's earning becomes payable now: the customer has accepted the report.
  await customerMove(userId, ref, "COMPLETED", "completed", "The customer confirmed they have the report.", { completedAt: new Date() }, (tx, id) => asHousy(tx, () => earningPayable(tx, id, userId, new Date())));
}
export async function disputeReport(userId: string, ref: string, reason: string) {
  const text = z.string().trim().min(20, "Explain what you dispute and why (20 characters or more)").max(3000).parse(reason);
  await customerMove(userId, ref, "DISPUTED", "disputed", text, {}, (tx, id) => asHousy(tx, () => holdEarning(tx, id, `Disputed by the customer: ${text}`)));
}

export async function addCustomerDocument(userId: string, ref: string, title: string, file: { name: string; type: string; bytes: Uint8Array }) {
  validateUpload(file.type, file.bytes);
  await limited(`vr-doc:${userId}`, 40);
  await withUser(userId, async (tx) => {
    const c = await tx.vpCase.findFirst({ where: { ref, requesterId: userId }, select: { id: true } });
    if (!c) throw new Error("That request was not found.");
    if ((await tx.vpCaseFile.count({ where: { caseId: c.id, uploaderKind: "customer" } })) >= 20) throw new Error("A request can hold up to 20 documents.");
    await tx.vpCaseFile.create({ data: { caseId: c.id, kind: "CUSTOMER_DOCUMENT", basis: "DOCUMENTARY", title: title.trim().slice(0, 160) || file.name.slice(0, 160), fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, bytes: Buffer.from(file.bytes), sha256: sha256(file.bytes), uploadedById: userId, uploaderKind: "customer" }, select: { id: true } });
    await activity(tx, { caseId: c.id, actorId: userId, actorKind: "customer", action: "document_added", note: title.slice(0, 160) });
  }).catch((e) => { if (/row-level security/.test(String(e))) throw new Error("Documents can no longer be added at this stage."); throw e; });
}

// ---------- Housy: intake, choosing and assigning ----------

export async function casesForAdmin(adminId: string, f: { status?: string; q?: string; state?: string; service?: string; provider?: string; page?: number }) {
  await expireOffers();
  const page = Math.max(1, f.page ?? 1), size = 25;
  const where = {
    ...(f.status ? { status: f.status as CaseStatus } : {}),
    ...(f.state ? { state: f.state } : {}),
    ...(f.service ? { services: { has: f.service } } : {}),
    ...(f.provider ? { providerId: f.provider } : {}),
    ...(f.q ? { OR: [{ ref: { contains: f.q.toUpperCase() } }, { propertyAddress: { contains: f.q, mode: "insensitive" as const } }] } : {}),
  };
  return withPlatformAdmin(adminId, async (tx) => {
    const [rows, total, byStatus] = await Promise.all([
      tx.vpCase.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * size, take: size, select: { ref: true, status: true, propertyAddress: true, state: true, services: true, providerId: true, priority: true, createdAt: true, requiredBy: true } }),
      tx.vpCase.count({ where }),
      tx.vpCase.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const names = new Map((await tx.serviceProvider.findMany({ where: { id: { in: rows.map((r) => r.providerId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return { rows: rows.map((r) => ({ ...r, providerName: r.providerId ? names.get(r.providerId) ?? "" : "" })), total, page, size, byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number> };
  });
}

/** Candidates for a case, from each provider's records: what it is approved for and offers, where it works, conflicts, load and track record. */
async function candidates(tx: Tx, c: { id: string; services: string[]; state: string }): Promise<Candidate[]> {
  const providers = await tx.serviceProvider.findMany({ where: { providerCode: { not: null } }, select: { id: true, name: true, status: true, suspendedAt: true, vettedAt: true, allowedServices: true, allowedStates: true, application: { select: { answers: true } } } });
  const ids = providers.map((p) => p.id);
  const today = new Date();
  const [offerings, coverage, conflicts, open, done, offers, expired] = await Promise.all([
    tx.vpProviderService.findMany({ where: { providerId: { in: ids }, active: true }, select: { providerId: true, categoryCode: true, priceKobo: true, turnaroundDays: true } }),
    tx.vpProviderCoverage.findMany({ where: { providerId: { in: ids } }, select: { providerId: true, state: true } }),
    tx.vpConflict.findMany({ where: { caseId: c.id }, select: { providerId: true } }),
    tx.vpCase.groupBy({ by: ["providerId"], where: { providerId: { in: ids }, status: { in: OPEN_PROVIDER_STATUSES } }, _count: { _all: true } }),
    tx.vpCase.findMany({ where: { providerId: { in: ids }, status: { in: ["DELIVERED", "COMPLETED"] } }, select: { providerId: true, deliveredAt: true, requiredBy: true } }),
    tx.vpAssignment.groupBy({ by: ["providerId", "status"], where: { providerId: { in: ids } }, _count: { _all: true } }),
    tx.vpDocument.findMany({ where: { providerId: { in: ids }, kind: { in: [...EXPIRING_KINDS] } }, select: { providerId: true, kind: true, expiresOn: true } }),
  ]);
  return providers.map((p) => {
    const mine = offerings.filter((o) => o.providerId === p.id);
    const req = mine.filter((o) => c.services.includes(o.categoryCode));
    const price = req.length === c.services.length && req.every((o) => o.priceKobo !== null) ? req.reduce((s, o) => s + (o.priceKobo ?? 0n), 0n) : null;
    const finished = done.filter((d) => d.providerId === p.id);
    const ans = p.application?.answers as { operations?: { monthlyCapacity?: number } } | undefined;
    const count = (st: string) => offers.find((o) => o.providerId === p.id && o.status === st)?._count._all ?? 0;
    return {
      providerId: p.id, name: p.name, vetted: !!p.vettedAt, active: p.status === "APPROVED" && !p.suspendedAt,
      allowedServices: p.allowedServices, offeredServices: mine.map((o) => o.categoryCode), allowedStates: p.allowedStates,
      coveredStates: coverage.filter((x) => x.providerId === p.id).map((x) => x.state), conflict: conflicts.some((x) => x.providerId === p.id),
      expiredCredentials: expiredKinds(expired.filter((x) => x.providerId === p.id), today).length,
      openCases: open.find((o) => o.providerId === p.id)?._count._all ?? 0, monthlyCapacity: ans?.operations?.monthlyCapacity ?? 10,
      completed: finished.length, onTime: finished.filter((d) => !d.requiredBy || (d.deliveredAt && d.deliveredAt <= d.requiredBy)).length,
      declined: count("DECLINED") + count("EXPIRED"), offered: count("DECLINED") + count("EXPIRED") + count("ACCEPTED"),
      priceKobo: price, turnaroundDays: req.length ? Math.max(...req.map((o) => o.turnaroundDays)) : 30,
    };
  });
}

export async function caseForAdmin(adminId: string, ref: string) {
  if (!isCaseRef(ref)) return null;
  await expireOffers();
  return withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref } });
    if (!c) return null;
    const [activities, files, assignments, report, requester, inspections] = await Promise.all([
      tx.vpCaseActivity.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
      tx.vpCaseFile.findMany({ where: { caseId: c.id }, select: { id: true, kind: true, basis: true, title: true, caption: true, fileName: true, sizeBytes: true, uploaderKind: true, lat: true, lng: true, takenAt: true, createdAt: true, sha256: true }, orderBy: { createdAt: "asc" } }),
      tx.vpAssignment.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
      tx.vpReport.findFirst({ where: { caseId: c.id }, include: { versions: { orderBy: { version: "desc" } } } }),
      tx.user.findUnique({ where: { id: c.requesterId }, select: { name: true, email: true } }),
      tx.vpInspection.findMany({ where: { caseId: c.id }, orderBy: { scheduledFor: "asc" } }),
    ]);
    const ranked = ["READY_FOR_ASSIGNMENT", "REQUESTED", "PENDING_PAYMENT"].includes(c.status) ? rankProviders({ services: c.services, state: c.state }, await candidates(tx, c)) : [];
    const people = await tx.user.findMany({ where: { id: { in: [...new Set([...activities.map((a) => a.actorId), ...assignments.map((a) => a.assignedById)])] } }, select: { id: true, name: true } });
    const pnames = new Map((await tx.serviceProvider.findMany({ where: { id: { in: [...new Set([c.providerId, c.preferredProviderId, ...assignments.map((a) => a.providerId)].filter(Boolean) as string[])] } }, select: { id: true, name: true, providerCode: true } })).map((p) => [p.id, p]));
    const names = new Map(people.map((u) => [u.id, u.name]));
    const invoice = c.invoiceId ? await tx.invoice.findUnique({ where: { id: c.invoiceId }, select: { id: true, ref: true, status: true, amountKobo: true, paidAt: true, dueOn: true } }) : null;
    const earning = await tx.vpEarning.findUnique({ where: { caseId: c.id } });
    return { ...c, invoice, earning, activities: activities.map((a) => ({ ...a, actor: a.actorId === SYSTEM ? "Housy" : names.get(a.actorId) ?? a.actorKind })), files, assignments: assignments.map((a) => ({ ...a, providerName: pnames.get(a.providerId)?.name ?? "", by: names.get(a.assignedById) ?? "Housy" })), report, requester, inspections, ranked, provider: c.providerId ? pnames.get(c.providerId) ?? null : null, preferred: c.preferredProviderId ? pnames.get(c.preferredProviderId) ?? null : null };
  });
}

/** An unpaid quote is withdrawn when the case will not be paid through it (cancelled, or paid for another way). */
async function voidOpenInvoice(tx: Tx, caseId: string, reason: string) {
  await tx.invoice.updateMany({ where: { subjectId: caseId, purpose: "VERIFICATION", status: "OPEN" }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason } });
}

async function platformMove(tx: Tx, adminId: string, ref: string, to: CaseStatus, action: string, note: string, data: Record<string, unknown> = {}, visible = true) {
  const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, status: true, providerId: true, requesterId: true } });
  if (!c) throw new Error("That case was not found.");
  if (!canMoveCase(c.status as CaseStatus, to, { kind: "platform" })) throw new Error(`A case that is "${c.status.toLowerCase().replace(/_/g, " ")}" cannot be moved to "${to.toLowerCase().replace(/_/g, " ")}".`);
  await tx.vpCase.update({ where: { id: c.id }, data: { status: to, ...data } });
  await activity(tx, { caseId: c.id, providerId: c.providerId, actorId: adminId, actorKind: "platform", action, from: c.status, to, note, visible });
  return c;
}

/**
 * Housy decides on a new request without a quote: not taken on (with a reason the customer sees), or taken on with the fee
 * arranged outside Housy's invoicing (for example a corporate agreement), which needs a note saying how. To charge the customer
 * through Housy, quote the case instead (verification-finance quoteCase): it waits for payment and moves on when paid.
 */
export async function decideIntake(adminId: string, ref: string, to: "READY_FOR_ASSIGNMENT" | "REJECTED", note: string) {
  const text = to === "REJECTED"
    ? z.string().trim().min(10, "Give the reason (10 characters or more): the customer sees it").max(2000).parse(note)
    : z.string().trim().min(10, "Say how this verification is paid for (10 characters or more), or quote it instead").max(2000).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await platformMove(tx, adminId, ref, to, to === "READY_FOR_ASSIGNMENT" ? "billing_confirmed" : "rejected", to === "REJECTED" ? text : "Paid for outside Housy's invoicing.", to === "REJECTED" ? { closingNote: text } : {});
    if (to === "READY_FOR_ASSIGNMENT") await activity(tx, { caseId: c.id, actorId: adminId, actorKind: "platform", action: "billing_note", note: text, visible: false });
    if (c.status === "PENDING_PAYMENT") await voidOpenInvoice(tx, c.id, "Paid for outside Housy's invoicing");
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Verification request ${ref}`, body: to === "READY_FOR_ASSIGNMENT" ? "Confirmed. Housy is now choosing a qualified provider." : `Not taken on: ${text}`, link: `/verification/cases/${ref}` });
  });
}

const assignSchema = z.object({
  providerId: z.string().uuid("Choose a provider"),
  method: z.enum(["MANUAL", "RECOMMENDED", "CUSTOMER"]),
  reason: z.string().trim().max(1500).default(""),
  requiredBy: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the required completion date").optional(),
});

/**
 * Offer the case to a provider. Never to one that is not vetted, is suspended, is not approved for a requested service or
 * the state, or has declared a conflict. Choosing one that does not offer a service, does not work in the state or is full
 * is an override: it needs a reason, and the administrator, reason and time are recorded.
 */
export async function assignCase(adminId: string, ref: string, input: z.input<typeof assignSchema>) {
  const d = assignSchema.parse(input);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, status: true, services: true, state: true, requesterId: true, preferredProviderId: true } });
    if (!c) throw new Error("That case was not found.");
    if (!canMoveCase(c.status as CaseStatus, "ASSIGNED", { kind: "platform" })) throw new Error("Only a case that is ready for a provider can be offered to one.");
    const ranked = rankProviders({ services: c.services, state: c.state }, await candidates(tx, c));
    const pick = ranked.find((r) => r.providerId === d.providerId);
    if (!pick) throw new Error("That provider was not found in the network.");
    const hard = pick.reasons.filter(isHardReason);
    if (hard.length) throw new Error(`This provider cannot take the case: ${hard.join("; ")}.`);
    if (!pick.eligible && d.reason.length < 10) throw new Error(`This choice overrides the eligibility rules (${pick.reasons.join("; ")}). Give the reason (10 characters or more); it is recorded.`);
    if (d.method === "CUSTOMER" && c.preferredProviderId !== d.providerId) throw new Error("That is not the provider the customer chose.");
    if (d.method === "RECOMMENDED" && ranked.find((r) => r.eligible)?.providerId !== d.providerId) throw new Error("That is not the recommended provider; choose it yourself instead (with a reason if needed).");
    const respondBy = new Date(Date.now() + OFFER_HOURS * 3_600_000);
    await tx.vpAssignment.create({ data: { caseId: c.id, providerId: d.providerId, method: d.method, assignedById: adminId, reason: pick.eligible ? d.reason : `Override (${pick.reasons.join("; ")}): ${d.reason}`, respondBy } });
    await tx.vpCase.update({ where: { id: c.id }, data: { status: "ASSIGNED", providerId: d.providerId, selectionMethod: d.method, acceptBy: respondBy, ...(d.requiredBy ? { requiredBy: new Date(`${d.requiredBy}T17:00:00+01:00`) } : {}) } });
    await activity(tx, { caseId: c.id, providerId: d.providerId, actorId: adminId, actorKind: "platform", action: pick.eligible ? "offered" : "offered_with_override", from: c.status, to: "ASSIGNED", note: `${pick.name} (${d.method.toLowerCase()})${d.reason ? `: ${d.reason}` : ""}`, visible: false });
    await notifyProviderLeads(tx, d.providerId, { kind: "verification.case", title: `New case offered: ${ref}`, body: `Accept or decline within ${OFFER_HOURS} hours.`, link: `/provider/cases/${ref}` });
  });
}

/** Offers nobody answered in time go back to Housy to offer again. Runs whenever cases are looked at. */
export async function expireOffers() {
  await system(async (tx) => {
    const due = await tx.vpAssignment.findMany({ where: { status: "OFFERED", respondBy: { lt: new Date() } }, select: { id: true, caseId: true, providerId: true }, take: 100 });
    for (const a of due) {
      await tx.vpAssignment.update({ where: { id: a.id }, data: { status: "EXPIRED", decidedAt: new Date() } });
      const c = await tx.vpCase.findUnique({ where: { id: a.caseId }, select: { status: true, providerId: true, ref: true } });
      if (c?.status === "ASSIGNED" && c.providerId === a.providerId) {
        await tx.vpCase.update({ where: { id: a.caseId }, data: { status: "READY_FOR_ASSIGNMENT", providerId: null, acceptBy: null } });
        await activity(tx, { caseId: a.caseId, providerId: a.providerId, actorId: SYSTEM, actorKind: "platform", action: "offer_expired", from: "ASSIGNED", to: "READY_FOR_ASSIGNMENT", visible: false });
        await notifyAdmins(tx, { kind: "verification.case", title: `Case ${c.ref}: offer not answered`, body: "The provider did not answer in time. Offer it to another provider.", link: `/admin/verification/cases/${c.ref}` });
      }
    }
  });
}

export async function withdrawOffer(adminId: string, ref: string, reason: string) {
  const text = z.string().trim().min(10, "Give the reason (10 characters or more)").max(1500).parse(reason);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, providerId: true } });
    if (!c) throw new Error("That case was not found.");
    await tx.vpAssignment.updateMany({ where: { caseId: c.id, status: "OFFERED" }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedById: adminId } });
    await platformMove(tx, adminId, ref, "READY_FOR_ASSIGNMENT", "offer_withdrawn", text, { providerId: null, acceptBy: null }, false);
    if (c.providerId) await notifyProviderLeads(tx, c.providerId, { kind: "verification.case", title: `Case ${ref} withdrawn`, body: text.slice(0, 200), link: "/provider/cases" });
  });
}

export async function cancelByAdmin(adminId: string, ref: string, reason: string) {
  const text = z.string().trim().min(10, "Give the reason (10 characters or more): the customer and the provider see it").max(2000).parse(reason);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await platformMove(tx, adminId, ref, "CANCELLED", "cancelled", text, { closingNote: text });
    await voidOpenInvoice(tx, c.id, "Cancelled by Housy");
    await tx.vpAssignment.updateMany({ where: { caseId: c.id, status: "OFFERED" }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedById: adminId } });
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Verification ${ref} cancelled`, body: text.slice(0, 300), link: `/verification/cases/${ref}` });
    if (c.providerId) await notifyProviderLeads(tx, c.providerId, { kind: "verification.case", title: `Case ${ref} cancelled by Housy`, body: text.slice(0, 200), link: `/provider/cases/${ref}` });
  });
}

// ============================== Stage 5: the provider's work ==============================

const mover = (ctx: VpCtx): Mover => ({ kind: "provider", role: ctx.role });

/** Cases this organisation can see: all of them for owners, administrators, managers, reviewers and finance; investigators see their own. */
export async function providerCases(ctx: VpCtx, f: { status?: string } = {}) {
  if (!vpCan(ctx.role, "case.view.all") && !vpCan(ctx.role, "case.view.assigned") && !vpCan(ctx.role, "finance.view")) throw new Error("Your role in this organisation does not allow that.");
  await expireOffers();
  return withUser(ctx.userId, async (tx) => {
    const rows = await tx.vpCase.findMany({ where: { providerId: ctx.providerId, ...(f.status ? { status: f.status as CaseStatus } : {}) }, orderBy: [{ acceptBy: "asc" }, { requiredBy: "asc" }, { createdAt: "desc" }], select: { ref: true, status: true, propertyAddress: true, state: true, services: true, priority: true, requiredBy: true, acceptBy: true, officerId: true, reviewerId: true, createdAt: true } });
    const now = new Date();
    return { rows, counts: {
      offered: rows.filter((r) => r.status === "ASSIGNED").length,
      working: rows.filter((r) => ["ACCEPTED", "DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS"].includes(r.status)).length,
      inspections: rows.filter((r) => r.status === "FIELD_INSPECTION").length,
      drafting: rows.filter((r) => ["REPORT_DRAFT", "CORRECTION_REQUIRED"].includes(r.status)).length,
      inReview: rows.filter((r) => r.status === "INTERNAL_REVIEW").length,
      withHousy: rows.filter((r) => ["SUBMITTED_TO_HOUSY", "PLATFORM_REVIEW", "APPROVED_FOR_RELEASE"].includes(r.status)).length,
      done: rows.filter((r) => ["DELIVERED", "COMPLETED"].includes(r.status)).length,
      overdue: rows.filter((r) => r.requiredBy && r.requiredBy < now && !["DELIVERED", "COMPLETED", "CANCELLED", "REJECTED"].includes(r.status)).length,
    } };
  });
}

export async function providerCaseContext(userId: string, ref: string) {
  if (!isCaseRef(ref)) return null;
  const pid = await system((tx) => tx.vpCase.findUnique({ where: { ref }, select: { providerId: true } }));
  if (!pid?.providerId) return null;
  const p = await prisma.serviceProvider.findUnique({ where: { id: pid.providerId }, select: { providerCode: true } });
  return p?.providerCode ? providerContext(userId, p.providerCode) : null;
}

/** The provider's view of one case. Row-level security decides what this person may see (investigators: their own cases). */
export async function caseForProvider(ctx: VpCtx, ref: string) {
  return withUser(ctx.userId, async (tx) => {
    const c = await tx.vpCase.findFirst({ where: { ref, providerId: ctx.providerId } });
    if (!c) return null;
    const [activities, files, inspections, report, offer, staff] = await Promise.all([
      tx.vpCaseActivity.findMany({ where: { caseId: c.id }, orderBy: { createdAt: "asc" } }),
      tx.vpCaseFile.findMany({ where: { caseId: c.id }, select: { id: true, kind: true, basis: true, title: true, caption: true, fileName: true, sizeBytes: true, uploaderKind: true, uploadedById: true, lat: true, lng: true, takenAt: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      tx.vpInspection.findMany({ where: { caseId: c.id }, orderBy: { scheduledFor: "asc" } }),
      tx.vpReport.findFirst({ where: { caseId: c.id }, include: { versions: { orderBy: { version: "desc" } } } }),
      tx.vpAssignment.findFirst({ where: { caseId: c.id, providerId: ctx.providerId }, orderBy: { createdAt: "desc" } }),
      tx.providerMember.findMany({ where: { providerId: ctx.providerId, status: "ACTIVE" }, select: { userId: true, role: true } }),
    ]);
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...staff.map((s) => s.userId), c.requesterId, ...activities.map((a) => a.actorId)])] } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      ...c, activities: activities.map((a) => ({ ...a, actor: a.actorId === SYSTEM ? "Housy" : names.get(a.actorId) ?? a.actorKind })), files, inspections, report, offer,
      requesterName: names.get(c.requesterId) ?? "The customer",
      staff: staff.map((s) => ({ userId: s.userId, role: s.role as VpRole, name: names.get(s.userId) ?? "" })),
    };
  });
}

async function providerCase(tx: Tx, ctx: VpCtx, ref: string) {
  const c = await tx.vpCase.findFirst({ where: { ref, providerId: ctx.providerId } });
  if (!c) throw new Error("That case was not found.");
  return c;
}
function mayWork(ctx: VpCtx, c: { officerId: string | null }) {
  if (!vpCan(ctx.role, "case.work")) throw new Error("Your role in this organisation does not allow that.");
  if (ctx.role === "INVESTIGATOR" && c.officerId !== ctx.userId) throw new Error("This case is assigned to someone else.");
}
function active(ctx: VpCtx) { if (!ctx.active) throw new Error("This organisation is suspended on Housy, so no work can be done until the suspension is lifted."); }

/** Accept or decline an offered case. Declining needs a reason; a declared conflict of interest declines and records it. */
export async function answerOffer(ctx: VpCtx, ref: string, accept: boolean, reason: string, conflict = false) {
  if (!vpCan(ctx.role, "case.accept")) throw new Error("Your role in this organisation does not allow that.");
  active(ctx);
  const text = accept ? reason.trim().slice(0, 1000) : z.string().trim().min(10, "Give the reason for declining (10 characters or more)").max(1500).parse(reason);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    const to: CaseStatus = accept ? "ACCEPTED" : "READY_FOR_ASSIGNMENT";
    if (!canMoveCase(c.status as CaseStatus, to, mover(ctx))) throw new Error("This case is not waiting for your answer.");
    const offer = await tx.vpAssignment.findFirst({ where: { caseId: c.id, providerId: ctx.providerId, status: "OFFERED" } });
    if (!offer) throw new Error("This offer is no longer open.");
    await tx.vpAssignment.update({ where: { id: offer.id }, data: { status: accept ? "ACCEPTED" : "DECLINED", declineReason: accept ? "" : text, decidedAt: new Date(), decidedById: ctx.userId } });
    if (conflict && !accept) await tx.vpConflict.create({ data: { providerId: ctx.providerId, caseId: c.id, declaredById: ctx.userId, description: text } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: accept ? "accepted" : conflict ? "declined_conflict" : "declined", from: c.status, to, note: text, visible: accept });
    if (accept) await tx.vpCase.update({ where: { id: c.id }, data: { status: to, acceptBy: null } });
    else {
      // A declined case goes back to Housy, so the provider can no longer read it, and row-level security refuses an update
      // whose result the person could not read. Everything above was checked under the provider's own access (the case is
      // theirs, the offer open, their role may answer it); handing the case back is then done as Housy, in the same
      // transaction, and the trigger still checks the move.
      await tx.$queryRaw`SELECT set_config('app.platform_admin', 'on', true)`;
      await tx.vpCase.update({ where: { id: c.id }, data: { status: to, providerId: null, acceptBy: null, officerId: null, reviewerId: null } });
      await tx.$queryRaw`SELECT set_config('app.platform_admin', '', true)`;
    }
  });
  await system((tx) => notifyAdmins(tx, { kind: "verification.case", title: `Case ${ref} ${accept ? "accepted" : "declined"}`, body: accept ? "The provider accepted the case." : `Reason: ${text.slice(0, 200)}. Offer it to another provider.`, link: `/admin/verification/cases/${ref}` }));
  if (accept) await system(async (tx) => { const c = await tx.vpCase.findUnique({ where: { ref }, select: { requesterId: true } }); if (c) await notify(tx, c.requesterId, { kind: "verification.case", title: `Verification ${ref}: provider found`, body: "A qualified provider has accepted your case and will start with the documents.", link: `/verification/cases/${ref}` }); });
}

/** Give the case to an officer (who does the work) and a reviewer (who approves the report): two different people. */
export async function assignStaff(ctx: VpCtx, ref: string, officerId: string | null, reviewerId: string | null) {
  if (!vpCan(ctx.role, "case.assign")) throw new Error("Your role in this organisation does not allow that.");
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    const members = await tx.providerMember.findMany({ where: { providerId: ctx.providerId, status: "ACTIVE" }, select: { userId: true, role: true } });
    const role = (id: string) => members.find((m) => m.userId === id)?.role as VpRole | undefined;
    if (officerId && !(role(officerId) && vpCan(role(officerId)!, "case.work"))) throw new Error("The officer must be an active member whose role can work on cases.");
    if (reviewerId && !(role(reviewerId) && vpCan(role(reviewerId)!, "case.review"))) throw new Error("The reviewer must be an active member whose role can review reports.");
    if (officerId && reviewerId && officerId === reviewerId) throw new Error("The officer and the reviewer must be different people, so no one approves their own report.");
    await tx.vpCase.update({ where: { id: c.id }, data: { officerId, reviewerId } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "staff_assigned", visible: false });
    for (const [id, what] of [[officerId, "to work on"], [reviewerId, "to review"]] as const) if (id && id !== ctx.userId) await notify(tx, id, { kind: "verification.case", title: `Case ${ref} assigned to you`, body: `You have been given case ${ref} ${what}.`, link: `/provider/cases/${ref}` });
  });
}

const WORK_MOVES: CaseStatus[] = ["DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT"];

/** Move the case through the investigation. Asking the customer for information tells them what is needed. */
export async function moveProviderCase(ctx: VpCtx, ref: string, toInput: string, note: string) {
  const to = toInput as CaseStatus;
  if (!WORK_MOVES.includes(to)) throw new Error("Use the report steps to send a report for review.");
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    if (to !== "DOCUMENT_REVIEW" || c.status !== "ACCEPTED") mayWork(ctx, c);
    if (!canMoveCase(c.status as CaseStatus, to, mover(ctx))) throw new Error(`A case that is "${c.status.toLowerCase().replace(/_/g, " ")}" cannot move to "${to.toLowerCase().replace(/_/g, " ")}".`);
    const text = to === "INFORMATION_REQUIRED" ? z.string().trim().min(10, "Say what you need from the customer (10 characters or more)").max(3000).parse(note) : note.trim().slice(0, 2000);
    await tx.vpCase.update({ where: { id: c.id }, data: { status: to, ...(to === "INFORMATION_REQUIRED" ? { infoRequest: text } : {}) } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: to.toLowerCase(), from: c.status, to, note: text, visible: true });
    if (to === "INFORMATION_REQUIRED") await system((t2) => notify(t2, c.requesterId, { kind: "verification.case", title: `Verification ${ref}: information needed`, body: text.slice(0, 300), link: `/verification/cases/${ref}` }));
  });
}

const evidenceSchema = z.object({
  kind: z.enum(["EVIDENCE", "PHOTO", "REGISTRY_RESULT", "OTHER"]),
  basis: z.enum(FINDING_BASES.map((b) => b[0]) as [string, ...string[]], { message: "Say what kind of finding this supports" }),
  title: z.string().trim().min(2, "Give the evidence a title").max(160),
  caption: z.string().trim().max(1000).default(""),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  takenAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Enter when it was taken as a date").optional(),
});

export async function addEvidence(ctx: VpCtx, ref: string, input: z.input<typeof evidenceSchema>, file: { name: string; type: string; bytes: Uint8Array }) {
  const d = evidenceSchema.parse(input);
  validateUpload(file.type, file.bytes);
  active(ctx);
  await limited(`vr-evidence:${ctx.userId}`, 120);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    mayWork(ctx, c);
    if (!["DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "CORRECTION_REQUIRED"].includes(c.status)) throw new Error("Evidence can be added while the investigation and report are under way.");
    await tx.vpCaseFile.create({ data: { caseId: c.id, providerId: ctx.providerId, kind: d.kind, basis: d.basis, title: d.title, caption: d.caption, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, bytes: Buffer.from(file.bytes), sha256: sha256(file.bytes), lat: d.lat ?? null, lng: d.lng ?? null, takenAt: d.takenAt ? new Date(d.takenAt.length === 10 ? `${d.takenAt}T12:00:00+01:00` : `${d.takenAt}:00+01:00`) : null, uploadedById: ctx.userId, uploaderKind: "provider" }, select: { id: true } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "evidence_added", note: d.title, visible: false });
  });
}

export async function scheduleInspection(ctx: VpCtx, ref: string, when: string, officerId: string | null, notes: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) throw new Error("Enter the inspection date and time.");
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    mayWork(ctx, c);
    const officer = officerId || c.officerId || ctx.userId;
    await tx.vpInspection.create({ data: { caseId: c.id, providerId: ctx.providerId, officerId: officer, scheduledFor: new Date(`${when}:00+01:00`), notes: notes.trim().slice(0, 2000) } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "inspection_scheduled", note: `Site visit ${when.replace("T", " ")}`, visible: true });
  });
}

export async function completeInspection(ctx: VpCtx, ref: string, inspectionId: string, notes: string) {
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    mayWork(ctx, c);
    const n = await tx.vpInspection.updateMany({ where: { id: inspectionId, caseId: c.id, completedAt: null }, data: { completedAt: new Date(), notes: z.string().trim().min(5, "Record what was found on site (5 characters or more)").max(3000).parse(notes) } });
    if (!n.count) throw new Error("That inspection was not found or is already recorded.");
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "inspection_completed", visible: true });
  });
}

/** A file on a case, for whoever may see it (the customer their own documents; the provider's staff; Housy's administrators). */
export async function caseFile(userId: string, fileId: string, isAdmin: boolean) {
  const run = isAdmin ? <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(userId, fn) : <T>(fn: (tx: Tx) => Promise<T>) => withUser(userId, fn);
  return run(async (tx) => {
    const f = await tx.vpCaseFile.findFirst({ where: { id: fileId }, select: { fileName: true, mimeType: true, bytes: true } });
    return f ? { name: f.fileName, type: f.mimeType, bytes: Buffer.from(f.bytes) } : null;
  });
}

// ============================== Stage 6: the report ==============================

const contentSchema = z.object({
  scope: z.string().trim().max(3000).default(""),
  documentsExamined: z.string().trim().max(3000).default(""),
  sourcesConsulted: z.string().trim().max(3000).default(""),
  registrySearch: z.string().trim().max(3000).default(""),
  siteInspection: z.string().trim().max(3000).default(""),
  findings: z.array(z.object({ basis: z.enum(FINDING_BASES.map((b) => b[0]) as [string, ...string[]]), text: z.string().trim().max(2000) })).max(40).default([]).transform((a) => a.filter((f) => f.text)),
  risks: z.string().trim().max(3000).default(""),
  limitations: z.string().trim().max(3000).default(""),
  outstanding: z.string().trim().max(3000).default(""),
  observations: z.string().trim().max(3000).default(""),
  recommendations: z.string().trim().max(3000).default(""),
  conclusion: z.string().trim().max(3000).default(""),
  outcome: z.enum(OUTCOME_CODES as [string, ...string[]]).or(z.literal("")).default(""),
});

/** Save the report draft. Edits the open version; once a version has gone for approval, a correction starts a new one. */
export async function saveReportDraft(ctx: VpCtx, ref: string, input: z.input<typeof contentSchema>) {
  const content = contentSchema.parse(input);
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    mayWork(ctx, c);
    if (!["INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "CORRECTION_REQUIRED"].includes(c.status)) throw new Error("The report can be written once the investigation is under way, and changed while it is a draft or being corrected.");
    let report = await tx.vpReport.findFirst({ where: { caseId: c.id } });
    if (!report) report = await tx.vpReport.create({ data: { caseId: c.id, providerId: ctx.providerId, publicRef: publicRef() } });
    const latest = await tx.vpReportVersion.findFirst({ where: { reportId: report.id }, orderBy: { version: "desc" } });
    if (latest && !latest.providerApprovedAt) {
      await tx.vpReportVersion.update({ where: { id: latest.id }, data: { content: content as never, outcome: content.outcome, preparedById: ctx.userId } });
    } else {
      const released = latest?.releasedAt ? latest.version : null;
      await tx.vpReportVersion.create({ data: { reportId: report.id, caseId: c.id, providerId: ctx.providerId, version: (latest?.version ?? 0) + 1, content: content as never, outcome: content.outcome, preparedById: ctx.userId, correctionOf: released, correctionReason: released ? (c.closingNote || "Correction after release") : "" } });
    }
    if (c.status === "CORRECTION_REQUIRED") {
      await tx.vpCase.update({ where: { id: c.id }, data: { status: "REPORT_DRAFT" } });
      await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "correcting", from: c.status, to: "REPORT_DRAFT", visible: true });
    }
  });
}

/** Send the draft for the organisation's own professional review. It must be complete. */
export async function submitForInternalReview(ctx: VpCtx, ref: string) {
  active(ctx);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    mayWork(ctx, c);
    if (!canMoveCase(c.status as CaseStatus, "INTERNAL_REVIEW", mover(ctx))) throw new Error("Only a report draft can be sent for review.");
    if (!c.reviewerId) throw new Error("Choose a reviewer for the case first (someone other than the person who wrote the report).");
    const v = await tx.vpReportVersion.findFirst({ where: { caseId: c.id, providerApprovedAt: null }, orderBy: { version: "desc" } });
    if (!v) throw new Error("Write the report first.");
    const gaps = reportGaps(v.content as Partial<ReportContent>);
    if (gaps.length) throw new Error(`The report is not complete: ${gaps.join(". ")}.`);
    if (v.preparedById === c.reviewerId) throw new Error("The reviewer wrote this version. Choose a different reviewer, so no one approves their own report.");
    await tx.vpCase.update({ where: { id: c.id }, data: { status: "INTERNAL_REVIEW" } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: "sent_for_internal_review", from: c.status, to: "INTERNAL_REVIEW", visible: true });
    await notify(tx, c.reviewerId, { kind: "verification.case", title: `Report for ${ref} needs your review`, body: "Approve it for Housy or send it back with corrections.", link: `/provider/cases/${ref}` });
  });
}

/** The reviewer approves the report for Housy, or sends it back. Nobody approves a version they wrote. */
export async function reviewerDecision(ctx: VpCtx, ref: string, approve: boolean, note: string) {
  if (!vpCan(ctx.role, "case.review")) throw new Error("Your role in this organisation does not allow that.");
  active(ctx);
  const text = approve ? note.trim().slice(0, 2000) : z.string().trim().min(10, "Say what must be corrected (10 characters or more)").max(3000).parse(note);
  await withUser(ctx.userId, async (tx) => {
    const c = await providerCase(tx, ctx, ref);
    const to: CaseStatus = approve ? "SUBMITTED_TO_HOUSY" : "CORRECTION_REQUIRED";
    if (!canMoveCase(c.status as CaseStatus, to, mover(ctx))) throw new Error("This report is not waiting for review.");
    if (c.reviewerId && c.reviewerId !== ctx.userId && !["OWNER", "ADMIN"].includes(ctx.role)) throw new Error("This report is assigned to another reviewer.");
    const v = await tx.vpReportVersion.findFirst({ where: { caseId: c.id, providerApprovedAt: null }, orderBy: { version: "desc" } });
    if (!v) throw new Error("There is no report version to review.");
    if (v.preparedById === ctx.userId) throw new Error("You wrote this version, so someone else must review it.");
    if (approve) await tx.vpReportVersion.update({ where: { id: v.id }, data: { reviewedById: ctx.userId, reviewNote: text, providerApprovedAt: new Date() } });
    else await tx.vpReportVersion.update({ where: { id: v.id }, data: { reviewNote: text } });
    await tx.vpCase.update({ where: { id: c.id }, data: { status: to } });
    await activity(tx, { caseId: c.id, providerId: ctx.providerId, actorId: ctx.userId, actorKind: "provider", action: approve ? "submitted_to_housy" : "correction_requested", from: c.status, to, note: text, visible: approve });
    if (!approve && c.officerId) await notify(tx, c.officerId, { kind: "verification.case", title: `Report for ${ref} sent back`, body: text.slice(0, 300), link: `/provider/cases/${ref}` });
  });
  if (approve) await system((tx) => notifyAdmins(tx, { kind: "verification.case", title: `Report for ${ref} submitted to Housy`, body: "Ready for Housy's quality and compliance review.", link: `/admin/verification/cases/${ref}` }));
}

// ---------- Housy's review, release, correction and revocation ----------

export async function startPlatformReview(adminId: string, ref: string) {
  await withPlatformAdmin(adminId, (tx) => platformMove(tx, adminId, ref, "PLATFORM_REVIEW", "platform_review_started", "", {}, true));
}

/** Housy's quality and compliance review: approve for release, or send back to the provider for correction. */
export async function platformDecision(adminId: string, ref: string, approve: boolean, note: string) {
  const text = approve ? note.trim().slice(0, 2000) : z.string().trim().min(10, "Say what the provider must correct (10 characters or more)").max(3000).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, providerId: true } });
    if (!c) throw new Error("That case was not found.");
    const v = await tx.vpReportVersion.findFirst({ where: { caseId: c.id, providerApprovedAt: { not: null }, platformApprovedAt: null, releasedAt: null }, orderBy: { version: "desc" } });
    // Sending back needs no pending version: after a dispute is reopened the released version stays as it is and the
    // provider issues a corrected one.
    if (!v && approve) throw new Error("There is no report version waiting for Housy's review.");
    if (approve && v) await tx.vpReportVersion.update({ where: { id: v.id }, data: { platformReviewerId: adminId, platformNote: text, platformApprovedAt: new Date() } });
    await platformMove(tx, adminId, ref, approve ? "APPROVED_FOR_RELEASE" : "CORRECTION_REQUIRED", approve ? "approved_for_release" : "platform_correction_requested", text, approve ? {} : { closingNote: text }, approve);
    if (!approve && c.providerId) await notifyProviderLeads(tx, c.providerId, { kind: "verification.case", title: `Housy sent back the report for ${ref}`, body: text.slice(0, 300), link: `/provider/cases/${ref}` });
  });
}

/** Release the approved version to the customer: fingerprinted, fixed for ever; the version it corrects is marked superseded. */
export async function releaseReport(adminId: string, ref: string) {
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, providerId: true, requesterId: true, status: true } });
    if (!c || !canMoveCase(c.status as CaseStatus, "DELIVERED", { kind: "platform" })) throw new Error("Only a report approved for release can be released.");
    const report = await tx.vpReport.findFirstOrThrow({ where: { caseId: c.id } });
    const v = await tx.vpReportVersion.findFirst({ where: { reportId: report.id, platformApprovedAt: { not: null }, releasedAt: null }, orderBy: { version: "desc" } });
    if (!v || !v.providerApprovedAt || !v.reviewedById) throw new Error("There is no approved version to release.");
    const provider = await tx.serviceProvider.findUniqueOrThrow({ where: { id: report.providerId }, select: { providerCode: true } });
    const [prep, rev] = await Promise.all([tx.user.findUnique({ where: { id: v.preparedById }, select: { name: true } }), tx.user.findUnique({ where: { id: v.reviewedById }, select: { name: true } })]);
    const fingerprint = sha256(canonicalReport({ caseRef: ref, providerCode: provider.providerCode ?? "", version: v.version, content: v.content as ReportContent, preparedBy: prep?.name ?? "", reviewedBy: rev?.name ?? "", approvedAt: v.providerApprovedAt.toISOString() }));
    const now = new Date();
    await tx.vpReportVersion.updateMany({ where: { reportId: report.id, releasedAt: { not: null }, supersededAt: null }, data: { supersededAt: now } });
    await tx.vpReportVersion.update({ where: { id: v.id }, data: { releasedAt: now, sha256: fingerprint } });
    await tx.vpReport.update({ where: { id: report.id }, data: { releasedVersion: v.version } });
    await platformMove(tx, adminId, ref, "DELIVERED", "report_released", `Version ${v.version}`, { deliveredAt: now });
    await earningOnRelease(tx, c.id, now);
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Your verification report for ${ref} is ready`, body: "Download it from the request page. Anyone can check it is genuine with its report reference.", link: `/verification/cases/${ref}` });
    if (c.providerId) await notifyProviderLeads(tx, c.providerId, { kind: "verification.case", title: `Report for ${ref} released`, body: `Version ${v.version} was delivered to the customer.`, link: `/provider/cases/${ref}` });
  });
}

/** Revoke the released report (it must not be relied on). Kept on record; the public check shows it as revoked. */
export async function revokeReport(adminId: string, ref: string, reason: string) {
  const text = z.string().trim().min(10, "Give the reason (10 characters or more): it is shown to anyone who checks the report").max(1500).parse(reason);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.vpCase.findUnique({ where: { ref }, select: { id: true, requesterId: true, providerId: true } });
    if (!c) throw new Error("That case was not found.");
    const v = await tx.vpReportVersion.findFirst({ where: { caseId: c.id, releasedAt: { not: null }, supersededAt: null, revokedAt: null }, orderBy: { version: "desc" } });
    if (!v) throw new Error("There is no current released report to revoke.");
    await tx.vpReportVersion.update({ where: { id: v.id }, data: { revokedAt: new Date(), revokedReason: text } });
    await holdEarning(tx, c.id, `Report revoked: ${text}`);
    await activity(tx, { caseId: c.id, providerId: c.providerId, actorId: adminId, actorKind: "platform", action: "report_revoked", note: text, visible: true });
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Report for ${ref} revoked`, body: text.slice(0, 300), link: `/verification/cases/${ref}` });
  });
}

/** A dispute goes back to Housy's review (where a correction can follow), or is closed. */
export async function resolveDispute(adminId: string, ref: string, reopen: boolean, note: string) {
  const text = z.string().trim().min(10, "Record the decision (10 characters or more): the customer sees it").max(3000).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await platformMove(tx, adminId, ref, reopen ? "PLATFORM_REVIEW" : "COMPLETED", reopen ? "dispute_reopened" : "dispute_closed", text, reopen ? {} : { completedAt: new Date(), closingNote: text });
    if (!reopen) await earningPayable(tx, c.id, adminId, new Date());
    await notify(tx, c.requesterId, { kind: "verification.case", title: `Your dispute on ${ref}`, body: text.slice(0, 300), link: `/verification/cases/${ref}` });
  });
}

/**
 * After Housy reopens a delivered report (dispute or correction), the provider issues a corrected version: Housy sends the
 * case back for correction, the provider drafts version n+1 (which records what it corrects), and the usual reviews follow.
 */
export async function requestCorrectionAfterRelease(adminId: string, ref: string, reason: string) {
  await platformDecision(adminId, ref, false, reason);
}

// ---------- Reading and checking reports ----------

type Who = { userId: string; isAdmin: boolean };

/** The PDF of a report version, for the customer (released versions), the provider's staff and Housy's administrators. */
export async function reportPdf(who: Who, publicRefValue: string, version: number, base: string) {
  const run = who.isAdmin ? <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(who.userId, fn) : <T>(fn: (tx: Tx) => Promise<T>) => withUser(who.userId, fn);
  return run(async (tx) => {
    const report = await tx.vpReport.findFirst({ where: { publicRef: publicRefValue } });
    if (!report) return null;
    const v = await tx.vpReportVersion.findFirst({ where: { reportId: report.id, version } });
    if (!v) return null;
    const c = await system((t2) => t2.vpCase.findUniqueOrThrow({ where: { id: report.caseId }, select: { ref: true, propertyAddress: true, state: true, propertyType: true, requesterId: true } }));
    const p = await prisma.serviceProvider.findUniqueOrThrow({ where: { id: report.providerId }, select: { name: true, legalName: true, providerCode: true, cacNumber: true } });
    const people = await prisma.user.findMany({ where: { id: { in: [v.preparedById, v.reviewedById, v.platformReviewerId, c.requesterId].filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const name = (id: string | null) => people.find((x) => x.id === id)?.name ?? "";
    const status = v.revokedAt ? "revoked" : v.supersededAt ? "superseded" : v.releasedAt ? "current" : "draft";
    const bytes = renderVerificationReport({
      caseRef: c.ref, publicRef: report.publicRef, version: v.version,
      provider: { name: p.name, legalName: p.legalName, code: p.providerCode ?? "", cac: p.cacNumber },
      property: { address: c.propertyAddress, state: c.state, type: c.propertyType.toLowerCase().replace(/_/g, " ") },
      requester: name(c.requesterId), content: v.content as ReportContent,
      preparedBy: { name: name(v.preparedById), credentials: "" }, reviewedBy: name(v.reviewedById), providerApprovedAt: v.providerApprovedAt ?? v.createdAt,
      platformReviewer: "", platformApprovedAt: v.platformApprovedAt, releasedAt: v.releasedAt, sha256: v.sha256,
      verifyUrl: `${base}/verification/check/${report.publicRef}`, status, correctionOf: v.correctionOf, correctionReason: v.correctionReason,
    });
    return { bytes, name: `${report.publicRef}-v${v.version}.pdf` };
  });
}

/** The public check: is this report genuine, which version is current, and has it been revoked? Nothing confidential. */
export async function checkReport(publicRefValue: string) {
  if (!/^VR-[A-Z2-9]{10}$/.test(publicRefValue)) return null;
  return system(async (tx) => {
    const report = await tx.vpReport.findFirst({ where: { publicRef: publicRefValue }, select: { id: true, providerId: true, caseId: true } });
    if (!report) return null;
    const versions = await tx.vpReportVersion.findMany({ where: { reportId: report.id, releasedAt: { not: null } }, orderBy: { version: "desc" }, select: { version: true, outcome: true, releasedAt: true, sha256: true, supersededAt: true, revokedAt: true, revokedReason: true } });
    if (!versions.length) return null;
    const p = await tx.serviceProvider.findUnique({ where: { id: report.providerId }, select: { name: true, providerCode: true, suspendedAt: true } });
    const c = await tx.vpCase.findUnique({ where: { id: report.caseId }, select: { ref: true, state: true, propertyType: true } });
    return { publicRef: publicRefValue, provider: p, caseRef: c?.ref, state: c?.state, propertyType: c?.propertyType, versions };
  });
}

/** Providers a customer may choose from for given services and state (the same eligibility as Housy uses). */
export async function eligibleProvidersFor(services: string[], state: string) {
  const list = await system(async (tx) => rankProviders({ services, state }, await candidates(tx, { id: "00000000-0000-0000-0000-000000000000", services, state })));
  return list.filter((p) => p.eligible).map((p) => ({ providerId: p.providerId, name: p.name, priceKobo: p.priceKobo, turnaroundDays: p.turnaroundDays }));
}

/** What a listing says about where a property is, to start a verification request from it. */
export async function listingForRequest(ref: string) {
  if (!ref || ref.length > 40) return null;
  const l = await withPublic((tx) => tx.listing.findFirst({ where: { publicRef: ref, status: "PUBLISHED" }, select: { publicRef: true, title: true, city: true, state: true, propertyType: true } }));
  if (!l) return null;
  const type = (PROPERTY_TYPES as readonly string[]).includes(l.propertyType) ? l.propertyType : l.propertyType === "PLOT" ? "UNDEVELOPED_PLOT" : "";
  return { ref: l.publicRef, title: l.title, address: `${l.title}, ${l.city}`, state: STATE_NAMES.includes(l.state) ? l.state : "", propertyType: type };
}
