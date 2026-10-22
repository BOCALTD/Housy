// Owner, vendor and professional-services portals (master prompt §39).
//
// Outsiders are not company members, so ordinary tenant row-level security would show them nothing.
// Every portal read first proves the grant through the person's own context (withUser, which RLS limits
// to grants they hold), and only then reads company records in a system context, filtered to exactly the
// assets or work orders the grant covers. Writes by outsiders go through their own context so the
// database itself checks they hold an active grant.
import { z } from "zod";
import { withInviteToken, withInviteTokenAs, withPlatformAdmin, withTenant, withUser, prisma, type Tx } from "../db";
import { logActivity } from "../audit";
import { validateUpload } from "../storage";
import { hashToken, newToken } from "../tokens";
import { can } from "../permissions";
import {
  MAX_GRANT_ASSETS, VENDOR_VISIBLE, acceptEffect, canMoveLead, checkSubmissionInput, parseNaira, rentPosition,
  type LeadStatus, type SubmissionKind,
} from "../portal-rules";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";
import { lagosDay } from "../notification-rules";

const DOC_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export type PortalDoc = { type: string; bytes: Uint8Array; name: string } | null;

function checkDoc(doc: PortalDoc) {
  if (!doc) return;
  if (!DOC_TYPES.includes(doc.type)) throw new Error("Upload a PDF, JPG, PNG or WEBP file");
  validateUpload(doc.type, doc.bytes);
}

const SYSTEM = "system";
/** How long an invitation link works. */
export const INVITE_DAYS = 14;
const inviteExpiry = () => new Date(Date.now() + INVITE_DAYS * 864e5);
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(160);
const displayName = z.string().trim().min(2, "Enter the person's or business's name").max(120);

// ---------- Company side ----------

export async function listGrants(ctx: Ctx) {
  assertCan(ctx, "portal.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [grants, links, contractors, assets, profiles] = await Promise.all([
      tx.portalGrant.findMany({
        where: { companyId: ctx.companyId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        select: { id: true, kind: true, email: true, displayName: true, userId: true, contractorId: true, status: true, createdAt: true, acceptedAt: true, revokedAt: true, inviteExpiresAt: true },
      }),
      tx.portalGrantAsset.findMany({ where: { companyId: ctx.companyId } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true, trade: true, email: true, active: true }, orderBy: { name: "asc" } }),
      tx.asset.findMany({ where: { companyId: ctx.companyId, status: { not: "DISPOSED" } }, select: { id: true, ref: true, name: true }, orderBy: { name: "asc" } }),
      tx.vendorProfile.findMany({ where: { companyId: ctx.companyId }, select: { grantId: true, serviceAreas: true, qualifications: true, insuranceNote: true, docName: true, updatedAt: true } }),
    ]);
    const assetName = new Map(assets.map((a) => [a.id, `${a.name} (${a.ref})`]));
    const contractorName = new Map(contractors.map((c) => [c.id, c.name]));
    return {
      grants: grants.map((g) => ({
        ...g,
        assets: links.filter((l) => l.grantId === g.id).map((l) => ({ id: l.assetId, label: assetName.get(l.assetId) ?? "Asset no longer active" })),
        contractorName: g.contractorId ? contractorName.get(g.contractorId) ?? "" : "",
        profile: profiles.find((p) => p.grantId === g.id) ?? null,
      })),
      contractors, assets,
    };
  });
}

async function checkAssets(tx: Tx, companyId: string, assetIds: string[]) {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) throw new Error("Choose at least one property the owner may see");
  if (ids.length > MAX_GRANT_ASSETS) throw new Error(`Choose at most ${MAX_GRANT_ASSETS} properties per invitation`);
  const found = await tx.asset.count({ where: { companyId, id: { in: ids } } });
  if (found !== ids.length) throw new Error("One of the chosen properties was not found");
  return ids;
}

