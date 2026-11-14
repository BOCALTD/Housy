import { assertNotBlocked } from "./account-moderation";
/**
 * The verification network, stages 1 to 3 (docs/VERIFICATION-NETWORK.md):
 *  1. Organisations apply to become verification partners; Housy reviews, asks for more, approves or rejects.
 *  2. Approval creates (or, for a provider already listed, links) the provider organisation with a permanent provider ID
 *     and sends its authorised representative an invitation to activate it as owner. Approval comes before activation.
 *  3. Each organisation runs its own staff in six roles; what each may do is checked here on every call and again by the
 *     database's row-level security, so one provider never sees another's records.
 *
 * Every provider uses exactly these functions: there is nothing here for any one provider.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, withInviteToken, withInviteTokenAs, withPlatformAdmin, withPublic, withUser, type Tx } from "../db";
import { notify } from "./notifications";
import { logActivity } from "../audit";
import { hashPassword } from "../auth-hash";
import { hashToken, newToken } from "../tokens";
import { rateLimit } from "../ratelimit";
import { validateUpload } from "../storage";
import { STATES } from "../geo-rules";
import {
  APPLICATION_PARTS, DOC_KINDS, SERVICE_CODES, VP_ROLES, VP_ROLE_LABELS, applicantMayEdit, applicationRef, canMoveApplication,
  isApplicationRef, isProviderCode, mayManageRole, missingForSubmit, providerCode, vpCan,
  type ApplicationAnswers, type ApplicationStatus, type PartKey, type VpAction, type VpRole,
} from "../verification-network-rules";

const SYSTEM = "system";
const system = <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(SYSTEM, fn);
const STATE_NAMES = STATES.map((s) => s.name);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const INVITE_DAYS = 14;

async function limited(key: string, n: number, windowMs = 3_600_000) {
  if (!(await rateLimit(key, n, windowMs))) throw new Error("Too many attempts just now. Wait a little and try again.");
}

async function notifyAdmins(tx: Tx, n: Parameters<typeof notify>[2]) {
  const admins = await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 });
  for (const a of admins) await notify(tx, a.id, n);
}

// ============================== Stage 1: applications ==============================

const appSelect = { id: true, ref: true, status: true, registeredName: true, cacNumber: true, country: true, services: true, states: true, answers: true, infoRequest: true, decisionReason: true, submittedAt: true, decidedAt: true, providerId: true, createdAt: true, updatedAt: true, applicantId: true } as const;
const docMeta = { id: true, kind: true, title: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, expiresOn: true, createdAt: true, uploadedById: true } as const;

/** Start an application, or carry on with the one already open (one open application per person at a time). */
export async function startApplication(userId: string) {
  const open = await withUser(userId, (tx) => tx.vpApplication.findFirst({ where: { applicantId: userId, status: { notIn: ["APPROVED", "REJECTED", "WITHDRAWN"] } }, select: { ref: true } }));
  if (open) return open.ref;
  await limited(`vpa-start:${userId}`, 5, 86_400_000);
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = await system((tx) => tx.vpApplication.count({ where: { ref: { startsWith: `VPA-${year}-` } } }));
    const ref = applicationRef(year, n + 1 + attempt);
    try {
      await withUser(userId, async (tx) => {
        const a = await tx.vpApplication.create({ data: { ref, applicantId: userId }, select: { id: true } });
        await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: userId, action: "started", toStatus: "DRAFT" } });
      });
      return ref;
    } catch (e) { if ((e as { code?: string }).code !== "P2002") throw e; }
  }
  throw new Error("Could not start the application just now. Try again.");
}

export async function myApplications(userId: string) {
  return withUser(userId, (tx) => tx.vpApplication.findMany({ where: { applicantId: userId }, orderBy: { createdAt: "desc" }, select: { ref: true, status: true, registeredName: true, submittedAt: true, decidedAt: true, createdAt: true, providerId: true } }));
}

/** The applicant's view: answers, documents (no file contents) and the history without Housy's internal notes. */
export async function applicationForApplicant(userId: string, ref: string) {
  if (!isApplicationRef(ref)) return null;
  return withUser(userId, async (tx) => {
    const a = await tx.vpApplication.findFirst({ where: { ref, applicantId: userId }, select: appSelect });
    if (!a) return null;
    const [documents, events] = await Promise.all([
      tx.vpDocument.findMany({ where: { applicationId: a.id }, select: docMeta, orderBy: { createdAt: "asc" } }),
      tx.vpApplicationEvent.findMany({ where: { applicationId: a.id, internal: false }, orderBy: { createdAt: "asc" }, select: { action: true, fromStatus: true, toStatus: true, note: true, createdAt: true } }),
    ]);
    return { ...a, answers: a.answers as ApplicationAnswers, documents, events, missing: missingForSubmit(a.answers as ApplicationAnswers, documents.map((d) => d.kind)) };
  });
}

async function editableApplication(tx: Tx, userId: string, ref: string) {
  const a = await tx.vpApplication.findFirst({ where: { ref, applicantId: userId }, select: { id: true, status: true, answers: true } });
  if (!a) throw new Error("That application was not found.");
  if (!applicantMayEdit(a.status as ApplicationStatus)) throw new Error("This application has been sent and cannot be changed now. If Housy needs anything, it will ask you here.");
  return a;
}

/** Save one part of the answers. The part is checked in full; the others stay as they were. */
export async function saveApplicationPart(userId: string, ref: string, part: PartKey, raw: unknown) {
  const def = APPLICATION_PARTS.find((p) => p.key === part);
  if (!def) throw new Error("That part of the application does not exist.");
  const parsed = def.schema.parse(raw);
  if (part === "operations") {
    const states = (parsed as { states: string[] }).states;
    const bad = states.filter((s) => !STATE_NAMES.includes(s));
    if (bad.length) throw new Error(`Choose states from the list (not recognised: ${bad.slice(0, 3).join(", ")})`);
  }
  await withUser(userId, async (tx) => {
    const a = await editableApplication(tx, userId, ref);
    const answers = { ...(a.answers as ApplicationAnswers), [part]: parsed } as ApplicationAnswers;
    await tx.vpApplication.update({
      where: { id: a.id },
      data: {
        answers: answers as never,
        registeredName: answers.corporate?.registeredName ?? "",
        cacNumber: answers.corporate?.cacNumber ?? "",
        country: answers.corporate?.country ?? "",
        services: answers.qualifications?.services ?? [],
        states: answers.operations?.states ?? [],
      },
    });
  });
}

