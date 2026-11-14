/**
 * Platform administrators acting on a person's account for shady activity (fraud, fake listings, scams, abuse):
 *  - Suspend: sign-in is refused and every session ends; their agent profiles and their own agent workspace leave public
 *    view. Nothing is deleted. The reason is recorded and the person is told by email.
 *  - Restore: the reverse, with a reason recorded.
 *  - Remove permanently: the account's personal details are erased (as when a person deletes their own account), any company
 *    where they were the only top administrator is suspended, and their email address and phone number can never be used to
 *    create an account again (only a hash of each is kept). What other people or the law need is kept without their name.
 * Platform administrator accounts are never suspended or removed here.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import { notify } from "./notifications";
import { system } from "./rewards";
import { eraseAccount } from "./privacy";
import { suspendCompany, restoreCompany } from "./governance";

const reasonSchema = z.string().trim().min(10, "Give the reason (10 characters or more). It is recorded, and the person is told.").max(1000);
/** Marks a workspace this service suspended along with its owner, so restoring the owner restores it too. */
const MARK = "Account suspended: ";

const normEmail = (e: string) => e.trim().toLowerCase();
const normPhone = (p: string) => p.replace(/[^\d+]/g, "").replace(/^0/, "+234").replace(/^234/, "+234");
export const identityHash = (kind: "EMAIL" | "PHONE", value: string) => createHash("sha256").update(`${kind}:${kind === "EMAIL" ? normEmail(value) : normPhone(value)}`).digest("hex");

async function target(adminId: string, userId: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!admin?.isPlatformAdmin) throw new Error("Only a platform administrator can do that.");
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) throw new Error("That account was not found.");
  if (u.isPlatformAdmin) throw new Error("Platform administrator accounts cannot be suspended or removed here.");
  if (u.removedAt) throw new Error("This account has already been removed.");
  return u;
}

/**
 * Workspaces the person owns alone: their own agent workspace, or companies where they are the only top administrator.
 * Memberships are read as the person (row-level security shows a member their own) and counted inside each company.
 */
async function soleOwned(userId: string) {
  const ms = await withUser(userId, (tx) => tx.membership.findMany({ where: { userId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN" }, select: { companyId: true, company: { select: { businessType: true, suspendedAt: true } } } }));
  const out: { companyId: string; agentOwn: boolean; suspended: boolean }[] = [];
  for (const m of ms) {
    const others = await withTenant(m.companyId, "system", (tx) => tx.membership.count({ where: { companyId: m.companyId, status: "ACTIVE", role: "COMPANY_SUPER_ADMIN", NOT: { userId } } }));
    if (others === 0) out.push({ companyId: m.companyId, agentOwn: m.company.businessType === "INDEPENDENT_AGENT", suspended: !!m.company.suspendedAt });
  }
  return out;
}
const companiesOf = (userId: string) => withUser(userId, (tx) => tx.membership.findMany({ where: { userId }, select: { companyId: true, role: true, status: true } }));

export async function suspendUser(adminId: string, userId: string, reasonInput: string) {
  const reason = reasonSchema.parse(reasonInput);
  const u = await target(adminId, userId);
  if (u.suspendedAt) throw new Error("This account is already suspended.");
  const own = await soleOwned(userId);
  const cos = await companiesOf(userId);
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { suspendedAt: new Date(), suspendedReason: reason, suspendedById: adminId } });
    await tx.session.deleteMany({ where: { userId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "user", entityId: userId, action: "user.suspended", detail: { reason } });
  });
  for (const c of cos) await withTenant(c.companyId, "system", (tx) => tx.agentProfile.updateMany({ where: { userId, companyId: c.companyId }, data: { platformHidden: true } }));
  // Their own agent workspace goes with them (its listings and profile leave public view). A company with other staff carries on.
  for (const w of own.filter((o) => o.agentOwn && !o.suspended)) await suspendCompany(adminId, w.companyId, { reason: `${MARK}${reason}` });
  await system((tx) => notify(tx, userId, { kind: "security.account_suspended", title: "Your Housy account has been suspended", body: `Reason: ${reason} If you think this is a mistake, reply to this email or contact support from the address on the account.`, link: "/support" }));
}

export async function restoreUser(adminId: string, userId: string, noteInput: string) {
  const note = reasonSchema.parse(noteInput);
  const u = await target(adminId, userId);
  if (!u.suspendedAt) throw new Error("This account is not suspended.");
  const cos = await companiesOf(userId);
  const companies = await withPlatformAdmin(adminId, async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { suspendedAt: null, suspendedReason: "", suspendedById: null } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "user", entityId: userId, action: "user.restored", detail: { note } });
    return tx.company.findMany({ where: { id: { in: cos.map((c) => c.companyId) } }, select: { id: true, suspendedAt: true, suspendedReason: true } });
  });
  // Their own workspace, suspended with them, comes back; then their profiles, except in companies still suspended for other reasons.
  for (const c of companies.filter((c) => c.suspendedAt && c.suspendedReason.startsWith(MARK))) await restoreCompany(adminId, c.id, `Owner's account restored: ${note}`);
  for (const c of companies.filter((c) => !c.suspendedAt || c.suspendedReason.startsWith(MARK))) await withTenant(c.id, "system", (tx) => tx.agentProfile.updateMany({ where: { userId, companyId: c.id }, data: { platformHidden: false } }));
  await system((tx) => notify(tx, userId, { kind: "security.account_restored", title: "Your Housy account has been restored", body: note, link: "/login" }));
}

