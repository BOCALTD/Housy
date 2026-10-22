import { z } from "zod";
import { withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { notify } from "./notifications";
import { system } from "./rewards";
import { trustMany } from "./kyc";
import { assertCan, type Ctx } from "./context";

export const ACCESS_PURPOSES = {
  SUPPORT_REQUEST: "The company asked for help", TRUST_CASE: "A Trust and Safety case", LEGAL_REQUEST: "A legal request",
  BILLING: "A billing question", DATA_CORRECTION: "Correcting data at the company's request",
} as const;
export const ACCESS_MINUTES = 60;

async function companyAdmins(companyId: string) {
  return withTenant(companyId, "system", async (tx) => (await tx.membership.findMany({ where: { companyId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN" }, select: { userId: true } })).map((m) => m.userId));
}

export async function adminCompanies(adminId: string, o: { q?: string; status?: string; page?: number }) {
  const page = Math.max(0, o.page ?? 0);
  return withPlatformAdmin(adminId, async (tx) => {
    const where = {
      ...(o.q ? { name: { contains: o.q.trim().slice(0, 80), mode: "insensitive" as const } } : {}),
      ...(o.status === "suspended" ? { suspendedAt: { not: null } } : o.status === "active" ? { suspendedAt: null } : {}),
    };
    const [total, rows] = await Promise.all([tx.company.count({ where }), tx.company.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * 25, take: 25, select: { id: true, name: true, createdAt: true, suspendedAt: true } })]);
    const trust = await trustMany("COMPANY", rows.map((r) => r.id));
    return { total, page, rows: rows.map((r) => ({ ...r, trust: trust.get(r.id)! })) };
  });
}

/** A company at a glance: counts only, no records. Seeing records needs a stated purpose (openCompanyRecords). */
export async function adminCompany(adminId: string, companyId: string) {
  const c = await withPlatformAdmin(adminId, (tx) => tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, createdAt: true, suspendedAt: true, suspendedReason: true } }));
  if (!c) return null;
  const counts = await withTenant(companyId, "system", async (tx) => ({
    members: await tx.membership.count({ where: { companyId, status: "ACTIVE" } }),
    assets: await tx.asset.count({ where: { companyId } }),
    listings: await tx.listing.count({ where: { companyId } }),
    published: await tx.listing.count({ where: { companyId, status: "PUBLISHED" } }),
  }));
  const [grants, trust] = await Promise.all([
    withPlatformAdmin(adminId, (tx) => tx.adminAccessGrant.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 20 })),
    trustMany("COMPANY", [companyId]),
  ]);
  return { ...c, counts, grants, trust: trust.get(companyId)! };
}

const suspendSchema = z.object({ reason: z.string().trim().min(5, "Give the reason (the company sees it)").max(1000) });

/** Suspend a company: its people cannot use the workspace, its API keys stop working, and its listings and profiles leave public view. Nothing is deleted. */
export async function suspendCompany(adminId: string, companyId: string, input: z.input<typeof suspendSchema>) {
  const { reason } = suspendSchema.parse(input);
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.company.findUnique({ where: { id: companyId } });
    if (!c) throw new Error("Company not found");
    if (c.suspendedAt) throw new Error("This company is already suspended");
    await tx.company.update({ where: { id: companyId }, data: { suspendedAt: new Date(), suspendedReason: reason, suspendedById: adminId } });
    await tx.listing.updateMany({ where: { companyId }, data: { platformHidden: true } });
    await tx.agentProfile.updateMany({ where: { companyId }, data: { platformHidden: true } });
    await tx.companyProfile.updateMany({ where: { companyId }, data: { platformHidden: true } });
    await logActivity(tx, { companyId, actorId: adminId, entityType: "company", entityId: companyId, action: "company.suspended", detail: { reason } });
  });
  const admins = await companyAdmins(companyId);
  await system(async (tx) => { for (const u of admins) await notify(tx, u, { kind: "security.company_suspended", title: "Your company has been suspended", body: reason, link: "/suspended" }); });
}

