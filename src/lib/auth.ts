import { cache } from "react";
import { adminMfaMissing } from "./readiness";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, withTenant } from "./db";
import { hashToken, newToken } from "./tokens";
import { can, type Action, type Role } from "./permissions";

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 14;

export { hashPassword, verifyPassword } from "./auth-hash";

export async function createSession(userId: string, companyId: string | null) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { userId, companyId, tokenHash: hashToken(token), expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** The raw token of the current browser session, used to keep this device signed in when the others are signed out. */
export async function currentSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function destroySession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  (await cookies()).delete(SESSION_COOKIE);
}

/** The current session and user, or null. Cached for the duration of one request. */
export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isPlatformAdmin: true, mfaEnabledAt: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
});

export async function setActiveCompany(companyId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { companyId } });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export type Member = {
  userId: string;
  userName: string;
  isPlatformAdmin: boolean;
  membershipId: string;
  companyId: string;
  companyName: string;
  role: Role;
};

/** The signed-in user's active, non-suspended membership in their selected company. Cached per request. */
export const getMember = cache(async (): Promise<Member | null> => {
  const session = await getSession();
  if (!session || !session.companyId) return null;
  const { companyId, user } = session;
  const membership = await withTenant(companyId, user.id, (tx) =>
    tx.membership.findFirst({
      where: { companyId, userId: user.id, status: "ACTIVE" },
      include: { company: { select: { name: true } } },
    }),
  );
  if (!membership) return null;
  return {
    userId: user.id,
    userName: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
    membershipId: membership.id,
    companyId,
    companyName: membership.company.name,
    role: membership.role as Role,
  };
});

/** Require a company member, optionally with a permission. Redirects or throws otherwise. */
export async function requireMember(action?: Action): Promise<Member> {
  const session = await getSession();
  if (!session) redirect("/login");
  const member = await getMember();
  if (!member) redirect("/app/switch");
  if (action && !can(member.role, action)) {
    throw new Error("You do not have permission to do that. Ask your company administrator.");
  }
  return member;
}

/** True when this deployment requires two-step sign-in for platform administrators and this one has not turned it on. */
export function adminNeedsMfa(user: { mfaEnabledAt?: Date | null }) {
  return adminMfaMissing(process.env, user);
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect("/");
  // When REQUIRE_ADMIN_MFA=true, an administrator without two-step sign-in can reach only the page that turns it on.
  if (adminNeedsMfa(user)) redirect("/me/security?error=" + encodeURIComponent("Platform administrators must turn on two-step sign-in before using the admin pages."));
  return user;
}
