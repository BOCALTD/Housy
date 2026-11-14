/**
 * A company's or agent's own decision about its workspace, made by its top administrator (Settings → Pause or close):
 *  - Pause: the listings, agent profiles and company profile leave public view, the team cannot work in it, API keys and portals
 *    stop, and the plan is not renewed. Nothing is deleted. The top administrator resumes it whenever they like, and exactly what
 *    the pause hid comes back (nothing hidden by Housy for other reasons).
 *  - Close: the same, for good. Payment links still waiting are cancelled and the plan is cancelled. Records are kept as the law
 *    requires. Only Housy support can reopen it.
 * Both use the platform's workspace closure (suspendedAt), so every place that respects a suspension respects these too; the kind
 * tells them apart from a suspension by Housy, which only Housy can lift.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { verifyPassword } from "../auth-hash";
import { notify } from "./notifications";
import { system } from "./rewards";
import type { Ctx } from "./context";

export type ClosureKind = "" | "PLATFORM" | "PAUSED" | "CLOSED";

function assertOwner(ctx: Ctx) {
  if (ctx.role !== "COMPANY_SUPER_ADMIN") throw new Error("Only the workspace's top administrator can pause or close it.");
}

async function teamOf(companyId: string, except: string) {
  return withTenant(companyId, "system", async (tx) => (await tx.membership.findMany({ where: { companyId, status: "ACTIVE", NOT: { userId: except } }, select: { userId: true } })).map((m) => m.userId));
}

/** Hide what is public now, and say which rows were hidden. */
async function hidePublic(tx: Tx, companyId: string) {
  const [listings, agents, profiles] = await Promise.all([
    tx.listing.findMany({ where: { companyId, platformHidden: false }, select: { id: true } }),
    tx.agentProfile.findMany({ where: { companyId, platformHidden: false }, select: { id: true } }),
    tx.companyProfile.findMany({ where: { companyId, platformHidden: false }, select: { id: true } }),
  ]);
  const ids = { listings: listings.map((r) => r.id), agents: agents.map((r) => r.id), profiles: profiles.map((r) => r.id) };
  await tx.listing.updateMany({ where: { id: { in: ids.listings } }, data: { platformHidden: true } });
  await tx.agentProfile.updateMany({ where: { id: { in: ids.agents } }, data: { platformHidden: true } });
  await tx.companyProfile.updateMany({ where: { id: { in: ids.profiles } }, data: { platformHidden: true } });
  return ids;
}

/** Where the workspace stands, for the page shown while it is closed. */
export async function workspaceClosure(companyId: string) {
  const c = await withTenant(companyId, "system", (tx) => tx.company.findFirst({ where: { id: companyId }, select: { name: true, suspendedAt: true, suspendedReason: true, suspendedKind: true } }));
  if (!c?.suspendedAt) return null;
  return { name: c.name, at: c.suspendedAt, reason: c.suspendedReason, kind: (c.suspendedKind || "PLATFORM") as Exclude<ClosureKind, "">, };
}

const noteSchema = z.string().trim().max(500).default("");

export async function pauseWorkspace(ctx: Ctx, noteInput = "") {
  assertOwner(ctx);
  const note = noteSchema.parse(noteInput);
  await system(async (tx) => {
    const c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { suspendedAt: true } });
    if (c.suspendedAt) throw new Error("This workspace is already closed.");
    const hidden = await hidePublic(tx, ctx.companyId);
    await tx.company.update({ where: { id: ctx.companyId }, data: { suspendedAt: new Date(), suspendedKind: "PAUSED", suspendedReason: note || "Paused by the company", suspendedById: ctx.userId, pauseHidden: hidden } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.paused", detail: { note, listings: hidden.listings.length } });
  });
  const team = await teamOf(ctx.companyId, ctx.userId);
  await system(async (tx) => { for (const u of team) await notify(tx, u, { kind: "security.company_paused", title: "Your company's workspace is paused", body: note || "The top administrator paused it. It opens again when they resume it.", link: "/suspended" }); });
}