/** Invite a property owner to see chosen assets. Returns the one-time invitation link token. */
export async function inviteOwner(ctx: Ctx, input: { email: string; displayName: string; assetIds: string[] }) {
  assertCan(ctx, "portal.manage");
  const data = { email: email.parse(input.email), displayName: displayName.parse(input.displayName) };
  const token = newToken();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const ids = await checkAssets(tx, ctx.companyId, input.assetIds);
    const g = await tx.portalGrant.create({
      data: { companyId: ctx.companyId, kind: "OWNER", ...data, inviteTokenHash: hashToken(token), inviteExpiresAt: inviteExpiry(), createdById: ctx.userId },
    });
    await tx.portalGrantAsset.createMany({ data: ids.map((assetId) => ({ grantId: g.id, companyId: ctx.companyId, assetId })) });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "PortalGrant", entityId: g.id, action: "portal.owner_invited", detail: { email: data.email, assets: ids.length } });
  });
  return token;
}

/** Invite a vendor to see the work orders assigned to one of the company's contractors. */
export async function inviteVendor(ctx: Ctx, input: { email: string; displayName: string; contractorId: string }) {
  assertCan(ctx, "portal.manage");
  const data = { email: email.parse(input.email), displayName: displayName.parse(input.displayName) };
  const token = newToken();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await tx.contractor.findFirst({ where: { id: input.contractorId, companyId: ctx.companyId } });
    if (!c) throw new Error("Choose one of your contractors");
    if (!c.active) throw new Error("That contractor is switched off");
    const open = await tx.portalGrant.count({ where: { companyId: ctx.companyId, kind: "VENDOR", contractorId: c.id, status: { not: "REVOKED" } } });
    if (open > 0) throw new Error("This contractor already has portal access. Remove it first to invite someone else.");
    const g = await tx.portalGrant.create({
      data: { companyId: ctx.companyId, kind: "VENDOR", ...data, contractorId: c.id, inviteTokenHash: hashToken(token), inviteExpiresAt: inviteExpiry(), createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "PortalGrant", entityId: g.id, action: "portal.vendor_invited", detail: { email: data.email, contractor: c.name } });
  });
  return token;
}

export async function setGrantAssets(ctx: Ctx, grantId: string, assetIds: string[]) {
  assertCan(ctx, "portal.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const g = await tx.portalGrant.findFirst({ where: { id: grantId, companyId: ctx.companyId, kind: "OWNER" } });
    if (!g || g.status === "REVOKED") throw new Error("Owner access not found");
    const ids = await checkAssets(tx, ctx.companyId, assetIds);
    await tx.portalGrantAsset.deleteMany({ where: { grantId, companyId: ctx.companyId, assetId: { notIn: ids } } });
    await tx.portalGrantAsset.createMany({ data: ids.map((assetId) => ({ grantId, companyId: ctx.companyId, assetId })), skipDuplicates: true });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "PortalGrant", entityId: grantId, action: "portal.assets_changed", detail: { assets: ids.length } });
  });
}

/** A fresh link for an invitation not yet accepted; the old link stops working. */
export async function reissueInvite(ctx: Ctx, grantId: string) {
  assertCan(ctx, "portal.manage");
  const token = newToken();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.portalGrant.updateMany({ where: { id: grantId, companyId: ctx.companyId, status: "INVITED" }, data: { inviteTokenHash: hashToken(token), inviteExpiresAt: inviteExpiry() } });
    if (r.count === 0) throw new Error("Only invitations not yet accepted can get a new link");
  });
  return token;
}

export async function revokeGrant(ctx: Ctx, grantId: string) {
  assertCan(ctx, "portal.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const g = await tx.portalGrant.findFirst({ where: { id: grantId, companyId: ctx.companyId } });
    if (!g) throw new Error("Portal access not found");
    if (g.status === "REVOKED") return;
    await tx.portalGrant.update({ where: { id: g.id }, data: { status: "REVOKED", revokedAt: new Date(), inviteTokenHash: null } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "PortalGrant", entityId: g.id, action: "portal.revoked", detail: { email: g.email, kind: g.kind } });
    if (g.userId) await notify(tx, g.userId, { kind: "portal.revoked", title: "Your portal access was removed", body: "The company has removed your access. Contact them if you think this is a mistake.", link: "/portal", email: false });
  });
}

