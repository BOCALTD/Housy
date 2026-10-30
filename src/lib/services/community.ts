import { normalisePhone } from "../account-type-rules";
import { z } from "zod";
import { enqueueEmail } from "./notifications";
import { announceNewProfile } from "./alerts";
import type { Prisma } from "@prisma/client";
import { prisma, withPublic, withTenant, withUser } from "../db";
import { hashPassword } from "../auth-hash";
import { assertCan, type Ctx } from "./context";

const email = z.string().trim().toLowerCase().email("Enter a valid email address");

/** A seeker is a person with an account and no company. They can follow, invite an agent to collaborate and message. */
export async function registerSeeker(input: { name: string; email: string; password: string; phone?: string }) {
  const data = z.object({
    name: z.string().trim().min(2, "Enter your full name").max(120),
    email,
    password: z.string().min(10, "Use a password of at least 10 characters").max(200),
    phone: z.string().trim().max(30).default("").transform((v, ctx) => {
      if (!v) return "";
      const p = normalisePhone(v);
      if (!p) { ctx.addIssue({ code: "custom", message: "Enter a valid phone number, for example 0803 123 4567, or leave it blank" }); return z.NEVER; }
      return p;
    }),
  }).parse(input);
  if (await prisma.user.findUnique({ where: { email: data.email } })) throw new Error("An account with that email already exists. Sign in instead.");
  const user = await prisma.user.create({ data: { email: data.email, name: data.name, phone: data.phone, passwordHash: await hashPassword(data.password) } });
  await enqueueEmail(prisma, user.id, { kind: "onboarding", template: "welcome", vars: { name: user.name, kind: "seeker" }, dedupeKey: "welcome" });
  return { userId: user.id };
}

// ---------- Public profiles ----------

const agentSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the name to show").max(120),
  headline: z.string().trim().max(160).default(""),
  bio: z.string().trim().max(1500).default(""),
  listed: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
  acceptsMessages: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

/** An agent chooses what the public sees. Nothing is listed until they tick "listed". */
export async function saveAgentProfile(ctx: Ctx, raw: z.input<typeof agentSchema>) {
  assertCan(ctx, "crm.view");
  const d = agentSchema.parse(raw);
  let newlyListed = false as boolean;
  const saved = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const company = await tx.company.findFirstOrThrow({ where: { id: ctx.companyId }, select: { name: true } });
    const data = { displayName: d.displayName, companyName: company.name, headline: d.headline, bio: d.bio, listed: d.listed, acceptsMessages: d.acceptsMessages };
    const before = await tx.agentProfile.findUnique({ where: { membershipId: ctx.membershipId } });
    newlyListed = d.listed && !before?.listed;
    return tx.agentProfile.upsert({
      where: { membershipId: ctx.membershipId },
      create: { membershipId: ctx.membershipId, userId: ctx.userId, companyId: ctx.companyId, ...data },
      update: data,
    });
  });
  if (newlyListed) { try { await announceNewProfile("agent", saved.displayName, `/agents/${saved.userId}`); } catch (e) { console.error("onboarding notice failed", e); } }
  return saved;
}

const companySchema = z.object({
  kind: z.enum(["COMPANY", "DEVELOPER"]),
  displayName: z.string().trim().min(2, "Enter the name to show").max(160),
  tagline: z.string().trim().max(160).default(""),
  about: z.string().trim().max(3000).default(""),
  listed: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

export async function saveCompanyProfile(ctx: Ctx, raw: z.input<typeof companySchema>) {
  assertCan(ctx, "settings.manage");
  const d = companySchema.parse(raw);
  let newlyListed = false as boolean;
  const saved = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const existing = await tx.companyProfile.findUnique({ where: { companyId: ctx.companyId } });
    if (existing && existing.kind !== d.kind && existing.followerCount > 0) throw new Error("This profile has followers, so it cannot change between company and developer");
    newlyListed = d.listed && !existing?.listed;
    return tx.companyProfile.upsert({ where: { companyId: ctx.companyId }, create: { companyId: ctx.companyId, ...d }, update: d });
  });
  if (newlyListed) { try { await announceNewProfile("company", saved.displayName, `/companies/${saved.companyId}`); } catch (e) { console.error("onboarding notice failed", e); } }
  return saved;
}

export async function myProfiles(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => ({
    agent: await tx.agentProfile.findUnique({ where: { membershipId: ctx.membershipId } }),
    company: await tx.companyProfile.findUnique({ where: { companyId: ctx.companyId } }),
  }));
}

// ---------- Directory ----------

export type DirectoryKind = "agents" | "companies" | "developers";
export const PAGE_SIZE = 12;

export interface DirectoryRow { kind: "AGENT" | "COMPANY" | "DEVELOPER"; targetId: string; name: string; sub: string; blurb: string; followers: number; following: boolean; acceptsMessages?: boolean }

