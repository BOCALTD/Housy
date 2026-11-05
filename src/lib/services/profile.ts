import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import { INDEPENDENT_AGENT, normalisePhone } from "../account-type-rules";
import { checkProfileImage, type ProfileImageKind } from "../profile-rules";

/**
 * A person's own profile: photo, cover photo, name and bio; which hat they wear (personal, their agent business, or a company
 * they belong to); and "take a break". The users table has no row-level policy (it is the identity table), so every function
 * here acts only on the signed-in person's own id.
 */

export async function profileFor(userId: string) {
  const [user, media, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true, bio: true, breakUntil: true, breakStartedAt: true, createdAt: true } }),
    prisma.userMedia.findUnique({ where: { userId }, select: { avatarType: true, coverType: true, updatedAt: true } }),
    withUser(userId, (tx) => tx.membership.findMany({
      where: { userId, status: "ACTIVE", company: { suspendedAt: null } },
      select: { companyId: true, role: true, company: { select: { name: true, businessType: true } } },
      orderBy: { createdAt: "asc" },
    })),
  ]);
  if (!user) throw new Error("Account not found");
  const v = media?.updatedAt.getTime() ?? 0;
  return {
    ...user,
    avatarUrl: media?.avatarType ? `/u/${userId}/avatar?v=${v}` : null,
    coverUrl: media?.coverType ? `/u/${userId}/cover?v=${v}` : null,
    agentBusiness: memberships.find((m) => m.company.businessType === INDEPENDENT_AGENT) ?? null,
    companies: memberships.filter((m) => m.company.businessType !== INDEPENDENT_AGENT),
  };
}

/** The profile photo address for the frame, or null. */
export async function avatarUrlFor(userId: string): Promise<string | null> {
  const m = await prisma.userMedia.findUnique({ where: { userId }, select: { avatarType: true, updatedAt: true } });
  return m?.avatarType ? `/u/${userId}/avatar?v=${m.updatedAt.getTime()}` : null;
}

export async function saveProfileImage(userId: string, kind: ProfileImageKind, type: string, bytes: Uint8Array) {
  checkProfileImage(kind, type, bytes);
  const data = kind === "avatar" ? { avatar: Buffer.from(bytes), avatarType: type } : { cover: Buffer.from(bytes), coverType: type };
  await prisma.userMedia.upsert({ where: { userId }, create: { userId, ...data, updatedAt: new Date() }, update: { ...data, updatedAt: new Date() } });
}

export async function removeProfileImage(userId: string, kind: ProfileImageKind) {
  const data = kind === "avatar" ? { avatar: null, avatarType: null } : { cover: null, coverType: null };
  await prisma.userMedia.updateMany({ where: { userId }, data: { ...data, updatedAt: new Date() } });
}

/** For the public picture route: a profile picture is shown wherever the person appears (messages, reviews, their profile). */
export async function profileImage(userId: string, kind: ProfileImageKind) {
  const found = kind === "avatar"
    ? await prisma.userMedia.findUnique({ where: { userId }, select: { avatar: true, avatarType: true } }).then((m) => ({ bytes: m?.avatar, type: m?.avatarType }))
    : await prisma.userMedia.findUnique({ where: { userId }, select: { cover: true, coverType: true } }).then((m) => ({ bytes: m?.cover, type: m?.coverType }));
  const { bytes, type } = found;
  // A person on a break shows no pictures.
  if (!bytes || !type) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { breakStartedAt: true } });
  if (u?.breakStartedAt) return null;
  return { bytes: Buffer.from(bytes), type };
}

const aboutSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80),
  bio: z.string().trim().max(280, { error: "Keep your bio to 280 characters" }),
});
export async function updateAbout(userId: string, input: z.input<typeof aboutSchema>) {
  const d = aboutSchema.parse(input);
  await prisma.user.update({ where: { id: userId }, data: { name: d.name, bio: d.bio } });
}

/** Which workspace this session uses: null for personal, or a company the person is an active member of. */
export async function checkModeTarget(userId: string, companyId: string | null) {
  if (!companyId) return null;
  const m = await withUser(userId, (tx) => tx.membership.findFirst({ where: { userId, companyId, status: "ACTIVE", company: { suspendedAt: null } }, select: { companyId: true } }));
  if (!m) throw new Error("You are not an active member of that workspace.");
  return m.companyId;
}

const agentSchema = z.object({
  tradingName: z.string().trim().max(80).default(""),
  phone: z.string().trim().min(7, { error: "Enter a phone number clients can call" }).max(20),
});

/** A personal account starts working as an agent: its own agent business, without signing up again. */
export async function becomeAgent(userId: string, input: z.input<typeof agentSchema>) {
  const d = agentSchema.parse(input);
  const existing = await withUser(userId, (tx) => tx.membership.findFirst({ where: { userId, status: "ACTIVE", company: { businessType: INDEPENDENT_AGENT } }, select: { companyId: true } }));
  if (existing) return existing.companyId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, phone: true } });
  if (!user) throw new Error("Account not found");
  const phone = normalisePhone(d.phone);
  if (!phone) throw new Error("Enter a phone number like 0803 123 4567 or +234 803 123 4567");
  const companyId = randomUUID();
  const business = d.tradingName || user.name;
  await withTenant(companyId, userId, async (tx) => {
    await tx.company.create({ data: { id: companyId, name: business, slug: `${business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agent"}-${companyId.slice(0, 6)}`, businessType: INDEPENDENT_AGENT, contactEmail: user.email, contactPhone: phone } });
    const m = await tx.membership.create({ data: { companyId, userId, role: "COMPANY_SUPER_ADMIN" } });
    await tx.agentProfile.create({ data: { membershipId: m.id, userId, companyId, displayName: user.name, companyName: d.tradingName || "Independent agent", listed: false } });
    await logActivity(tx, { companyId, actorId: userId, entityType: "company", entityId: companyId, action: "company.created", detail: { name: business, kind: "independent agent", from: "personal account" } });
  });
  if (!user.phone) await prisma.user.update({ where: { id: userId }, data: { phone } });
  return companyId;
}

export const BREAKS = { week: 7, month: 30, quarter: 90, open: 0 } as const;
export type BreakLength = keyof typeof BREAKS;

/** Take a break: profile and pictures hidden, emails paused, signed out everywhere. Signing in again ends it. */
export async function takeBreak(userId: string, length: BreakLength) {
  if (!(length in BREAKS)) throw new Error("Choose how long the break is");
  const days = BREAKS[length];
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { breakStartedAt: now, breakUntil: days ? new Date(now.getTime() + days * 864e5) : null } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

/** Back from a break (called at sign-in). Returns true if there was one. */
export async function endBreak(userId: string): Promise<boolean> {
  const r = await prisma.user.updateMany({ where: { id: userId, breakStartedAt: { not: null } }, data: { breakStartedAt: null, breakUntil: null } });
  return r.count > 0;
}

/** Whether someone is on a break now (emails wait; their profile is hidden). */
export async function onBreak(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { breakStartedAt: true } });
  return !!u?.breakStartedAt;
}