/** Vendor submissions on one work order, for the company to review. */
export async function submissionsFor(ctx: Ctx, workOrderId: string) {
  assertCan(ctx, "maintenance.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.vendorSubmission.findMany({
      where: { companyId: ctx.companyId, workOrderId }, orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, amountKobo: true, note: true, docName: true, docMime: true, status: true, decidedAt: true, decisionNote: true, createdAt: true, grantId: true },
    }));
}

export async function pendingSubmissionCount(ctx: Ctx) {
  if (!can(ctx.role, "maintenance.manage")) return 0;
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.vendorSubmission.count({ where: { companyId: ctx.companyId, status: "SUBMITTED" } }));
}

export async function decideSubmission(ctx: Ctx, id: string, accept: boolean, noteInput: string) {
  assertCan(ctx, "maintenance.manage");
  const note = noteInput.trim().slice(0, 1000);
  if (!accept && note.length < 3) throw new Error("Say why it is not accepted, so the vendor can correct it");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.vendorSubmission.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!s) throw new Error("Submission not found");
    if (s.status !== "SUBMITTED") throw new Error("This submission has already been decided");
    await tx.vendorSubmission.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
    const wo = await tx.workOrder.findFirst({ where: { id: s.workOrderId, companyId: ctx.companyId }, select: { id: true, ref: true, title: true } });
    if (accept && wo) {
      const effect = acceptEffect(s.kind as SubmissionKind, s.amountKobo);
      if (Object.keys(effect).length) await tx.workOrder.update({ where: { id: wo.id }, data: effect });
    }
    if (wo) {
      await tx.workOrderEvent.create({ data: { companyId: ctx.companyId, workOrderId: wo.id, kind: accept ? "vendor.accepted" : "vendor.rejected", note: `${s.kind.toLowerCase()}${note ? `: ${note}` : ""}`.slice(0, 1000), actorId: ctx.userId }, select: { id: true } });
      await notify(tx, s.userId, {
        kind: "portal.decision", title: `${wo.ref}: your ${s.kind.toLowerCase()} was ${accept ? "accepted" : "not accepted"}`,
        body: note || wo.title, link: `/portal/vendor/${s.grantId}/jobs/${wo.id}`,
      });
    }
    return s.workOrderId;
  });
}

export async function submissionDocForCompany(ctx: Ctx, id: string) {
  assertCan(ctx, "maintenance.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.vendorSubmission.findFirst({ where: { id, companyId: ctx.companyId, docBytes: { not: null } }, select: { docBytes: true, docMime: true, docName: true } }));
}

export async function vendorProfileForCompany(ctx: Ctx, grantId: string) {
  assertCan(ctx, "portal.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.vendorProfile.findFirst({ where: { grantId, companyId: ctx.companyId }, select: { serviceAreas: true, qualifications: true, insuranceNote: true, docName: true, docMime: true, docBytes: true, updatedAt: true } }));
}

// ---------- Accepting an invitation ----------

export async function findPortalInvite(token: string) {
  const tokenHash = hashToken(token);
  const g = await withInviteToken(tokenHash, (tx) => tx.portalGrant.findUnique({ where: { inviteTokenHash: tokenHash } }));
  if (!g || g.status !== "INVITED" || !g.inviteExpiresAt || g.inviteExpiresAt < new Date()) return null;
  const company = await withTenant(g.companyId, SYSTEM, (tx) => tx.company.findUnique({ where: { id: g.companyId }, select: { name: true, suspendedAt: true } }));
  if (!company || company.suspendedAt) return null;
  return { id: g.id, kind: g.kind, email: g.email, displayName: g.displayName, companyName: company.name };
}

export async function acceptPortalInvite(token: string, user: { id: string; email: string }) {
  const tokenHash = hashToken(token);
  const invite = await findPortalInvite(token);
  if (!invite) throw new Error("This invitation is invalid or has already been used. Ask the company for a new one.");
  if (invite.email !== user.email.toLowerCase()) throw new Error(`This invitation is for ${invite.email}. Sign in as that account to accept it.`);
  await withInviteTokenAs(tokenHash, user.id, async (tx) => {
    const r = await tx.portalGrant.updateMany({ where: { inviteTokenHash: tokenHash, status: "INVITED" }, data: { status: "ACTIVE", userId: user.id, acceptedAt: new Date(), inviteTokenHash: null } });
    if (r.count === 0) throw new Error("This invitation has already been used");
  });
  const g = await withUser(user.id, (tx) => tx.portalGrant.findFirst({ where: { id: invite.id, userId: user.id } }));
  if (g) await withTenant(g.companyId, SYSTEM, (tx) => logActivity(tx, { companyId: g.companyId, actorId: user.id, entityType: "PortalGrant", entityId: g.id, action: "portal.accepted", detail: { kind: g.kind } }));
  return invite;
}

// ---------- The portal holder's side ----------

/** The grants a person holds, with company names. Companies the platform has suspended are left out. */
export async function myPortals(userId: string) {
  const [grants, providers] = await Promise.all([
    withUser(userId, (tx) => tx.portalGrant.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { acceptedAt: "desc" }, select: { id: true, kind: true, companyId: true, displayName: true, acceptedAt: true } })),
    myProviders(userId),
  ]);
  const out = [];
  for (const g of grants) {
    const c = await withTenant(g.companyId, SYSTEM, (tx) => tx.company.findUnique({ where: { id: g.companyId }, select: { name: true, suspendedAt: true } }));
    if (c && !c.suspendedAt) out.push({ ...g, companyName: c.name });
  }
  return { grants: out, providers };
}

