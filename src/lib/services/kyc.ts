import type { Prisma } from "@prisma/client";
import { withPlatformAdmin, withPublic, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { validateUpload } from "../storage";
import { openSecret, sealSecret } from "../totp";
import { checkSubmission, expiryFor, requirement, requirementsFor, trustOf, type Check, type KycKind, type KycStatus } from "../kyc-rules";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";

const DOC_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
type Doc = { type: string; bytes: Uint8Array; name: string } | null;

const keyOf = (kind: KycKind, id: string) => `${kind}:${id}`;
const itemSelect = { id: true, code: true, status: true, fields: true, secretMasked: true, docMime: true, docName: true, submittedAt: true, reviewedAt: true, reviewNote: true, scope: true, verifiedAt: true, expiresAt: true } as const;

function checkDoc(code: string, doc: Doc, resubmitting: boolean) {
  const r = requirement(code)!;
  if (!doc) { if (r.document?.required && !resubmitting) throw new Error(`Attach the ${r.document.label.split(" (")[0].toLowerCase()}`); return; }
  if (!r.document) throw new Error("This check does not take a document");
  if (!DOC_TYPES.includes(doc.type)) throw new Error("Upload a PDF, JPG, PNG or WEBP file");
  validateUpload(doc.type, doc.bytes);
}

async function upsertItem(tx: Tx, base: { companyId: string; subjectKind: KycKind; subjectKey: string; subjectUserId: string | null; code: string; userId: string }, input: Record<string, string>, doc: Doc) {
  const r = requirement(base.code);
  if (!r || r.kind !== base.subjectKind) throw new Error("Unknown check");
  const existing = await tx.kycItem.findFirst({ where: { subjectKey: base.subjectKey, code: base.code } });
  if (existing && (existing.status === "SUBMITTED" || existing.status === "UNDER_REVIEW")) throw new Error("This check is already waiting for review");
  if (existing?.status === "VERIFIED" && existing.expiresAt && existing.expiresAt.getTime() > Date.now() + 30 * 864e5) throw new Error("This check is verified. You can renew it in the last 30 days before it expires.");
  const s = checkSubmission(base.code, input);
  // When resubmitting, an ID number left blank keeps the one already on file.
  const keepSecret = !!existing?.secretSealed && !s.secret;
  const errors = keepSecret ? s.errors.filter((e) => !/ID number is needed/.test(e)) : s.errors;
  if (errors.length) throw new Error(errors.join(". "));
  checkDoc(base.code, doc, !!existing?.docBytes);
  const data = {
    status: "SUBMITTED", fields: s.values as Prisma.InputJsonValue, submittedById: base.userId, submittedAt: new Date(),
    reviewedById: null, reviewedAt: null, reviewNote: "", scope: "", evidence: "", limitations: "", verifiedAt: null, expiresAt: null,
    ...(s.secret ? { secretSealed: sealSecret(s.secret), secretMasked: s.masked } : {}),
    ...(doc ? { docMime: doc.type, docBytes: Buffer.from(doc.bytes), docName: doc.name.slice(0, 200) } : {}),
  };
  const row = existing
    ? await tx.kycItem.update({ where: { id: existing.id }, data, select: { id: true } })
    : await tx.kycItem.create({ data: { ...data, companyId: base.companyId, subjectKind: base.subjectKind, subjectKey: base.subjectKey, subjectUserId: base.subjectUserId, code: base.code }, select: { id: true } });
  // A resubmitted check no longer counts until it is reviewed again.
  return row.id;
}

/** A company submits one of its checks. Only the company's top administrator may, because it includes a director's ID. */
export async function submitCompanyKyc(ctx: Ctx, code: string, input: Record<string, string>, doc: Doc) {
  assertCan(ctx, "kyc.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const id = await upsertItem(tx, { companyId: ctx.companyId, subjectKind: "COMPANY", subjectKey: keyOf("COMPANY", ctx.companyId), subjectUserId: null, code, userId: ctx.userId }, input, doc);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "kyc", entityId: id, action: "kyc.submitted", detail: { code } });
    return id;
  });
}