export async function addApplicationDocument(userId: string, ref: string, input: { kind: string; title: string; expiresOn: string }, file: { name: string; type: string; bytes: Uint8Array }) {
  const kind = z.enum(DOC_KINDS.map((d) => d[0]) as [string, ...string[]], { message: "Choose what kind of document this is" }).parse(input.kind);
  const title = z.string().trim().max(160).parse(input.title);
  const expiresOn = input.expiresOn ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expiry date as YYYY-MM-DD").parse(input.expiresOn) : null;
  validateUpload(file.type, file.bytes);
  await limited(`vpa-doc:${userId}`, 60);
  await withUser(userId, async (tx) => {
    const a = await editableApplication(tx, userId, ref);
    if ((await tx.vpDocument.count({ where: { applicationId: a.id } })) >= 30) throw new Error("An application can hold up to 30 documents. Remove one before adding another.");
    await tx.vpDocument.create({
      data: { applicationId: a.id, kind, title: title || DOC_KINDS.find((d) => d[0] === kind)![1], fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, bytes: Buffer.from(file.bytes), sha256: sha256(file.bytes), expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00Z`) : null, uploadedById: userId },
      select: { id: true },
    });
  });
}

export async function removeApplicationDocument(userId: string, ref: string, documentId: string) {
  await withUser(userId, async (tx) => {
    const a = await editableApplication(tx, userId, ref);
    const n = await tx.vpDocument.deleteMany({ where: { id: documentId, applicationId: a.id } });
    if (!n.count) throw new Error("That document was not found.");
  });
}

/** Send the application (or send it again after Housy asked for more). Everything required must be there. */
export async function submitApplication(userId: string, ref: string, note = "") {
  await limited(`vpa-submit:${userId}`, 10);
  await withUser(userId, async (tx) => {
    const a = await tx.vpApplication.findFirst({ where: { ref, applicantId: userId }, select: { id: true, status: true, answers: true, registeredName: true } });
    if (!a) throw new Error("That application was not found.");
    const from = a.status as ApplicationStatus;
    const to: ApplicationStatus = from === "ADDITIONAL_INFORMATION_REQUIRED" ? "RESUBMITTED" : "SUBMITTED";
    if (!canMoveApplication(from, to, "applicant")) throw new Error("This application has already been sent.");
    const docs = await tx.vpDocument.findMany({ where: { applicationId: a.id }, select: { kind: true } });
    const missing = missingForSubmit(a.answers as ApplicationAnswers, docs.map((d) => d.kind));
    if (missing.length) throw new Error(`Before sending: ${missing.slice(0, 3).join(". ")}${missing.length > 3 ? ` (and ${missing.length - 3} more)` : ""}.`);
    await tx.vpApplication.update({ where: { id: a.id }, data: { status: to, submittedAt: new Date() } });
    await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: userId, action: to === "RESUBMITTED" ? "resubmitted" : "submitted", fromStatus: from, toStatus: to, note: note.trim().slice(0, 1500) } });
    await notify(tx, userId, { kind: "verification.application", title: `Application ${ref} received`, body: `Thank you. Housy will review ${a.registeredName}'s application and tell you here. You can follow it at any time.`, link: `/verification-partners/applications/${ref}` });
  });
  await system((tx) => notifyAdmins(tx, { kind: "verification.application", title: `Verification partner application ${ref}`, body: "A new or updated application is waiting for review.", link: `/admin/verification/applications/${ref}` }));
}

export async function withdrawApplication(userId: string, ref: string, reason: string) {
  await withUser(userId, async (tx) => {
    const a = await tx.vpApplication.findFirst({ where: { ref, applicantId: userId }, select: { id: true, status: true } });
    if (!a) throw new Error("That application was not found.");
    if (!canMoveApplication(a.status as ApplicationStatus, "WITHDRAWN", "applicant")) throw new Error("This application can no longer be withdrawn.");
    await tx.vpApplication.update({ where: { id: a.id }, data: { status: "WITHDRAWN" } });
    await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: userId, action: "withdrawn", fromStatus: a.status, toStatus: "WITHDRAWN", note: reason.trim().slice(0, 1000) } });
  });
}

/** A document's file, for the person allowed to see it: the applicant, the organisation's members, or Housy's administrators. */
export async function documentFile(userId: string, documentId: string, isAdmin: boolean) {
  const run = isAdmin ? <T>(fn: (tx: Tx) => Promise<T>) => withPlatformAdmin(userId, fn) : <T>(fn: (tx: Tx) => Promise<T>) => withUser(userId, fn);
  return run(async (tx) => {
    const d = await tx.vpDocument.findFirst({ where: { id: documentId }, select: { fileName: true, mimeType: true, bytes: true, applicationId: true, providerId: true } });
    if (!d) return null;
    if (isAdmin && d.applicationId) await tx.vpApplicationEvent.create({ data: { applicationId: d.applicationId, actorId: userId, action: "document_viewed", note: d.fileName, internal: true } });
    if (isAdmin && d.providerId) await logActivity(tx, { companyId: null, actorId: userId, entityType: "verification_provider", entityId: d.providerId, action: "provider.document_viewed", detail: { file: d.fileName } });
    return { name: d.fileName, type: d.mimeType, bytes: Buffer.from(d.bytes) };
  });
}

// ---------- Housy's review ----------