async function holdGrant(userId: string, grantId: string, kind: "OWNER" | "VENDOR") {
  const g = await withUser(userId, (tx) => tx.portalGrant.findFirst({ where: { id: grantId, userId, status: "ACTIVE", kind } }));
  if (!g) return null;
  const c = await withTenant(g.companyId, SYSTEM, (tx) => tx.company.findUnique({ where: { id: g.companyId }, select: { name: true, suspendedAt: true } }));
  if (!c || c.suspendedAt) return null;
  return { ...g, companyName: c.name };
}

/** Everything the owner portal shows. Enquirers and inspection visitors are counted, never named. */
export async function ownerPortal(userId: string, grantId: string) {
  const g = await holdGrant(userId, grantId, "OWNER");
  if (!g) return null;
  const assetIds = (await withUser(userId, (tx) => tx.portalGrantAsset.findMany({ where: { grantId: g.id }, select: { assetId: true } }))).map((a) => a.assetId);
  const companyId = g.companyId;
  const since30 = new Date(Date.now() - 30 * 864e5);
  const day30 = lagosDay(since30);
  const result = await withTenant(companyId, SYSTEM, async (tx) => {
    const assets = await tx.asset.findMany({ where: { companyId, id: { in: assetIds } }, select: { id: true, ref: true, name: true, city: true, state: true, status: true, category: true }, orderBy: { name: "asc" } });
    const ids = assets.map((a) => a.id);
    const listings = await tx.listing.findMany({ where: { companyId, assetId: { in: ids } }, select: { id: true, assetId: true, publicRef: true, title: true, status: true, priceKobo: true, purpose: true, pricePeriod: true } });
    const listingIds = listings.map((l) => l.id);
    const [enquiries30, enquiriesAll, bookings, leases, workOrders, reports] = await Promise.all([
      tx.enquiry.groupBy({ by: ["listingId"], where: { companyId, listingId: { in: listingIds }, createdAt: { gte: since30 } }, _count: { _all: true } }),
      tx.enquiry.groupBy({ by: ["listingId"], where: { companyId, listingId: { in: listingIds } }, _count: { _all: true } }),
      tx.inspectionBooking.groupBy({ by: ["listingId", "status"], where: { companyId, listingId: { in: listingIds } }, _count: { _all: true } }),
      tx.lease.findMany({
        where: { companyId, assetId: { in: ids } }, orderBy: [{ status: "asc" }, { endDate: "desc" }],
        select: { id: true, assetId: true, ref: true, unit: true, occupantName: true, startDate: true, endDate: true, rentKobo: true, frequency: true, status: true,
          charges: { select: { dueDate: true, amountKobo: true, adjustedKobo: true, paidKobo: true }, orderBy: { dueDate: "asc" } } },
      }),
      tx.workOrder.findMany({
        where: { companyId, assetId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, assetId: true, ref: true, title: true, status: true, priority: true, createdAt: true, approvedCostKobo: true, actualCostKobo: true, completedOn: true },
      }),
      tx.valuationReport.findMany({
        where: { companyId, status: "APPROVED", instruction: { assetId: { in: ids } } }, orderBy: { decidedAt: "desc" },
        select: { id: true, version: true, concludedValueKobo: true, decidedAt: true, summary: true, instruction: { select: { ref: true, assetId: true, purpose: true } } },
      }),
    ]);
    const n = (rows: { listingId: string; _count: { _all: number } }[], id: string) => rows.filter((r) => r.listingId === id).reduce((s, r) => s + r._count._all, 0);
    const today = new Date();
    return {
      grant: { id: g.id, companyName: g.companyName, displayName: g.displayName },
      assets: assets.map((a) => {
        const l = listings.find((x) => x.assetId === a.id) ?? null;
        return {
          ...a,
          listing: l ? {
            ...l, views30: 0, enquiries30: n(enquiries30, l.id), enquiriesAll: n(enquiriesAll, l.id),
            bookings: Object.fromEntries(bookings.filter((b) => b.listingId === l.id).map((b) => [b.status, b._count._all])) as Record<string, number>,
          } : null,
        };
      }),
      leases: leases.map(({ charges, ...l }) => ({ ...l, rent: rentPosition(charges, today), upcoming: charges.filter((c) => c.dueDate >= today).slice(0, 3) })),
      workOrders, reports,
    };
  });
  // Visit counts sit in a platform table; read only the counts for these listings.
  const listingIds = result.assets.flatMap((a) => (a.listing ? [a.listing.id] : []));
  if (listingIds.length) {
    const views = await withPlatformAdmin(SYSTEM, (tx) => tx.listingViewKey.groupBy({ by: ["listingId"], where: { listingId: { in: listingIds }, day: { gte: day30 } }, _count: { _all: true } }));
    for (const a of result.assets) if (a.listing) a.listing.views30 = views.find((v) => v.listingId === a.listing!.id)?._count._all ?? 0;
  }
  return result;
}

