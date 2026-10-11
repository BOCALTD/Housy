import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { registerCompany } from "../../src/lib/services/companies";
import type { Ctx } from "../../src/lib/services/context";
import type { Role } from "../../src/lib/permissions";

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