export async function resumeWorkspace(ctx: Ctx) {
  assertOwner(ctx);
  await system(async (tx) => {
    const c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { suspendedAt: true, suspendedKind: true, pauseHidden: true } });
    if (!c.suspendedAt || c.suspendedKind !== "PAUSED") throw new Error(c.suspendedKind === "CLOSED" ? "This workspace is closed. Contact support to reopen it." : c.suspendedAt ? "Housy suspended this workspace. Only Housy can restore it." : "This workspace is not paused.");
    const h = (c.pauseHidden ?? {}) as { listings?: string[]; agents?: string[]; profiles?: string[] };
    await tx.listing.updateMany({ where: { companyId: ctx.companyId, id: { in: h.listings ?? [] } }, data: { platformHidden: false } });
    await tx.agentProfile.updateMany({ where: { companyId: ctx.companyId, id: { in: h.agents ?? [] } }, data: { platformHidden: false } });
    await tx.companyProfile.updateMany({ where: { companyId: ctx.companyId, id: { in: h.profiles ?? [] } }, data: { platformHidden: false } });
    await tx.company.update({ where: { id: ctx.companyId }, data: { suspendedAt: null, suspendedKind: "", suspendedReason: "", suspendedById: null, pauseHidden: Prisma.DbNull } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.resumed", detail: {} });
  });
  const team = await teamOf(ctx.companyId, ctx.userId);
  await system(async (tx) => { for (const u of team) await notify(tx, u, { kind: "security.company_resumed", title: "Your company's workspace is open again", body: "The top administrator resumed it.", link: "/app" }); });
}

const closeSchema = z.object({
  reason: z.string().trim().min(3, "Say briefly why you are closing it").max(500),
  confirm: z.string(),
  password: z.string().min(1, "Enter your password"),
});

/** Close the workspace for good. Needs the reason, the word CLOSE and the top administrator's password. */
export async function closeWorkspace(ctx: Ctx, raw: z.input<typeof closeSchema>) {
  assertOwner(ctx);
  const d = closeSchema.parse(raw);
  if (d.confirm.trim().toUpperCase() !== "CLOSE") throw new Error("Type CLOSE to confirm.");
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(d.password, user.passwordHash))) throw new Error("That password is not right.");
  await system(async (tx) => {
    const c = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { suspendedAt: true, suspendedKind: true } });
    if (c.suspendedAt && c.suspendedKind !== "PAUSED") throw new Error(c.suspendedKind === "CLOSED" ? "This workspace is already closed." : "Housy suspended this workspace. Contact support.");
    await hidePublic(tx, ctx.companyId);
    await tx.company.update({ where: { id: ctx.companyId }, data: { suspendedAt: new Date(), suspendedKind: "CLOSED", suspendedReason: d.reason, suspendedById: ctx.userId, pauseHidden: Prisma.DbNull } });
    // Nothing more is asked of anyone: waiting payment links close; the plan stops; renewal invoices not yet paid are withdrawn.
    await tx.clientPayment.updateMany({ where: { companyId: ctx.companyId, status: "PENDING" }, data: { status: "CANCELLED", cancelReason: "The company closed its workspace", tokenHash: null } });
    const sub = await tx.subscription.findFirst({ where: { ownerCompanyId: ctx.companyId, status: { not: "CANCELLED" } } });
    if (sub) {
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, kind: "CANCELLED", fromPlanId: sub.planId, toPlanId: sub.planId, periodEnd: sub.periodEnd, note: "The workspace was closed", actorId: ctx.userId } });
    }
    await tx.invoice.updateMany({ where: { ownerCompanyId: ctx.companyId, purpose: "SUBSCRIPTION", status: "OPEN" }, data: { status: "VOID", voidedAt: new Date(), voidReason: "The workspace was closed" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.closed", detail: { reason: d.reason } });
  });
  const team = await teamOf(ctx.companyId, ctx.userId);
  await system(async (tx) => { for (const u of [...team, ctx.userId]) await notify(tx, u, { kind: "security.company_closed", title: "The company's workspace has been closed", body: `Reason: ${d.reason}. Records are kept as the law requires. To reopen it, contact support.`, link: "/suspended", email: true }); });
}