/** The vendor portal: the contractor record, its jobs, the vendor's profile and what it has sent. */
export async function vendorPortal(userId: string, grantId: string) {
  const g = await holdGrant(userId, grantId, "VENDOR");
  if (!g || !g.contractorId) return null;
  const contractorId = g.contractorId;
  const [profile, submissions] = await Promise.all([
    withUser(userId, (tx) => tx.vendorProfile.findUnique({ where: { grantId: g.id }, select: { serviceAreas: true, qualifications: true, insuranceNote: true, docName: true, updatedAt: true } })),
    withUser(userId, (tx) => tx.vendorSubmission.findMany({ where: { grantId: g.id, userId }, orderBy: { createdAt: "desc" }, select: { id: true, workOrderId: true, kind: true, amountKobo: true, status: true, createdAt: true, decisionNote: true } })),
  ]);
  const data = await withTenant(g.companyId, SYSTEM, async (tx) => {
    const contractor = await tx.contractor.findFirst({ where: { id: contractorId, companyId: g.companyId }, select: { name: true, trade: true, active: true } });
    const jobs = await tx.workOrder.findMany({
      where: { companyId: g.companyId, contractorId, status: { in: [...VENDOR_VISIBLE] } }, orderBy: [{ status: "asc" }, { targetDate: "asc" }], take: 200,
      select: { id: true, ref: true, title: true, status: true, priority: true, safetyRisk: true, targetDate: true, asset: { select: { name: true, city: true } } },
    });
    return { contractor, jobs };
  });
  return { grant: { id: g.id, companyName: g.companyName, displayName: g.displayName }, profile, submissions, ...data };
}

