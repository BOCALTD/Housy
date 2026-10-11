"use server";

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth-hash";
import { createSession } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { rateLimit } from "@/lib/ratelimit";
import { createDemoData, ensureBocaProvider } from "@/lib/demo";
import { headers } from "next/headers";

function tokenMatches(given: string) {
  const expected = process.env.SETUP_TOKEN ?? "";
  if (expected.length < 16) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(12, "Use a password of at least 12 characters").max(200),
});

/** One-time creation of the first Platform Super Super Admin on a new deployment. */
export async function setupAction(form: FormData) {
  return act("/setup", async () => {
    const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!(await rateLimit(`setup:${ip}`, 5, 15 * 60 * 1000))) throw new Error("Too many attempts. Wait 15 minutes and try again.");
    if (await prisma.user.count({ where: { isPlatformAdmin: true } })) {
      throw new Error("Setup is already complete. Sign in instead.");
    }
    if (!tokenMatches(str(form, "token"))) throw new Error("That setup token is not correct.");
    const data = schema.parse({ name: str(form, "name"), email: str(form, "email"), password: str(form, "password") });
    if (await prisma.user.findUnique({ where: { email: data.email } })) throw new Error("An account with that email already exists.");

    const admin = await prisma.user.create({
      data: { email: data.email, name: data.name, passwordHash: await hashPassword(data.password), isPlatformAdmin: true },
    });
    const demo = str(form, "demo") === "on";
    await ensureBocaProvider(demo);
    if (demo) await createDemoData(admin.id);
    await createSession(admin.id, null);
    return withNotice("/admin", demo
      ? "Setup complete. Labelled demo companies and listings were added. Demo users sign in with demo-password-123."
      : "Setup complete. Add BOCA's approved profile under Verification providers to show it to buyers.");
  });
}
