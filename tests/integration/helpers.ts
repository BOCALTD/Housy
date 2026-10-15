import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { registerCompany, inviteMember, acceptInvitation } from "../../src/lib/services/companies";
import type { Ctx } from "../../src/lib/services/context";
import type { Role } from "../../src/lib/permissions";
import { todayInLagos, toDateOnlyString } from "../../src/lib/dates";

export const PASSWORD = "integration-test-pw";

/** Register a fresh company and return its Company Super Admin context. */
export async function newCompany(label: string): Promise<Ctx> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const { userId, companyId } = await registerCompany({ companyName: `Test ${label}`, name: `${label} Admin`, email, password: PASSWORD });
  const m = await withTenant(companyId, userId, (tx) => tx.membership.findFirstOrThrow({ where: { companyId, userId } }));
  return { userId, companyId, membershipId: m.id, role: m.role as Role };
}

/** The same user and company with a different role, for permission checks. */
export function withRole(ctx: Ctx, role: Role): Ctx {
  return { ...ctx, role };
}

export async function newPlatformAdmin() {
  return prisma.user.create({
    data: { email: `admin-${randomUUID().slice(0, 8)}@example.test`, name: "Test Admin", passwordHash: "x", isPlatformAdmin: true },
  });
}

export const PDF_BYTES = new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));

/** A second person in the same company with the given role (for checks that need two different people). */
export async function addMember(ctx: Ctx, role: Role, label = "member"): Promise<Ctx> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const token = await inviteMember(ctx, { email, role });
  const joined = await acceptInvitation(token, { name: `${label} ${role}`, password: PASSWORD });
  const m = await withTenant(ctx.companyId, joined.userId, (tx) =>
    tx.membership.findFirstOrThrow({ where: { companyId: ctx.companyId, userId: joined.userId } }));
  return { userId: joined.userId, companyId: ctx.companyId, membershipId: m.id, role: m.role as Role };
}

/** A date-only string this many days from today in Lagos, for tests that must not depend on the calendar. */
export function relativeDate(days: number): string {
  return toDateOnlyString(new Date(todayInLagos().getTime() + days * 864e5));
}