/** Listed agents, companies or developers, newest first, a page at a time. */
export async function directory(opts: { kind: DirectoryKind; q?: string; page?: number; viewerId?: string | null }) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = (opts.q ?? "").trim().slice(0, 80);
  const run = async (tx: Prisma.TransactionClient): Promise<{ rows: DirectoryRow[]; more: boolean }> => {
    const skip = (page - 1) * PAGE_SIZE;
    let rows: DirectoryRow[];
    let more: boolean;
    if (opts.kind === "agents") {
      const where: Prisma.AgentProfileWhereInput = { listed: true, ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }, { headline: { contains: q, mode: "insensitive" } }] } : {}) };
      const found = await tx.agentProfile.findMany({ where, orderBy: [{ followerCount: "desc" }, { displayName: "asc" }], skip, take: PAGE_SIZE + 1 });
      more = found.length > PAGE_SIZE;
      rows = found.slice(0, PAGE_SIZE).map((p) => ({ kind: "AGENT", targetId: p.userId, name: p.displayName, sub: p.companyName, blurb: p.headline, followers: p.followerCount, following: false, acceptsMessages: p.acceptsMessages }));
    } else {
      const kind = opts.kind === "developers" ? "DEVELOPER" : "COMPANY";
      const where: Prisma.CompanyProfileWhereInput = { listed: true, kind, ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { tagline: { contains: q, mode: "insensitive" } }] } : {}) };
      const found = await tx.companyProfile.findMany({ where, orderBy: [{ followerCount: "desc" }, { displayName: "asc" }], skip, take: PAGE_SIZE + 1 });
      more = found.length > PAGE_SIZE;
      rows = found.slice(0, PAGE_SIZE).map((p) => ({ kind, targetId: p.companyId, name: p.displayName, sub: kind === "DEVELOPER" ? "Developer" : "Company", blurb: p.tagline, followers: p.followerCount, following: false }));
    }
    if (opts.viewerId && rows.length) {
      const mine = await tx.follow.findMany({ where: { followerId: opts.viewerId, targetId: { in: rows.map((r) => r.targetId) } } });
      for (const r of rows) r.following = mine.some((f) => f.targetId === r.targetId && f.targetKind === r.kind);
    }
    return { rows, more };
  };
  return opts.viewerId ? withUser(opts.viewerId, run) : withPublic(run);
}

// ---------- Following ----------

/**
 * Follow an agent, a company or a developer. Following only chooses what updates a person sees. It gives no access to anyone's
 * records and is not collaboration, which is a separate, paid feature.
 */
export async function follow(userId: string, kind: "AGENT" | "COMPANY" | "DEVELOPER", targetId: string) {
  if (kind === "AGENT" && targetId === userId) throw new Error("You cannot follow yourself");
  return withUser(userId, async (tx) => {
    const listed = kind === "AGENT"
      ? await tx.agentProfile.findFirst({ where: { userId: targetId, listed: true } })
      : await tx.companyProfile.findFirst({ where: { companyId: targetId, kind, listed: true } });
    if (!listed) throw new Error("That profile is not available to follow");
    await tx.follow.upsert({ where: { followerId_targetKind_targetId: { followerId: userId, targetKind: kind, targetId } }, create: { followerId: userId, targetKind: kind, targetId }, update: {} });
  });
}

export async function unfollow(userId: string, kind: "AGENT" | "COMPANY" | "DEVELOPER", targetId: string) {
  await withUser(userId, (tx) => tx.follow.deleteMany({ where: { followerId: userId, targetKind: kind, targetId } }));
}

export async function myFollowing(userId: string) {
  return withUser(userId, async (tx) => {
    const follows = await tx.follow.findMany({ where: { followerId: userId }, orderBy: { createdAt: "desc" } });
    const agentIds = follows.filter((f) => f.targetKind === "AGENT").map((f) => f.targetId);
    const companyIds = follows.filter((f) => f.targetKind !== "AGENT").map((f) => f.targetId);
    const [agents, companies] = await Promise.all([
      tx.agentProfile.findMany({ where: { userId: { in: agentIds }, listed: true } }),
      tx.companyProfile.findMany({ where: { companyId: { in: companyIds }, listed: true } }),
    ]);
    return follows.map((f) => {
      const a = f.targetKind === "AGENT" ? agents.find((x) => x.userId === f.targetId) : undefined;
      const c = f.targetKind !== "AGENT" ? companies.find((x) => x.companyId === f.targetId) : undefined;
      return { id: f.id, kind: f.targetKind, targetId: f.targetId, since: f.createdAt, name: a?.displayName ?? c?.displayName ?? null, sub: a?.companyName ?? (c ? (c.kind === "DEVELOPER" ? "Developer" : "Company") : ""), blurb: a?.headline ?? c?.tagline ?? "" };
    });
  });
}