/** An agent submits one of their own checks. Their employer cannot read these; only the agent and the reviewers can. */
export async function submitAgentKyc(userId: string, companyId: string, code: string, input: Record<string, string>, doc: Doc) {
  return withUser(userId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { userId, companyId, status: "ACTIVE" } });
    if (!m) throw new Error("Agent checks are for people who work for a registered company");
    const id = await upsertItem(tx, { companyId, subjectKind: "AGENT", subjectKey: keyOf("AGENT", userId), subjectUserId: userId, code, userId }, input, doc);
    // Personal record: logged without a company, so the employer does not see it in its own trail.
    await logActivity(tx, { companyId: null, actorId: userId, entityType: "kyc", entityId: id, action: "kyc.submitted", detail: { code, agent: true } });
    return id;
  });
}

function view(kind: KycKind, rows: { code: string; status: string; fields: unknown; secretMasked: string; docName: string; docMime: string | null; submittedAt: Date; reviewedAt: Date | null; reviewNote: string; scope: string; verifiedAt: Date | null; expiresAt: Date | null; id: string }[], now = new Date()) {
  const items = requirementsFor(kind).map((r) => {
    const row = rows.find((x) => x.code === r.code) ?? null;
    let status: KycStatus | "NOT_SUBMITTED" = (row?.status as KycStatus) ?? "NOT_SUBMITTED";
    if (status === "VERIFIED" && row?.expiresAt && row.expiresAt.getTime() <= now.getTime()) status = "EXPIRED";
    return { req: r, row, status: status as KycStatus | "NOT_SUBMITTED", fields: (row?.fields ?? {}) as Record<string, string> };
  });
  const checks: Check[] = rows.filter((x) => x.status === "VERIFIED" && x.verifiedAt).map((x) => ({ code: x.code, verifiedAt: x.verifiedAt!, expiresAt: x.expiresAt }));
  return { items, trust: trustOf(kind, checks, now) };
}

export async function companyKyc(ctx: Ctx) {
  assertCan(ctx, "kyc.manage");
  const rows = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.kycItem.findMany({ where: { subjectKey: keyOf("COMPANY", ctx.companyId) }, select: itemSelect }));
  return view("COMPANY", rows);
}

export async function agentKyc(userId: string) {
  const rows = await withUser(userId, (tx) => tx.kycItem.findMany({ where: { subjectKey: keyOf("AGENT", userId) }, select: itemSelect }));
  return view("AGENT", rows);
}

/** A document for its owner (the company's administrator, or the agent) or a reviewer. Never public. */
export async function kycDocument(viewer: { userId: string; companyId: string | null; canManageCompany: boolean; platformAdmin: boolean }, id: string) {
  if (viewer.platformAdmin) {
    const doc = await withPlatformAdmin(viewer.userId, (tx) => tx.kycItem.findFirst({ where: { id }, select: { docMime: true, docBytes: true, docName: true, companyId: true, subjectKind: true } }));
    if (doc) await withPlatformAdmin(viewer.userId, (tx) => logActivity(tx, { companyId: doc.companyId, actorId: viewer.userId, entityType: "kyc", entityId: id, action: "kyc.document_viewed", detail: {} }));
    return doc;
  }
  const own = await withUser(viewer.userId, (tx) => tx.kycItem.findFirst({ where: { id, subjectKind: "AGENT", subjectUserId: viewer.userId }, select: { docMime: true, docBytes: true, docName: true, companyId: true, subjectKind: true } }));
  if (own) return own;
  if (viewer.companyId && viewer.canManageCompany) {
    return withTenant(viewer.companyId, viewer.userId, (tx) => tx.kycItem.findFirst({ where: { id, subjectKind: "COMPANY", companyId: viewer.companyId! }, select: { docMime: true, docBytes: true, docName: true, companyId: true, subjectKind: true } }));
  }
  return null;
}