/** One job, as the vendor sees it: what to do and where, never the tenant's contact details or internal notes. */
export async function vendorJob(userId: string, grantId: string, workOrderId: string) {
  const g = await holdGrant(userId, grantId, "VENDOR");
  if (!g || !g.contractorId) return null;
  const contractorId = g.contractorId;
  const job = await withTenant(g.companyId, SYSTEM, (tx) =>
    tx.workOrder.findFirst({
      where: { id: workOrderId, companyId: g.companyId, contractorId, status: { in: [...VENDOR_VISIBLE] } },
      select: { id: true, ref: true, title: true, description: true, status: true, priority: true, safetyRisk: true, targetDate: true, approvedCostKobo: true, completedOn: true,
        asset: { select: { name: true, address: true, city: true, state: true } } },
    }));
  if (!job) return null;
  const submissions = await withUser(userId, (tx) => tx.vendorSubmission.findMany({
    where: { grantId: g.id, userId, workOrderId }, orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, amountKobo: true, note: true, docName: true, status: true, createdAt: true, decisionNote: true, decidedAt: true },
  }));
  return { grant: { id: g.id, companyName: g.companyName }, job, submissions };
}

const profileSchema = z.object({
  serviceAreas: z.string().trim().max(500, "Keep service areas under 500 characters"),
  qualifications: z.string().trim().max(2000, "Keep qualifications under 2,000 characters"),
  insuranceNote: z.string().trim().max(500, "Keep the insurance note under 500 characters"),
});

export async function saveVendorProfile(userId: string, grantId: string, input: z.input<typeof profileSchema>, doc: PortalDoc) {
  const g = await holdGrant(userId, grantId, "VENDOR");
  if (!g) throw new Error("Portal access not found");
  const data = profileSchema.parse(input);
  checkDoc(doc);
  const file = doc ? { docMime: doc.type, docBytes: Buffer.from(doc.bytes), docName: doc.name.slice(0, 200) } : {};
  await withUser(userId, (tx) => tx.vendorProfile.upsert({
    where: { grantId: g.id },
    create: { grantId: g.id, companyId: g.companyId, userId, ...data, ...file },
    update: { ...data, ...file },
  }));
}

export async function submitVendorWork(userId: string, grantId: string, workOrderId: string, input: { kind: string; amount: string; note: string }, doc: PortalDoc) {
  const g = await holdGrant(userId, grantId, "VENDOR");
  if (!g || !g.contractorId) throw new Error("Portal access not found");
  const kind = z.enum(["QUOTE", "INVOICE", "COMPLETION"]).parse(input.kind);
  const note = input.note.trim();
  const amountKobo = kind === "COMPLETION" ? null : parseNaira(input.amount);
  checkDoc(doc);
  if (kind === "COMPLETION" && !doc && note.length < 10) throw new Error("Describe the work you completed or attach evidence");
  const contractorId = g.contractorId;
  const job = await withTenant(g.companyId, SYSTEM, (tx) => tx.workOrder.findFirst({ where: { id: workOrderId, companyId: g.companyId, contractorId }, select: { id: true, ref: true, status: true } }));
  if (!job) throw new Error("Job not found");
  const problems = checkSubmissionInput(kind, job.status, amountKobo, doc && kind === "COMPLETION" ? note.padEnd(10, ".") : note);
  if (problems.length) throw new Error(problems.join(". "));
  const pending = await withUser(userId, (tx) => tx.vendorSubmission.count({ where: { grantId: g.id, workOrderId, kind, status: "SUBMITTED" } }));
  if (pending > 0) throw new Error("You already sent one of these that the company has not decided on yet");
  const s = await withUser(userId, (tx) => tx.vendorSubmission.create({
    data: { companyId: g.companyId, workOrderId, grantId: g.id, userId, kind, amountKobo, note,
      ...(doc ? { docMime: doc.type, docBytes: Buffer.from(doc.bytes), docName: doc.name.slice(0, 200) } : {}) },
    select: { id: true },
  }));
  await withTenant(g.companyId, SYSTEM, async (tx) => {
    await tx.workOrderEvent.create({ data: { companyId: g.companyId, workOrderId, kind: "vendor.submitted", note: `${kind.toLowerCase()} from ${g.displayName}`, actorId: userId }, select: { id: true } });
    const managers = await tx.membership.findMany({ where: { companyId: g.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true }, take: 20 });
    for (const m of managers) {
      await notify(tx, m.userId, { kind: "maintenance.vendor_submission", title: `${job.ref}: ${g.displayName} sent a ${kind.toLowerCase()}`, body: "Review it on the work order.", link: `/app/maintenance/${workOrderId}#vendor`, dedupeKey: s.id });
    }
  });
  return s.id;
}