export async function applicationsForAdmin(adminId: string, f: { status?: string; q?: string; state?: string; service?: string; page?: number }) {
  const page = Math.max(1, f.page ?? 1), size = 25;
  const where = {
    ...(f.status ? { status: f.status as ApplicationStatus } : { status: { not: "DRAFT" as const } }),
    ...(f.state ? { states: { has: f.state } } : {}),
    ...(f.service ? { services: { has: f.service } } : {}),
    ...(f.q ? { OR: [{ registeredName: { contains: f.q, mode: "insensitive" as const } }, { ref: { contains: f.q.toUpperCase() } }, { cacNumber: { contains: f.q.toUpperCase() } }] } : {}),
  };
  return withPlatformAdmin(adminId, async (tx) => {
    const [rows, total, counts] = await Promise.all([
      tx.vpApplication.findMany({ where, orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * size, take: size, select: { ref: true, status: true, registeredName: true, cacNumber: true, states: true, services: true, submittedAt: true, decidedAt: true } }),
      tx.vpApplication.count({ where }),
      tx.vpApplication.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    return { rows, total, page, size, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
  });
}

export async function applicationForAdmin(adminId: string, ref: string) {
  if (!isApplicationRef(ref)) return null;
  return withPlatformAdmin(adminId, async (tx) => {
    const a = await tx.vpApplication.findUnique({ where: { ref }, select: appSelect });
    if (!a) return null;
    const [documents, events, applicant, provider] = await Promise.all([
      tx.vpDocument.findMany({ where: { applicationId: a.id }, select: docMeta, orderBy: { createdAt: "asc" } }),
      tx.vpApplicationEvent.findMany({ where: { applicationId: a.id }, orderBy: { createdAt: "asc" }, select: { action: true, fromStatus: true, toStatus: true, note: true, internal: true, createdAt: true, actorId: true } }),
      tx.user.findUnique({ where: { id: a.applicantId }, select: { name: true, email: true } }),
      a.providerId ? tx.serviceProvider.findUnique({ where: { id: a.providerId }, select: { providerCode: true, name: true } }) : null,
    ]);
    const actors = await tx.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId))] } }, select: { id: true, name: true } });
    const names = new Map(actors.map((u) => [u.id, u.name]));
    return { ...a, answers: a.answers as ApplicationAnswers, documents, applicant, provider, events: events.map((e) => ({ ...e, actor: e.actorId === SYSTEM ? "Housy" : names.get(e.actorId) ?? "Someone" })), missing: missingForSubmit(a.answers as ApplicationAnswers, documents.map((d) => d.kind)) };
  });
}

/** Providers already listed that an approval may be linked to (for example one listed before applications existed). */
export async function unlinkedProviders(adminId: string) {
  return withPlatformAdmin(adminId, (tx) => tx.serviceProvider.findMany({ where: { application: null, providerCode: null }, select: { id: true, name: true, shortName: true }, orderBy: { name: "asc" } }));
}

async function moveByAdmin(tx: Tx, adminId: string, ref: string, to: ApplicationStatus, data: Record<string, unknown>, action: string, note: string, internal = false) {
  const a = await tx.vpApplication.findUnique({ where: { ref }, select: { id: true, status: true, applicantId: true, registeredName: true } });
  if (!a) throw new Error("That application was not found.");
  if (!canMoveApplication(a.status as ApplicationStatus, to, "admin")) throw new Error(`An application that is "${a.status.toLowerCase().replace(/_/g, " ")}" cannot be moved to "${to.toLowerCase().replace(/_/g, " ")}".`);
  await tx.vpApplication.update({ where: { id: a.id }, data: { status: to, ...data } });
  await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: adminId, action, fromStatus: a.status, toStatus: to, note: note.slice(0, 3000), internal } });
  return a;
}

export async function startReview(adminId: string, ref: string) {
  await withPlatformAdmin(adminId, async (tx) => {
    const a = await moveByAdmin(tx, adminId, ref, "UNDER_REVIEW", {}, "review_started", "");
    await notify(tx, a.applicantId, { kind: "verification.application", title: `Application ${ref} is being reviewed`, body: "Housy has started reviewing your application.", link: `/verification-partners/applications/${ref}` });
  });
}

export async function requestInformation(adminId: string, ref: string, message: string) {
  const text = z.string().trim().min(10, "Say what information or documents you need (10 characters or more)").max(3000).parse(message);
  await withPlatformAdmin(adminId, async (tx) => {
    const a = await moveByAdmin(tx, adminId, ref, "ADDITIONAL_INFORMATION_REQUIRED", { infoRequest: text }, "information_requested", text);
    await notify(tx, a.applicantId, { kind: "verification.application", title: `Housy needs more for application ${ref}`, body: text.slice(0, 300), link: `/verification-partners/applications/${ref}` });
  });
}

export async function addInternalNote(adminId: string, ref: string, note: string) {
  const text = z.string().trim().min(2, "Write the note").max(3000).parse(note);
  await withPlatformAdmin(adminId, async (tx) => {
    const a = await tx.vpApplication.findUnique({ where: { ref }, select: { id: true } });
    if (!a) throw new Error("That application was not found.");
    await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: adminId, action: "note", note: text, internal: true } });
  });
}

export async function rejectApplication(adminId: string, ref: string, reason: string) {
  const text = z.string().trim().min(10, "Give the reason for the decision (10 characters or more): the applicant sees it").max(3000).parse(reason);
  await withPlatformAdmin(adminId, async (tx) => {
    const a = await moveByAdmin(tx, adminId, ref, "REJECTED", { decisionReason: text, decidedAt: new Date(), decidedById: adminId }, "rejected", text);
    await notify(tx, a.applicantId, { kind: "verification.application", title: `Application ${ref}: not approved`, body: text.slice(0, 300), link: `/verification-partners/applications/${ref}` });
  });
}