// ---------- Reviewers (platform administrators) ----------

export async function kycQueue(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.kycItem.findMany({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, orderBy: { submittedAt: "asc" }, take: 60, select: { ...itemSelect, companyId: true, subjectKind: true, subjectUserId: true } });
    const recent = await tx.kycItem.findMany({ where: { status: { in: ["VERIFIED", "REJECTED", "NEEDS_INFO", "REVOKED"] } }, orderBy: { reviewedAt: "desc" }, take: 30, select: { ...itemSelect, companyId: true, subjectKind: true, subjectUserId: true } });
    const all = [...rows, ...recent];
    const [companies, users] = await Promise.all([
      tx.company.findMany({ where: { id: { in: [...new Set(all.map((r) => r.companyId))] } }, select: { id: true, name: true } }),
      tx.user.findMany({ where: { id: { in: all.map((r) => r.subjectUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } }),
    ]);
    const who = (r: (typeof all)[number]) => r.subjectKind === "AGENT"
      ? `${users.find((u) => u.id === r.subjectUserId)?.name ?? "Agent"} (agent at ${companies.find((c) => c.id === r.companyId)?.name ?? "a company"})`
      : companies.find((c) => c.id === r.companyId)?.name ?? "Company";
    return { waiting: rows.map((r) => ({ ...r, who: who(r) })), recent: recent.map((r) => ({ ...r, who: who(r) })) };
  });
}

/** Show a reviewer the full ID number. Every look is recorded. */
export async function revealKycSecret(adminId: string, id: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.kycItem.findFirst({ where: { id }, select: { secretSealed: true, companyId: true } });
    if (!r?.secretSealed) return null;
    await logActivity(tx, { companyId: r.companyId, actorId: adminId, entityType: "kyc", entityId: id, action: "kyc.id_number_viewed", detail: {} });
    return openSecret(r.secretSealed);
  });
}

async function refreshTrust(tx: Tx, subjectKey: string) {
  const rows = await tx.kycItem.findMany({ where: { subjectKey, status: "VERIFIED" }, select: { code: true, verifiedAt: true, expiresAt: true, companyId: true, subjectKind: true, subjectUserId: true, scope: true } });
  const any = rows[0] ?? await tx.kycItem.findFirst({ where: { subjectKey }, select: { companyId: true, subjectKind: true, subjectUserId: true } });
  if (!any) return;
  const checks = rows.map((r) => ({ code: r.code, verifiedAt: r.verifiedAt!.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null, scope: r.scope }));
  await tx.trustScore.upsert({
    where: { subjectKey },
    create: { subjectKey, subjectKind: any.subjectKind, companyId: any.companyId, subjectUserId: any.subjectUserId, checks },
    update: { checks },
  });
}