export async function submissionDocForVendor(userId: string, id: string) {
  return withUser(userId, (tx) => tx.vendorSubmission.findFirst({ where: { id, userId, docBytes: { not: null } }, select: { docBytes: true, docMime: true, docName: true } }));
}

// ---------- Professional services providers ----------

export async function myProviders(userId: string) {
  const rows = await withUser(userId, (tx) => tx.providerMember.findMany({ where: { userId }, select: { providerId: true } }));
  if (rows.length === 0) return [];
  return prisma.serviceProvider.findMany({ where: { id: { in: rows.map((r) => r.providerId) }, status: "APPROVED" }, select: { id: true, name: true, shortName: true } });
}

async function holdProvider(userId: string, providerId: string) {
  const m = await withUser(userId, (tx) => tx.providerMember.findFirst({ where: { userId, providerId } }));
  if (!m) return null;
  // Onboarding: only an approved provider sees its leads; a pending or suspended one sees none.
  return prisma.serviceProvider.findFirst({ where: { id: providerId, status: "APPROVED" }, select: { id: true, name: true, shortName: true } });
}

export async function providerLeads(userId: string, providerId: string, status: LeadStatus | null) {
  const provider = await holdProvider(userId, providerId);
  if (!provider) return null;
  const [leads, counts] = await Promise.all([
    prisma.providerLead.findMany({
      where: { providerId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, ref: true, listingRef: true, name: true, contactMethod: true, contactValue: true, note: true, status: true, providerNote: true, createdAt: true, consentGivenAt: true, updatedAt: true },
    }),
    prisma.providerLead.groupBy({ by: ["status"], where: { providerId }, _count: { _all: true } }),
  ]);
  return { provider, leads, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

export async function updateProviderLead(userId: string, providerId: string, ref: string, to: LeadStatus, noteInput: string) {
  const provider = await holdProvider(userId, providerId);
  if (!provider) throw new Error("Provider access not found");
  const lead = await prisma.providerLead.findFirst({ where: { ref, providerId } });
  if (!lead) throw new Error("Request not found");
  if (!canMoveLead(lead.status as LeadStatus, to)) throw new Error("That status change is not allowed");
  const note = noteInput.trim().slice(0, 1000);
  await prisma.providerLead.update({ where: { id: lead.id }, data: { status: to, ...(note ? { providerNote: note } : {}) } });
  if (lead.userId) {
    await withUser(lead.userId, (tx) => notify(tx, lead.userId!, { kind: "verification.update", title: `${provider.name} updated your request ${lead.ref}`, body: note, link: "/me", email: false }));
  }
}

// ---------- Platform administration of provider members ----------

export async function providerMembers(adminId: string) {
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.providerMember.findMany({ orderBy: { createdAt: "asc" } });
    const users = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true, email: true } });
    return rows.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) ?? null }));
  });
}

export async function addProviderMember(adminId: string, providerId: string, emailInput: string) {
  const address = email.parse(emailInput);
  await withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.serviceProvider.findUnique({ where: { id: providerId } });
    if (!p) throw new Error("Provider not found");
    const u = await tx.user.findUnique({ where: { email: address }, select: { id: true } });
    if (!u) throw new Error("No account uses that email. Ask the person to create an account first.");
    await tx.providerMember.upsert({ where: { providerId_userId: { providerId, userId: u.id } }, create: { providerId, userId: u.id, addedById: adminId }, update: {} });
    await notify(tx, u.id, { kind: "portal.provider_added", title: `You can now see requests sent to ${p.name}`, body: "Open the provider portal to follow them up.", link: `/portal/provider/${p.id}` });
  });
}

export async function removeProviderMember(adminId: string, memberId: string) {
  await withPlatformAdmin(adminId, (tx) => tx.providerMember.deleteMany({ where: { id: memberId } }));
}

/** Whether to show the Portals link in the person's account menu. */
export async function portalCount(userId: string) {
  return withUser(userId, async (tx) => (await tx.portalGrant.count({ where: { userId, status: "ACTIVE" } })) + (await tx.providerMember.count({ where: { userId } })));
}