/** Remove an account for good. Needs the reason and the word REMOVE typed to confirm. */
export async function removeUserPermanently(adminId: string, userId: string, reasonInput: string, confirm: string) {
  const reason = reasonSchema.parse(reasonInput);
  if (confirm.trim().toUpperCase() !== "REMOVE") throw new Error("Type REMOVE to confirm.");
  const u = await target(adminId, userId);
  const own = await soleOwned(userId);
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.session.deleteMany({ where: { userId } });
    if (!u.suspendedAt) await tx.user.update({ where: { id: userId }, data: { suspendedAt: new Date(), suspendedReason: reason, suspendedById: adminId } });
    for (const [kind, value] of [["EMAIL", u.email], ["PHONE", u.phone]] as const) {
      if (!value || (kind === "PHONE" && value.replace(/\D/g, "").length < 7)) continue;
      await tx.blockedIdentity.createMany({ data: [{ kind, valueHash: identityHash(kind, value), reason, userId, createdById: adminId }], skipDuplicates: true });
    }
  });
  // Tell them before their email address is erased.
  await system((tx) => notify(tx, userId, { kind: "security.account_removed", title: "Your Housy account has been removed", body: `Reason: ${reason}`, link: "/support" })).catch(() => undefined);
  for (const w of own.filter((o) => !o.suspended)) await suspendCompany(adminId, w.companyId, { reason: `Its only administrator's account was removed: ${reason}` });
  return eraseAccount(userId, adminId, "user.removed", { reason }, true);
}

/** Refuses an email address or phone number that belongs to a removed account. Called before any account is created. */
export async function assertNotBlocked(email: string, phone: string) {
  const hashes = [identityHash("EMAIL", email), ...(phone && phone.replace(/\D/g, "").length >= 7 ? [identityHash("PHONE", phone)] : [])];
  const hit = await system((tx) => tx.blockedIdentity.findFirst({ where: { valueHash: { in: hashes } }, select: { id: true } }));
  if (hit) throw new Error("An account cannot be created with these details. If you think this is a mistake, contact support.");
}

/** People for the administrator to find: by name, email or phone; suspended and removed ones can be listed on their own. */
export async function findPeople(adminId: string, f: { q?: string; status?: "suspended" | "removed" | ""; page?: number }) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!admin?.isPlatformAdmin) throw new Error("Only a platform administrator can do that.");
  const q = (f.q ?? "").trim();
  const page = Math.max(1, f.page ?? 1), size = 25;
  const where = {
    ...(f.status === "suspended" ? { suspendedAt: { not: null }, removedAt: null } : f.status === "removed" ? { removedAt: { not: null } } : {}),
    ...(q ? { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q.replace(/\s+/g, "") } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size, select: { id: true, name: true, email: true, phone: true, isPlatformAdmin: true, suspendedAt: true, suspendedReason: true, removedAt: true, createdAt: true } }),
    prisma.user.count({ where }),
  ]);
  return { rows, total, page, size };
}

/** One person, for the administrator: their workspaces and the moderation history. */
export async function personForAdmin(adminId: string, userId: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!admin?.isPlatformAdmin) throw new Error("Only a platform administrator can do that.");
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true, isPlatformAdmin: true, suspendedAt: true, suspendedReason: true, removedAt: true, createdAt: true } });
  if (!u) return null;
  return withPlatformAdmin(adminId, async (tx) => {
    const ms = await companiesOf(userId);
    const cos = await tx.company.findMany({ where: { id: { in: ms.map((m) => m.companyId) } }, select: { id: true, name: true, businessType: true, suspendedAt: true } });
    const memberships = ms.flatMap((m) => { const company = cos.find((c) => c.id === m.companyId); return company ? [{ role: m.role, status: m.status, company }] : []; });
    const [history, sessions] = await Promise.all([
      tx.activityLog.findMany({ where: { entityType: "user", entityId: userId, action: { in: ["user.suspended", "user.restored", "user.removed", "auth.account_closed", "auth.account_reopened"] } }, orderBy: { createdAt: "desc" }, take: 30, select: { action: true, actorId: true, createdAt: true, detail: true } }),
      tx.session.count({ where: { userId, expiresAt: { gt: new Date() } } }),
    ]);
    return { ...u, memberships, history, sessions };
  });
}