const approveSchema = z.object({
  allowedServices: z.array(z.enum(SERVICE_CODES as [string, ...string[]])).min(1, "Choose at least one service the organisation is approved for"),
  allowedStates: z.array(z.string()).min(1, "Choose at least one state the organisation is approved for"),
  shortName: z.string().trim().min(2, "Enter a short name (shown on its dashboard and to customers)").max(40),
  linkProviderId: z.string().uuid().optional(),
  note: z.string().trim().max(3000).default(""),
});

/**
 * Approve: create (or link) the provider organisation with its permanent provider ID, record what it is approved for,
 * and invite the authorised representative to activate it as owner. Returns the invitation link's secret (shown once).
 */
export async function approveApplication(adminId: string, ref: string, input: z.input<typeof approveSchema>) {
  const data = approveSchema.parse(input);
  const badStates = data.allowedStates.filter((s) => !STATE_NAMES.includes(s));
  if (badStates.length) throw new Error("Choose states from the list.");
  const token = newToken();
  const out = await withPlatformAdmin(adminId, async (tx) => {
    const a = await tx.vpApplication.findUnique({ where: { ref }, select: { id: true, status: true, applicantId: true, answers: true, registeredName: true } });
    if (!a) throw new Error("That application was not found.");
    if (!canMoveApplication(a.status as ApplicationStatus, "APPROVED", "admin")) throw new Error("Only an application under review can be approved.");
    const ans = a.answers as ApplicationAnswers;
    const c = ans.corporate, o = ans.ownership;
    if (!c || !o) throw new Error("This application is missing its company or contact details.");
    const code = providerCode((await tx.serviceProvider.count({ where: { providerCode: { not: null } } })) + 1);
    const fields = {
      providerCode: code, legalName: c.registeredName, orgType: c.orgType, cacNumber: c.cacNumber, country: c.country,
      contactEmail: c.officialEmail, contactPhone: c.officialPhone, link: c.website, profile: c.profile.slice(0, 3000),
      allowedServices: data.allowedServices, allowedStates: data.allowedStates, vettedAt: new Date(), vettedById: adminId,
      status: "APPROVED" as const, suspendedAt: null, suspendedReason: "",
    };
    let providerId: string;
    if (data.linkProviderId) {
      const existing = await tx.serviceProvider.findFirst({ where: { id: data.linkProviderId, providerCode: null, application: null }, select: { id: true } });
      if (!existing) throw new Error("That provider record cannot be linked (it may already belong to another application).");
      await tx.serviceProvider.update({ where: { id: existing.id }, data: fields });
      providerId = existing.id;
    } else {
      const p = await tx.serviceProvider.create({ data: { ...fields, name: c.tradingName || c.registeredName, shortName: data.shortName, services: (ans.qualifications?.services ?? []).join(", "), coverage: data.allowedStates.join(", ") }, select: { id: true } });
      providerId = p.id;
    }
    await tx.vpApplication.update({ where: { id: a.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: adminId, providerId, decisionReason: data.note } });
    await tx.vpApplicationEvent.create({ data: { applicationId: a.id, actorId: adminId, action: "approved", fromStatus: a.status, toStatus: "APPROVED", note: `Provider ${code}. Services: ${data.allowedServices.join(", ")}. States: ${data.allowedStates.join(", ")}.${data.note ? ` ${data.note}` : ""}` } });
    // Documents the organisation sent stay with it, as its own records.
    await tx.vpDocument.updateMany({ where: { applicationId: a.id }, data: { providerId } });
    await tx.vpInvitation.create({ data: { providerId, email: o.repEmail, role: "OWNER", tokenHash: hashToken(token), invitedById: adminId, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_provider", entityId: providerId, action: "provider.approved", detail: { ref, code, allowedServices: data.allowedServices, allowedStates: data.allowedStates, linked: !!data.linkProviderId } });
    await notify(tx, a.applicantId, { kind: "verification.application", title: `Application ${ref} approved`, body: `${a.registeredName} is approved as provider ${code}. An invitation to activate the organisation's account has gone to its authorised representative, ${o.repEmail}.`, link: `/verification-partners/applications/${ref}` });
    const rep = await tx.user.findUnique({ where: { email: o.repEmail }, select: { id: true } });
    if (rep) await notify(tx, rep.id, { kind: "verification.invitation", title: `Activate ${c.tradingName || c.registeredName} on Housy`, body: "Your organisation is approved as a verification provider. Open the invitation to activate its account as owner.", link: `/verification-partners/activate/${encodeURIComponent(token)}` });
    return { providerId, code, repEmail: o.repEmail };
  });
  return { ...out, token };
}

// ---------- Providers, for Housy ----------

export async function providersForAdmin(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.serviceProvider.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], select: { id: true, name: true, shortName: true, providerCode: true, status: true, vettedAt: true, suspendedAt: true, suspendedReason: true, allowedServices: true, allowedStates: true, createdAt: true, _count: { select: { members: true, leads: true } } } });
    return rows;
  });
}

export async function providerForAdmin(adminId: string, id: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.serviceProvider.findUnique({ where: { id }, select: { id: true, name: true, shortName: true, providerCode: true, legalName: true, orgType: true, cacNumber: true, country: true, contactEmail: true, contactPhone: true, link: true, profile: true, status: true, vettedAt: true, suspendedAt: true, suspendedReason: true, allowedServices: true, allowedStates: true, application: { select: { ref: true, status: true } } } });
    if (!p) return null;
    const [members, invitations, documents, offerings, coverage] = await Promise.all([
      tx.providerMember.findMany({ where: { providerId: id }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, role: true, status: true, title: true, createdAt: true } }),
      tx.vpInvitation.findMany({ where: { providerId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, role: true, expiresAt: true } }),
      tx.vpDocument.findMany({ where: { providerId: id }, select: docMeta, orderBy: { createdAt: "asc" } }),
      tx.vpProviderService.findMany({ where: { providerId: id }, orderBy: { categoryCode: "asc" } }),
      tx.vpProviderCoverage.findMany({ where: { providerId: id }, orderBy: { state: "asc" } }),
    ]);
    const users = await tx.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { ...p, members: members.map((m) => ({ ...m, name: byId.get(m.userId)?.name ?? "", email: byId.get(m.userId)?.email ?? "" })), invitations, documents, offerings, coverage };
  });
}