export async function decideKyc(adminId: string, id: string, d: { decision: "verify" | "needs_info" | "reject" | "revoke" | "start"; note: string; scope?: string; evidence?: string; limitations?: string; months?: number }) {
  const note = d.note.trim().slice(0, 1000);
  if (d.decision !== "verify" && d.decision !== "start" && note.length < 5) throw new Error("Say what the person needs to know (at least a few words)");
  await withPlatformAdmin(adminId, async (tx) => {
    const r = await tx.kycItem.findFirst({ where: { id } });
    if (!r) throw new Error("Check not found");
    if (r.submittedById === adminId) throw new Error("You cannot review a check you submitted yourself");
    const now = new Date();
    if (d.decision === "start") {
      if (r.status !== "SUBMITTED") throw new Error("Only a newly submitted check can be started");
      await tx.kycItem.update({ where: { id }, data: { status: "UNDER_REVIEW", reviewedById: adminId } });
      return;
    }
    if (d.decision === "revoke") {
      if (r.status !== "VERIFIED") throw new Error("Only a verified check can be revoked");
      await tx.kycItem.update({ where: { id }, data: { status: "REVOKED", reviewNote: note, reviewedById: adminId, reviewedAt: now } });
    } else {
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(r.status)) throw new Error("This check is not waiting for review");
      if (d.decision === "verify") {
        const req = requirement(r.code)!;
        const scope = (d.scope ?? "").trim() || req.scope;
        const evidence = (d.evidence ?? "").trim();
        if (evidence.length < 5) throw new Error("Record what you relied on (for example: CAC public search, original certificate seen)");
        await tx.kycItem.update({ where: { id }, data: { status: "VERIFIED", reviewedById: adminId, reviewedAt: now, verifiedAt: now, expiresAt: expiryFor(r.code, now, d.months), scope: scope.slice(0, 300), evidence: evidence.slice(0, 1000), limitations: (d.limitations ?? "").trim().slice(0, 1000), reviewNote: note } });
      } else {
        await tx.kycItem.update({ where: { id }, data: { status: d.decision === "reject" ? "REJECTED" : "NEEDS_INFO", reviewedById: adminId, reviewedAt: now, reviewNote: note } });
      }
    }
    await refreshTrust(tx, r.subjectKey);
    await logActivity(tx, { companyId: r.companyId, actorId: adminId, entityType: "kyc", entityId: id, action: `kyc.${d.decision}`, detail: { code: r.code, note } });
    const title = requirement(r.code)?.title ?? "A check";
    const message = d.decision === "verify" ? `${title} is verified` : d.decision === "revoke" ? `${title} was revoked` : d.decision === "reject" ? `${title} was not accepted` : `${title} needs more information`;
    const link = r.subjectKind === "AGENT" ? "/me/verification" : "/app/verification";
    await notify(tx, r.subjectKind === "AGENT" ? r.subjectUserId! : r.submittedById, { kind: "security.kyc", title: message, body: note, link });
  });
}

// ---------- Public ----------

type StoredCheck = { code: string; verifiedAt: string; expiresAt: string | null; scope?: string };
function fromStored(kind: KycKind, raw: unknown, now = new Date()) {
  const list = (Array.isArray(raw) ? raw : []) as StoredCheck[];
  const checks = list.map((c) => ({ code: c.code, verifiedAt: new Date(c.verifiedAt), expiresAt: c.expiresAt ? new Date(c.expiresAt) : null, scope: c.scope ?? requirement(c.code)?.scope ?? "" }));
  const t = trustOf(kind, checks, now);
  const live = checks.filter((c) => t.passed.includes(c.code) && (!c.expiresAt || c.expiresAt > now));
  return { ...t, checks: live.map((c) => ({ code: c.code, title: requirement(c.code)?.title ?? c.code, scope: c.scope, verifiedAt: c.verifiedAt, expiresAt: c.expiresAt })) };
}
export type PublicTrust = ReturnType<typeof fromStored>;

export async function companyTrust(companyId: string) {
  const row = await withPublic((tx) => tx.trustScore.findUnique({ where: { subjectKey: keyOf("COMPANY", companyId) } }));
  return fromStored("COMPANY", row?.checks ?? []);
}
export async function agentTrust(userId: string) {
  const row = await withPublic((tx) => tx.trustScore.findUnique({ where: { subjectKey: keyOf("AGENT", userId) } }));
  return fromStored("AGENT", row?.checks ?? []);
}
export async function trustMany(kind: KycKind, ids: string[]) {
  if (!ids.length) return new Map<string, PublicTrust>();
  const rows = await withPublic((tx) => tx.trustScore.findMany({ where: { subjectKey: { in: ids.map((i) => keyOf(kind, i)) } } }));
  return new Map(ids.map((i) => [i, fromStored(kind, rows.find((r) => r.subjectKey === keyOf(kind, i))?.checks ?? [])]));
}
