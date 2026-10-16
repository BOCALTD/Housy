import { randomUUID } from "node:crypto";
import { z } from "zod";
import { enqueueEmail } from "./notifications";
import { prisma, withTenant, withInviteToken, withUser } from "../db";
import { logActivity } from "../audit";
import { hashPassword } from "../auth-hash";
import { hashToken, newToken } from "../tokens";
import { ALL_ROLES, type Role } from "../permissions";
import { assertCan, type Ctx } from "./context";

const email = z.string().trim().toLowerCase().email("Enter a valid email address");
const password = z.string().min(10, "Use a password of at least 10 characters").max(200);
const personName = z.string().trim().min(2, "Enter your full name").max(120);

const registerSchema = z.object({
  companyName: z.string().trim().min(2, "Enter the company name").max(160),
  name: personName,
  email,
  password,
});

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Create a user, their company workspace, and make them its Company Super Admin. */
export async function registerCompany(input: z.input<typeof registerSchema>) {
  const data = registerSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error("An account with that email already exists. Sign in instead.");

  const user = await prisma.user.create({
    data: { email: data.email, name: data.name, passwordHash: await hashPassword(data.password) },
  });
  const companyId = randomUUID();
  await withTenant(companyId, user.id, async (tx) => {
    await tx.company.create({ data: { id: companyId, name: data.companyName, slug: slugify(data.companyName) } });
    await tx.membership.create({ data: { companyId, userId: user.id, role: "COMPANY_SUPER_ADMIN" } });
    await logActivity(tx, {
      companyId, actorId: user.id, entityType: "company", entityId: companyId, action: "company.created",
      detail: { name: data.companyName },
    });
  });
  await enqueueEmail(prisma, user.id, { kind: "onboarding", template: "welcome", vars: { name: user.name, kind: "company" }, dedupeKey: "welcome" });
  return { userId: user.id, companyId };
}

const inviteSchema = z.object({
  email,
  role: z.enum(ALL_ROLES as [Role, ...Role[]]),
});

/** Create an invitation. Returns the one-time token; only its hash is stored. */
export async function inviteMember(ctx: Ctx, input: z.input<typeof inviteSchema>) {
  assertCan(ctx, "team.manage");
  const data = inviteSchema.parse(input);
  const token = newToken();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const already = await tx.membership.findFirst({
      where: { companyId: ctx.companyId, user: { email: data.email } },
    });
    if (already) throw new Error("That person is already a member of this company.");
    const inv = await tx.invitation.create({
      data: {
        companyId: ctx.companyId, email: data.email, role: data.role, tokenHash: hashToken(token),
        invitedById: ctx.userId, expiresAt: new Date(Date.now() + 7 * 864e5),
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "invitation", entityId: inv.id,
      action: "member.invited", detail: { email: data.email, role: data.role },
    });
  });
  return token;
}

export async function findInvitation(token: string) {
  const tokenHash = hashToken(token);
  return withInviteToken(tokenHash, (tx) =>
    tx.invitation.findUnique({ where: { tokenHash } }),
  );
}

const acceptNewSchema = z.object({ name: personName, password });

/**
 * Accept an invitation. If an account with the invited email exists, the caller must be signed in
 * as that user (existingUserId). Otherwise a new account is created with the given name and password.
 */
export async function acceptInvitation(
  token: string,
  opts: { existingUserId?: string; name?: string; password?: string },
) {
  const inv = await findInvitation(token);
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) {
    throw new Error("This invitation is invalid or has expired. Ask for a new one.");
  }
  let userId: string;
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  if (existing) {
    if (opts.existingUserId !== existing.id) {
      throw new Error(`Sign in as ${inv.email} to accept this invitation.`);
    }
    userId = existing.id;
  } else {
    const data = acceptNewSchema.parse({ name: opts.name, password: opts.password });
    const user = await prisma.user.create({
      data: { email: inv.email, name: data.name, passwordHash: await hashPassword(data.password) },
    });
    userId = user.id;
  }
  await withTenant(inv.companyId, userId, async (tx) => {
    await tx.membership.create({ data: { companyId: inv.companyId, userId, role: inv.role } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await logActivity(tx, {
      companyId: inv.companyId, actorId: userId, entityType: "invitation", entityId: inv.id,
      action: "member.joined", detail: { role: inv.role },
    });
  });
  return { userId, companyId: inv.companyId };
}

export async function listTeam(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => ({
    members: await tx.membership.findMany({
      where: { companyId: ctx.companyId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    invitations: await tx.invitation.findMany({
      where: { companyId: ctx.companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  }));
}

export async function changeMemberRole(ctx: Ctx, membershipId: string, role: Role, status: "ACTIVE" | "SUSPENDED") {
  assertCan(ctx, "team.manage");
  if (!ALL_ROLES.includes(role)) throw new Error("Choose a valid role");
  if (membershipId === ctx.membershipId) throw new Error("You cannot change your own role or suspend yourself.");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, companyId: ctx.companyId } });
    if (!m) throw new Error("That member was not found.");
    await tx.membership.update({ where: { id: m.id }, data: { role, status } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "membership", entityId: m.id,
      action: "member.updated", detail: { from: { role: m.role, status: m.status }, to: { role, status } },
    });
  });
}

export async function myCompanies(userId: string) {
  return withUser(userId, (tx) =>
    tx.membership.findMany({
      where: { userId, status: "ACTIVE" },
      select: { companyId: true, role: true, company: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}