export async function restoreCompany(adminId: string, companyId: string, note: string) {
  const text = note.trim();
  if (text.length < 5) throw new Error("Say why it is restored");
  await withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.company.findUnique({ where: { id: companyId } });
    if (!c?.suspendedAt) throw new Error("This company is not suspended");
    await tx.company.update({ where: { id: companyId }, data: { suspendedAt: null, suspendedReason: "", suspendedById: null } });
    await tx.listing.updateMany({ where: { companyId }, data: { platformHidden: false } });
    await tx.agentProfile.updateMany({ where: { companyId }, data: { platformHidden: false } });
    await tx.companyProfile.updateMany({ where: { companyId }, data: { platformHidden: false } });
    await logActivity(tx, { companyId, actorId: adminId, entityType: "company", entityId: companyId, action: "company.restored", detail: { note: text } });
  });
  const admins = await companyAdmins(companyId);
  await system(async (tx) => { for (const u of admins) await notify(tx, u, { kind: "security.company_restored", title: "Your company has been restored", body: text, link: "/app" }); });
}

/** Whether a company is suspended (read as the company, so it works for any caller). */
export async function companySuspension(companyId: string) {
  const c = await withTenant(companyId, "system", (tx) => tx.company.findFirst({ where: { id: companyId }, select: { suspendedAt: true, suspendedReason: true } }));
  return c?.suspendedAt ? { at: c.suspendedAt, reason: c.suspendedReason } : null;
}

const grantSchema = z.object({
  purpose: z.string().refine((p) => p in ACCESS_PURPOSES, "Choose the purpose"),
  caseRef: z.string().trim().max(40).default(""),
  note: z.string().trim().min(10, "Describe what you need to see and why (at least a sentence)").max(1000),
});

/**
 * Open a company's records for a stated purpose, for one hour. Recorded, shown to the company in its settings, and the company's
 * top administrators are told. Platform administrators see records only through this.
 */
export async function openCompanyRecords(adminId: string, companyId: string, input: z.input<typeof grantSchema>, now = new Date()) {
  const d = grantSchema.parse(input);
  const grant = await withPlatformAdmin(adminId, async (tx) => {
    if (!(await tx.company.findUnique({ where: { id: companyId }, select: { id: true } }))) throw new Error("Company not found");
    const g = await tx.adminAccessGrant.create({ data: { adminId, companyId, purpose: d.purpose, caseRef: d.caseRef, note: d.note, createdAt: now, expiresAt: new Date(now.getTime() + ACCESS_MINUTES * 60_000) } });
    await logActivity(tx, { companyId, actorId: adminId, entityType: "company", entityId: companyId, action: "admin.records_opened", detail: { purpose: d.purpose, caseRef: d.caseRef, note: d.note } });
    return g;
  });
  const admins = await companyAdmins(companyId);
  await system(async (tx) => { for (const u of admins) await notify(tx, u, { kind: "security.admin_access", title: "A platform administrator opened your company's records", body: `Purpose: ${ACCESS_PURPOSES[d.purpose as keyof typeof ACCESS_PURPOSES]}. ${d.note}`, link: "/app/settings#access" }); });
  return grant.id;
}

export async function activeGrant(adminId: string, companyId: string, now = new Date()) {
  return withPlatformAdmin(adminId, (tx) => tx.adminAccessGrant.findFirst({ where: { adminId, companyId, expiresAt: { gt: now } }, orderBy: { expiresAt: "desc" } }));
}

/** Read-only summaries of a company's records, only while the administrator holds an access grant. */
export async function companyRecordsForAdmin(adminId: string, companyId: string) {
  const g = await activeGrant(adminId, companyId);
  if (!g) throw new Error("Open the records with a stated purpose first");
  return withTenant(companyId, "system", async (tx) => ({
    grant: g,
    members: await tx.membership.findMany({ where: { companyId }, select: { role: true, status: true, user: { select: { name: true, email: true } } }, take: 100 }),
    assets: await tx.asset.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50, select: { ref: true, name: true, status: true, city: true } }),
    listings: await tx.listing.findMany({ where: { companyId }, orderBy: { updatedAt: "desc" }, take: 50, select: { publicRef: true, title: true, status: true } }),
    leases: await tx.lease.findMany({ where: { companyId }, orderBy: { startDate: "desc" }, take: 50, select: { ref: true, occupantName: true, status: true } }),
  }));
}

/** For the company: who from the platform opened its records, when and why. */
export async function accessLogForCompany(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.adminAccessGrant.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 30 }));
}