/** Suspend: no new work, no changes; everything it did is kept. Reactivate lifts it. Both are recorded. */
export async function setProviderSuspended(adminId: string, id: string, suspend: boolean, reason: string) {
  const text = suspend ? z.string().trim().min(10, "Give the reason for suspending (10 characters or more)").max(1500).parse(reason) : reason.trim().slice(0, 1500);
  await withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.serviceProvider.findUnique({ where: { id }, select: { id: true, suspendedAt: true, name: true } });
    if (!p) throw new Error("That provider was not found.");
    if (suspend === !!p.suspendedAt) throw new Error(suspend ? "This provider is already suspended." : "This provider is not suspended.");
    await tx.serviceProvider.update({ where: { id }, data: suspend ? { suspendedAt: new Date(), suspendedReason: text } : { suspendedAt: null, suspendedReason: "" } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_provider", entityId: id, action: suspend ? "provider.suspended" : "provider.reactivated", detail: { reason: text } });
    const owners = await tx.providerMember.findMany({ where: { providerId: id, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" }, select: { userId: true } });
    for (const o of owners) await notify(tx, o.userId, { kind: "verification.provider", title: suspend ? `${p.name} is suspended on Housy` : `${p.name} is active again on Housy`, body: suspend ? `Reason: ${text}. Your records are kept; no new work or changes can be made until Housy lifts the suspension.` : "The suspension has been lifted.", link: "/provider" });
  });
}

const restrictSchema = z.object({ allowedServices: z.array(z.enum(SERVICE_CODES as [string, ...string[]])), allowedStates: z.array(z.string()) });
/** Narrow or widen what a provider may do. Services and areas it offered outside the new limits are switched off, not deleted. */
export async function setProviderRestrictions(adminId: string, id: string, input: z.input<typeof restrictSchema>) {
  const data = restrictSchema.parse(input);
  if (data.allowedStates.some((s) => !STATE_NAMES.includes(s))) throw new Error("Choose states from the list.");
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.serviceProvider.update({ where: { id }, data: { allowedServices: data.allowedServices, allowedStates: data.allowedStates } });
    await tx.vpProviderService.updateMany({ where: { providerId: id, categoryCode: { notIn: data.allowedServices } }, data: { active: false } });
    await tx.vpProviderCoverage.deleteMany({ where: { providerId: id, state: { notIn: data.allowedStates } } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "verification_provider", entityId: id, action: "provider.restrictions_changed", detail: data });
  });
}

export async function networkCounts(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const [apps, providers] = await Promise.all([
      tx.vpApplication.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.serviceProvider.findMany({ select: { status: true, suspendedAt: true, vettedAt: true } }),
    ]);
    const a = Object.fromEntries(apps.map((x) => [x.status, x._count._all])) as Record<string, number>;
    return {
      pending: (a.SUBMITTED ?? 0) + (a.RESUBMITTED ?? 0) + (a.UNDER_REVIEW ?? 0),
      waitingOnApplicant: a.ADDITIONAL_INFORMATION_REQUIRED ?? 0,
      providers: providers.length,
      approved: providers.filter((p) => p.status === "APPROVED" && !p.suspendedAt).length,
      vetted: providers.filter((p) => p.vettedAt).length,
      suspended: providers.filter((p) => p.suspendedAt).length,
    };
  });
}

export async function serviceCategories(activeOnly = true) {
  return withPublic((tx) => tx.vpServiceCategory.findMany({ where: activeOnly ? { active: true } : {}, orderBy: { position: "asc" } }));
}

// ============================== Stages 2 and 3: the organisation ==============================

export type VpCtx = { userId: string; providerId: string; role: VpRole; code: string; active: boolean };

/** How many organisations this person works for (for the menu). */
export async function providerOrgCount(userId: string) {
  return withUser(userId, (tx) => tx.providerMember.count({ where: { userId, status: "ACTIVE" } }));
}

/** The organisations this person works for. */
export async function myProviderOrgs(userId: string) {
  const rows = await withUser(userId, (tx) => tx.providerMember.findMany({ where: { userId, status: "ACTIVE" }, select: { role: true, provider: { select: { id: true, name: true, shortName: true, providerCode: true, status: true, suspendedAt: true } } } }));
  return rows.map((r) => ({ role: r.role as VpRole, ...r.provider }));
}

/** Who this person is in the organisation with this provider ID. Never trusts anything the browser says about roles. */
export async function providerContext(userId: string, code: string): Promise<VpCtx | null> {
  if (!isProviderCode(code)) return null;
  const p = await prisma.serviceProvider.findUnique({ where: { providerCode: code }, select: { id: true, status: true, suspendedAt: true } });
  if (!p) return null;
  const m = await withUser(userId, (tx) => tx.providerMember.findFirst({ where: { providerId: p.id, userId, status: "ACTIVE" }, select: { role: true } }));
  if (!m) return null;
  return { userId, providerId: p.id, role: m.role as VpRole, code, active: p.status === "APPROVED" && !p.suspendedAt };
}

export function assertVp(ctx: VpCtx, action: VpAction, write = true) {
  if (!vpCan(ctx.role, action)) throw new Error("Your role in this organisation does not allow that.");
  if (write && !ctx.active) throw new Error("This organisation is suspended on Housy, so nothing can be changed until the suspension is lifted.");
}

