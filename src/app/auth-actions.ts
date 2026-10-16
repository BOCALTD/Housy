"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSession, setActiveCompany, verifyPassword } from "@/lib/auth";
import { act, str } from "@/lib/forms";
import { rateLimit } from "@/lib/ratelimit";
import { acceptInvitation, myCompanies, registerCompany } from "@/lib/services/companies";
import { registerSeeker } from "@/lib/services/community";
import { captureReferral } from "@/lib/services/referrals";
import { cookies } from "next/headers";

/** The first-party cookie /r/CODE sets: "CODE.milliseconds". Read once at sign-up and then cleared. */
async function takeReferral() {
  const jar = cookies();
  const raw = jar.get("ref")?.value ?? "";
  const [code = "", at = ""] = raw.split(".");
  if (raw) jar.set("ref", "", { path: "/", maxAge: 0 });
  return code ? { code, at: Number(at) } : null;
}

function clientIp() {
  return headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function signupAction(form: FormData) {
  return act("/signup", async () => {
    if (!(await rateLimit(`signup:${clientIp()}`, 5, 60 * 60 * 1000))) throw new Error("Too many sign-up attempts. Try again later.");
    const { userId, companyId } = await registerCompany({
      companyName: str(form, "companyName"), name: str(form, "name"),
      email: str(form, "email"), password: str(form, "password"),
    });
    await captureReferral({ id: userId, name: str(form, "name"), email: str(form, "email").toLowerCase(), companyId }, "COMPANY", await takeReferral());
    await createSession(userId, companyId);
    return "/app?notice=" + encodeURIComponent("Your company workspace is ready.");
  });
}

export async function joinAction(form: FormData) {
  return act("/join", async () => {
    if (!(await rateLimit(`signup:${clientIp()}`, 5, 60 * 60 * 1000))) throw new Error("Too many sign-up attempts. Try again later.");
    const { userId } = await registerSeeker({ name: str(form, "name"), email: str(form, "email"), password: str(form, "password") });
    await captureReferral({ id: userId, name: str(form, "name"), email: str(form, "email").toLowerCase() }, "SEEKER", await takeReferral());
    await createSession(userId, null);
    return "/me?notice=" + encodeURIComponent("Your account is ready.");
  });
}

export async function loginAction(form: FormData) {
  return act("/login", async () => {
    const email = str(form, "email").toLowerCase();
    if (!(await rateLimit(`login:${clientIp()}:${email}`, 8, 15 * 60 * 1000))) {
      throw new Error("Too many sign-in attempts. Wait 15 minutes and try again.");
    }
    const user = await prisma.user.findUnique({ where: { email } });
    // Same message whether the email or the password is wrong, so accounts cannot be enumerated.
    if (!user || !(await verifyPassword(str(form, "password"), user.passwordHash))) {
      throw new Error("That email and password do not match an account.");
    }
    const companies = await myCompanies(user.id);
    await createSession(user.id, companies[0]?.companyId ?? null);
    const next = str(form, "next");
    if (next.startsWith("/") && !next.startsWith("//")) return next;
    if (companies.length === 0) return user.isPlatformAdmin ? "/admin" : "/me";
    return "/app";
  });
}

export async function logoutAction() {
  return act("/", async () => {
    await destroySession();
    return "/";
  });
}

export async function switchCompanyAction(form: FormData) {
  return act("/app/switch", async () => {
    const session = await getSession();
    if (!session) return "/login";
    const companyId = str(form, "companyId");
    const companies = await myCompanies(session.user.id);
    if (!companies.some((c) => c.companyId === companyId)) throw new Error("You are not a member of that company.");
    await setActiveCompany(companyId);
    return "/app";
  });
}

export async function acceptInviteAction(form: FormData) {
  const token = str(form, "token");
  return act(`/invite/${encodeURIComponent(token)}`, async () => {
    const session = await getSession();
    const { userId, companyId } = await acceptInvitation(token, {
      existingUserId: session?.user.id, name: str(form, "name"), password: str(form, "password"),
    });
    if (session && session.user.id === userId) await setActiveCompany(companyId);
    else await createSession(userId, companyId);
    return "/app?notice=" + encodeURIComponent("You have joined the company.");
  });
}
