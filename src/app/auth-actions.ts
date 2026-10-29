"use server";

import { headers } from "next/headers";
import { safeLocalPath } from "@/lib/security";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSession, setActiveCompany, verifyPassword, hashPassword } from "@/lib/auth";
import { act, str } from "@/lib/forms";
import { rateLimit } from "@/lib/ratelimit";
import { acceptInvitation, myCompanies, registerCompany } from "@/lib/services/companies";
import { registerSeeker } from "@/lib/services/community";
import { captureReferral } from "@/lib/services/referrals";
import { cookies } from "next/headers";
import { checkSecondStep } from "@/lib/services/account";
import { lockedMessage, recordFailedSignIn, recordSuccessfulSignIn, signInState } from "@/lib/services/login-guard";

/** Compared against when the email is unknown, so an unknown email takes as long to answer as a wrong password. */
let dummyHash: Promise<string> | null = null;
const noAccountHash = () => (dummyHash ??= hashPassword("no-such-account-password"));

/** The first-party cookie /r/CODE sets: "CODE.milliseconds". Read once at sign-up and then cleared. */
async function takeReferral() {
  const jar = (await cookies());
  const raw = jar.get("ref")?.value ?? "";
  const [code = "", at = ""] = raw.split(".");
  if (raw) jar.set("ref", "", { path: "/", maxAge: 0 });
  return code ? { code, at: Number(at) } : null;
}

/** Sign-up forms ask for the password twice; the browser checks as you type, and this checks again on the server. */
function confirmedPassword(form: FormData): string {
  const pw = str(form, "password");
  if (form.has("passwordConfirm") && pw !== str(form, "passwordConfirm")) throw new Error("The two passwords do not match. Type the same password in both boxes.");
  return pw;
}

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function signupAction(form: FormData) {
  return act("/signup", async () => {
    if (!(await rateLimit(`signup:${await clientIp()}`, 5, 60 * 60 * 1000))) throw new Error("Too many sign-up attempts. Try again later.");
    const { userId, companyId } = await registerCompany({
      companyName: str(form, "companyName"), name: str(form, "name"),
      email: str(form, "email"), password: confirmedPassword(form),
    });
    await captureReferral({ id: userId, name: str(form, "name"), email: str(form, "email").toLowerCase(), companyId }, "COMPANY", await takeReferral());
    await createSession(userId, companyId);
    return "/app?notice=" + encodeURIComponent("Your company workspace is ready.");
  });
}

export async function joinAction(form: FormData) {
  return act("/join", async () => {
    if (!(await rateLimit(`signup:${await clientIp()}`, 5, 60 * 60 * 1000))) throw new Error("Too many sign-up attempts. Try again later.");
    const { userId } = await registerSeeker({ name: str(form, "name"), email: str(form, "email"), password: confirmedPassword(form) });
    await captureReferral({ id: userId, name: str(form, "name"), email: str(form, "email").toLowerCase() }, "SEEKER", await takeReferral());
    await createSession(userId, null);
    const next = safeLocalPath(str(form, "next"), "");
    if (next) return next;
    return "/me?notice=" + encodeURIComponent("Your account is ready.");
  });
}

export async function loginAction(form: FormData) {
  return act("/login", async () => {
    const email = str(form, "email").toLowerCase();
    if (!(await rateLimit(`login:${await clientIp()}:${email}`, 8, 15 * 60 * 1000))) {
      throw new Error("Too many sign-in attempts. Wait 15 minutes and try again.");
    }
    // A locked or closed sign-in is refused before the password is even checked, so attempts during a lock never count.
    const locked = lockedMessage(await signInState(email));
    if (locked) throw new Error(locked);
    const user = await prisma.user.findUnique({ where: { email } });
    // Same message and same work whether the email or the password is wrong, so accounts cannot be enumerated by message or by timing.
    // Locks are kept per email address, for unknown addresses too, for the same reason.
    const passwordOk = await verifyPassword(str(form, "password"), user?.passwordHash ?? (await noAccountHash()));
    if (!user || !passwordOk) {
      const r = await recordFailedSignIn(email, user?.id ?? null);
      if (r.event === "locked" || r.event === "banned" || r.event === "refused") throw new Error(lockedMessage(await signInState(email)) ?? "Too many wrong passwords.");
      throw new Error(`That email and password do not match an account. ${r.triesLeft} ${r.triesLeft === 1 ? "try" : "tries"} left before sign-in is locked.`);
    }
    if (user.mfaEnabledAt) {
      const code = str(form, "code");
      if (!code) throw new Error("Enter the code from your authenticator app, or a recovery code.");
      if (!(await rateLimit(`mfa:${user.id}`, 8, 15 * 60 * 1000)) || !(await checkSecondStep(user.id, code))) throw new Error("That code is not right or has already been used.");
    }
    await recordSuccessfulSignIn(email);
    const companies = await myCompanies(user.id);
    await createSession(user.id, companies[0]?.companyId ?? null);
    const next = safeLocalPath(str(form, "next"), "");
    if (next) return next;
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
      existingUserId: session?.user.id, name: str(form, "name"), password: session ? str(form, "password") : confirmedPassword(form),
    });
    if (session && session.user.id === userId) await setActiveCompany(companyId);
    else await createSession(userId, companyId);
    return "/app?notice=" + encodeURIComponent("You have joined the company.");
  });
}