export async function providerProfile(ctx: VpCtx) {
  assertVp(ctx, "org.view", false);
  return withUser(ctx.userId, async (tx) => {
    const p = await prisma.serviceProvider.findUnique({ where: { id: ctx.providerId }, select: { id: true, name: true, shortName: true, providerCode: true, legalName: true, orgType: true, cacNumber: true, country: true, contactEmail: true, contactPhone: true, link: true, profile: true, status: true, vettedAt: true, suspendedAt: true, suspendedReason: true, allowedServices: true, allowedStates: true, logoMime: true } });
    const [offerings, coverage] = await Promise.all([
      tx.vpProviderService.findMany({ where: { providerId: ctx.providerId }, orderBy: { categoryCode: "asc" } }),
      tx.vpProviderCoverage.findMany({ where: { providerId: ctx.providerId }, orderBy: { state: "asc" } }),
    ]);
    return { ...p!, offerings, coverage };
  });
}

/** The dashboard's numbers, all counted from the organisation's own records. */
export async function providerOverview(ctx: VpCtx) {
  assertVp(ctx, "org.view", false);
  const soon = new Date(Date.now() + 60 * 864e5);
  return withUser(ctx.userId, async (tx) => {
    const [staff, pendingInvites, offerings, coverage, docs, expiring] = await Promise.all([
      tx.providerMember.groupBy({ by: ["role"], where: { providerId: ctx.providerId, status: "ACTIVE" }, _count: { _all: true } }),
      vpCan(ctx.role, "staff.manage") ? tx.vpInvitation.count({ where: { providerId: ctx.providerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }) : Promise.resolve(0),
      tx.vpProviderService.count({ where: { providerId: ctx.providerId, active: true } }),
      tx.vpProviderCoverage.count({ where: { providerId: ctx.providerId } }),
      tx.vpDocument.count({ where: { providerId: ctx.providerId } }),
      tx.vpDocument.findMany({ where: { providerId: ctx.providerId, expiresOn: { not: null, lte: soon } }, select: { id: true, title: true, expiresOn: true }, orderBy: { expiresOn: "asc" }, take: 10 }),
    ]);
    // Enquiries sent to the provider from listings (the earlier referral feature) still arrive here.
    const leads = await prisma.providerLead.groupBy({ by: ["status"], where: { providerId: ctx.providerId }, _count: { _all: true } });
    return {
      staff: Object.fromEntries(staff.map((s) => [s.role, s._count._all])) as Partial<Record<VpRole, number>>,
      pendingInvites, offerings, coverage, docs, expiring,
      leads: Object.fromEntries(leads.map((l) => [l.status, l._count._all])) as Record<string, number>,
    };
  });
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter the name customers see").max(160),
  shortName: z.string().trim().min(2, "Enter a short name").max(40),
  profile: z.string().trim().min(40, "Describe the organisation in at least a few sentences (40 characters or more)").max(3000),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid contact email").max(200),
  contactPhone: z.string().trim().min(7, "Enter a contact telephone number").max(30).regex(/^[+0-9 ()-]+$/, "Enter the telephone number using digits only"),
  link: z.string().trim().max(300).refine((v) => v === "" || /^https:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter the website as a full https:// address"),
});

/** The organisation's public profile. The registered name, CAC number and provider ID are Housy's record and are not edited here. */
export async function updateProviderProfile(ctx: VpCtx, input: z.input<typeof profileSchema>, logo: { type: string; bytes: Uint8Array } | null) {
  assertVp(ctx, "org.profile");
  const data = profileSchema.parse(input);
  if (logo) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(logo.type)) throw new Error("The logo must be a PNG, JPG or WEBP picture.");
    validateUpload(logo.type, logo.bytes);
    if (logo.bytes.byteLength > 1024 * 1024) throw new Error("The logo must be 1 MB or smaller.");
  }
  await withUser(ctx.userId, async (tx) => {
    await tx.serviceProvider.update({ where: { id: ctx.providerId }, data: { ...data, ...(logo ? { logoMime: logo.type, logoBytes: Buffer.from(logo.bytes) } : {}) } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.profile_updated", detail: { fields: Object.keys(data), logo: !!logo } });
  });
}

export async function providerLogo(providerId: string) {
  const p = await prisma.serviceProvider.findUnique({ where: { id: providerId }, select: { logoMime: true, logoBytes: true } });
  return p?.logoBytes && p.logoMime ? { type: p.logoMime, bytes: Buffer.from(p.logoBytes) } : null;
}

const offeringSchema = z.object({ categoryCode: z.enum(SERVICE_CODES as [string, ...string[]]), active: z.boolean(), priceNaira: z.string().trim().default(""), turnaroundDays: z.coerce.number().int().min(1, "Turnaround must be at least a day").max(180, "Turnaround can be at most 180 days"), notes: z.string().trim().max(500).default("") });

/** What the organisation offers, its price and turnaround, only within the services Housy approved it for. */
export async function setProviderOfferings(ctx: VpCtx, rows: z.input<typeof offeringSchema>[]) {
  assertVp(ctx, "org.services");
  const parsed = rows.map((r) => offeringSchema.parse(r));
  const p = await prisma.serviceProvider.findUnique({ where: { id: ctx.providerId }, select: { allowedServices: true } });
  for (const r of parsed) if (!p!.allowedServices.includes(r.categoryCode)) throw new Error("Housy has not approved this organisation for one of those services.");
  await withUser(ctx.userId, async (tx) => {
    for (const r of parsed) {
      const naira = r.priceNaira.replace(/[,\s₦]/g, "");
      if (naira && !/^\d+(\.\d{1,2})?$/.test(naira)) throw new Error("Enter prices in naira, like 150000");
      const priceKobo = naira ? BigInt(Math.round(Number(naira) * 100)) : null;
      await tx.vpProviderService.upsert({ where: { providerId_categoryCode: { providerId: ctx.providerId, categoryCode: r.categoryCode } }, create: { providerId: ctx.providerId, categoryCode: r.categoryCode, active: r.active, priceKobo, turnaroundDays: r.turnaroundDays, notes: r.notes }, update: { active: r.active, priceKobo, turnaroundDays: r.turnaroundDays, notes: r.notes } });
    }
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.services_updated", detail: { services: parsed.filter((r) => r.active).map((r) => r.categoryCode) } });
  });
}

/** Where the organisation works, only within the states Housy approved it for. */
export async function setProviderCoverage(ctx: VpCtx, states: string[]) {
  assertVp(ctx, "org.services");
  const p = await prisma.serviceProvider.findUnique({ where: { id: ctx.providerId }, select: { allowedStates: true } });
  const want = [...new Set(states)];
  if (want.some((s) => !p!.allowedStates.includes(s))) throw new Error("Housy has not approved this organisation for one of those states.");
  await withUser(ctx.userId, async (tx) => {
    await tx.vpProviderCoverage.deleteMany({ where: { providerId: ctx.providerId, state: { notIn: want } } });
    for (const state of want) await tx.vpProviderCoverage.upsert({ where: { providerId_state_area: { providerId: ctx.providerId, state, area: "" } }, create: { providerId: ctx.providerId, state }, update: {} });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.coverage_updated", detail: { states: want } });
  });
}

export async function providerDocuments(ctx: VpCtx) {
  assertVp(ctx, "org.view", false);
  return withUser(ctx.userId, (tx) => tx.vpDocument.findMany({ where: { providerId: ctx.providerId }, select: docMeta, orderBy: { createdAt: "desc" } }));
}

export async function addProviderDocument(ctx: VpCtx, input: { kind: string; title: string; expiresOn: string }, file: { name: string; type: string; bytes: Uint8Array }) {
  assertVp(ctx, "org.documents");
  const kind = z.enum(DOC_KINDS.map((d) => d[0]) as [string, ...string[]]).parse(input.kind);
  const expiresOn = input.expiresOn ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expiry date as YYYY-MM-DD").parse(input.expiresOn) : null;
  if (expiresOn && expiresOn < new Date().toISOString().slice(0, 10)) throw new Error("This document has already expired. Upload the current one.");
  validateUpload(file.type, file.bytes);
  await withUser(ctx.userId, async (tx) => {
    const d = await tx.vpDocument.create({ data: { providerId: ctx.providerId, kind, title: input.title.trim().slice(0, 160) || DOC_KINDS.find((x) => x[0] === kind)![1], fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, bytes: Buffer.from(file.bytes), sha256: sha256(file.bytes), expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00Z`) : null, uploadedById: ctx.userId }, select: { id: true } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.document_added", detail: { id: d.id, kind } });
  });
}

export async function removeProviderDocument(ctx: VpCtx, documentId: string) {
  assertVp(ctx, "org.documents");
  await withUser(ctx.userId, async (tx) => {
    const n = await tx.vpDocument.deleteMany({ where: { id: documentId, providerId: ctx.providerId, applicationId: null } });
    if (!n.count) throw new Error("That document was not found, or it came with the application and is kept as part of Housy's record.");
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.document_removed", detail: { id: documentId } });
  });
}

// ---------- Staff ----------

export async function providerStaff(ctx: VpCtx) {
  assertVp(ctx, "staff.view", false);
  return withUser(ctx.userId, async (tx) => {
    const members = await tx.providerMember.findMany({ where: { providerId: ctx.providerId }, orderBy: [{ status: "asc" }, { createdAt: "asc" }], select: { id: true, userId: true, role: true, status: true, title: true, createdAt: true } });
    const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const invitations = vpCan(ctx.role, "staff.manage") ? await tx.vpInvitation.findMany({ where: { providerId: ctx.providerId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, expiresAt: true, createdAt: true } }) : [];
    return { members: members.map((m) => ({ ...m, role: m.role as VpRole, name: byId.get(m.userId)?.name ?? "", email: byId.get(m.userId)?.email ?? "", me: m.userId === ctx.userId })), invitations };
  });
}

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200), role: z.enum(VP_ROLES, { message: "Choose a role" }) });

/** Invite someone into the organisation in a role. Returns the link's secret, shown once to the person inviting. */
export async function inviteProviderStaff(ctx: VpCtx, input: z.input<typeof inviteSchema>) {
  const data = inviteSchema.parse(input);
  assertVp(ctx, "staff.manage");
  if (!mayManageRole(ctx.role, data.role)) throw new Error(`Only an organisation owner can invite a ${VP_ROLE_LABELS[data.role].toLowerCase()}.`);
  await limited(`vp-invite:${ctx.providerId}`, 50);
  const token = newToken();
  await withUser(ctx.userId, async (tx) => {
    const already = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (already && (await tx.providerMember.findFirst({ where: { providerId: ctx.providerId, userId: already.id } }))) throw new Error("That person is already in this organisation.");
    await tx.vpInvitation.updateMany({ where: { providerId: ctx.providerId, email: data.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.vpInvitation.create({ data: { providerId: ctx.providerId, email: data.email, role: data.role, tokenHash: hashToken(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) }, select: { id: true } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.staff_invited", detail: { invitation: inv.id, email: data.email, role: data.role } });
    if (already) await system((t2) => notify(t2, already.id, { kind: "verification.invitation", title: "You have been invited to a verification organisation on Housy", body: `Role: ${VP_ROLE_LABELS[data.role]}. Open the invitation to accept.`, link: `/verification-partners/activate/${encodeURIComponent(token)}` }));
  });
  return token;
}

export async function revokeProviderInvitation(ctx: VpCtx, invitationId: string) {
  assertVp(ctx, "staff.manage");
  await withUser(ctx.userId, async (tx) => {
    const inv = await tx.vpInvitation.findFirst({ where: { id: invitationId, providerId: ctx.providerId, acceptedAt: null, revokedAt: null } });
    if (!inv) throw new Error("That invitation was not found or is no longer open.");
    if (!mayManageRole(ctx.role, inv.role as VpRole)) throw new Error("Only an organisation owner can cancel that invitation.");
    await tx.vpInvitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.invitation_revoked", detail: { invitation: inv.id } });
  });
}

async function memberFor(tx: Tx, ctx: VpCtx, memberId: string) {
  const m = await tx.providerMember.findFirst({ where: { id: memberId, providerId: ctx.providerId } });
  if (!m) throw new Error("That person was not found in this organisation.");
  return m;
}
async function ownersLeft(tx: Tx, providerId: string, exceptMemberId: string) {
  return tx.providerMember.count({ where: { providerId, role: "OWNER", status: "ACTIVE", id: { not: exceptMemberId } } });
}

export async function changeProviderStaffRole(ctx: VpCtx, memberId: string, roleInput: string) {
  const role = z.enum(VP_ROLES).parse(roleInput);
  assertVp(ctx, "staff.manage");
  await withUser(ctx.userId, async (tx) => {
    const m = await memberFor(tx, ctx, memberId);
    if (!mayManageRole(ctx.role, m.role as VpRole) || !mayManageRole(ctx.role, role)) throw new Error("Only an organisation owner can change an owner's or an administrator's role, or give someone either role.");
    if (m.role === "OWNER" && role !== "OWNER" && (await ownersLeft(tx, ctx.providerId, m.id)) === 0) throw new Error("The organisation must keep at least one active owner. Make someone else an owner first.");
    await tx.providerMember.update({ where: { id: m.id }, data: { role } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.staff_role_changed", detail: { member: m.id, from: m.role, to: role } });
  });
}

export async function setProviderStaffStatus(ctx: VpCtx, memberId: string, active: boolean) {
  assertVp(ctx, "staff.manage");
  await withUser(ctx.userId, async (tx) => {
    const m = await memberFor(tx, ctx, memberId);
    if (m.userId === ctx.userId) throw new Error("You cannot suspend yourself.");
    if (!mayManageRole(ctx.role, m.role as VpRole)) throw new Error("Only an organisation owner can suspend an owner or an administrator.");
    if (!active && m.role === "OWNER" && (await ownersLeft(tx, ctx.providerId, m.id)) === 0) throw new Error("The organisation must keep at least one active owner.");
    await tx.providerMember.update({ where: { id: m.id }, data: { status: active ? "ACTIVE" : "SUSPENDED" } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: active ? "provider.staff_reactivated" : "provider.staff_suspended", detail: { member: m.id } });
  });
}

export async function removeProviderStaff(ctx: VpCtx, memberId: string) {
  assertVp(ctx, "staff.manage");
  await withUser(ctx.userId, async (tx) => {
    const m = await memberFor(tx, ctx, memberId);
    if (m.userId === ctx.userId) throw new Error("You cannot remove yourself. Ask another owner.");
    if (!mayManageRole(ctx.role, m.role as VpRole)) throw new Error("Only an organisation owner can remove an owner or an administrator.");
    if (m.role === "OWNER" && (await ownersLeft(tx, ctx.providerId, m.id)) === 0) throw new Error("The organisation must keep at least one active owner.");
    await tx.providerMember.delete({ where: { id: m.id } });
    await logActivity(tx, { companyId: null, actorId: ctx.userId, entityType: "verification_provider", entityId: ctx.providerId, action: "provider.staff_removed", detail: { member: m.id, user: m.userId, role: m.role } });
  });
}

// ---------- Invitations (the first owner's activation, and staff) ----------

export async function findProviderInvitation(token: string) {
  const tokenHash = hashToken(token);
  const inv = await withInviteToken(tokenHash, (tx) => tx.vpInvitation.findUnique({ where: { tokenHash }, select: { id: true, providerId: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true } }));
  if (!inv) return null;
  const provider = await prisma.serviceProvider.findUnique({ where: { id: inv.providerId }, select: { name: true, providerCode: true, status: true, suspendedAt: true } });
  return { ...inv, role: inv.role as VpRole, provider };
}

const acceptNew = z.object({ name: z.string().trim().min(2, "Enter your full name").max(120), password: z.string().min(10, "Use at least 10 characters for the password").max(200) });

/**
 * Accept an invitation: the person's email must be the one invited (proved by the link sent there, and by signing in if
 * the account exists). A new person sets their name and password here. Returns the provider ID to go to.
 */
export async function acceptProviderInvitation(token: string, opts: { existingUserId?: string; name?: string; password?: string }) {
  const inv = await findProviderInvitation(token);
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw new Error("This invitation is invalid, already used or has expired. Ask for a new one.");
  if (!inv.provider || inv.provider.status !== "APPROVED" || inv.provider.suspendedAt) throw new Error("This organisation cannot take on staff just now.");
  let userId: string;
  const existing = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  if (existing) {
    if (opts.existingUserId !== existing.id) throw new Error(`Sign in as ${inv.email} to accept this invitation.`);
    userId = existing.id;
  } else {
    const data = acceptNew.parse({ name: opts.name, password: opts.password });
    await assertNotBlocked(inv.email, "");
    userId = (await prisma.user.create({ data: { email: inv.email, name: data.name, passwordHash: await hashPassword(data.password) }, select: { id: true } })).id;
  }
  await withInviteTokenAs(hashToken(token), userId, async (tx) => {
    const already = await tx.providerMember.findFirst({ where: { providerId: inv.providerId, userId } });
    if (already) throw new Error("You are already in this organisation.");
    await tx.providerMember.create({ data: { providerId: inv.providerId, userId, role: inv.role, addedById: userId, status: "ACTIVE" } });
    await tx.vpInvitation.update({ where: { tokenHash: hashToken(token) }, data: { acceptedAt: new Date(), acceptedById: userId } });
  });
  await system((tx) => logActivity(tx, { companyId: null, actorId: userId, entityType: "verification_provider", entityId: inv.providerId, action: "provider.staff_joined", detail: { role: inv.role, invitation: inv.id } }));
  return { userId, code: inv.provider.providerCode! };
}
