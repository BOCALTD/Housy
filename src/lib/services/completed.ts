import { z } from "zod";
import { prisma, withPublic, withTenant } from "../db";
import { logActivity } from "../audit";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";
import { readAwardConfig } from "./awards";
import { system } from "./rewards";

// Recently Sold, Rented and Leased. A company asks to show a completed deal, says that the people involved agreed, and the platform
// checks it. Only general facts are ever shown: the kind of property, its area and the month it completed. Never a price, a name,
// an address or a document. Entries age off the public page, and drop off at once if the deal stops being a completed one.

export const COMPLETED_PAGE = 12;
export const KIND_LABEL = { SOLD: "Recently sold", RENTED: "Recently rented", LEASED: "Recently leased" } as const;
export const KIND_STATUS = { SOLD: "Sold", RENTED: "Rented", LEASED: "Leased" } as const;
export type Kind = keyof typeof KIND_LABEL;
const KIND_OF_DEAL = { SALE: "SOLD", RENT: "RENTED", LEASE: "LEASED" } as const;
/** The purpose to pre-select when someone asks for similar properties that are still available. */
export const SIMILAR_PURPOSE = { SOLD: "SALE", RENTED: "RENT", LEASED: "LEASE" } as const;

const manager = (ctx: Ctx) => ctx.role === "COMPANY_SUPER_ADMIN" || ctx.role === "MANAGER";
const authSchema = z.object({
  statement: z.string().trim().min(10, "Say who agreed and how (at least 10 characters), for example: Owner and buyer agreed by email on 3 October").max(300),
  confirmed: z.boolean().refine((v) => v, "Tick the box to confirm the people involved agreed"),
});

export async function requestDisplay(ctx: Ctx, dealId: string, o: { statement: string; confirmed: boolean }) {
  assertCan(ctx, "crm.manage");
  if (!manager(ctx)) throw new Error("A manager must authorise showing a completed deal");
  const a = authSchema.parse(o);
  const snap = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await tx.deal.findFirst({ where: { id: dealId, companyId: ctx.companyId } });
    if (!deal) throw new Error("Deal not found");
    if (deal.status !== "COMPLETED" || !deal.completedAt) throw new Error("Only a completed deal can be shown");
    const asset = await tx.asset.findFirstOrThrow({ where: { id: deal.assetId, companyId: ctx.companyId }, include: { listing: true } });
    const listing = deal.listingId ? await tx.listing.findUnique({ where: { id: deal.listingId } }) : asset.listing;
    return {
      companyId: ctx.companyId, listingId: listing?.id ?? null, kind: KIND_OF_DEAL[deal.type], category: asset.category || "Property", bedrooms: listing?.bedrooms ?? null,
      city: (listing?.city || asset.city || "").trim(), state: (listing?.state || asset.state || "").trim(), completedAt: deal.completedAt,
    };
  });
  if (!snap.city) throw new Error("Add a city to the property or its listing first, so the area can be shown");
  await system(async (tx) => {
    const data = { ...snap, status: "REQUESTED" as const, authorisedById: ctx.userId, authorisation: a.statement, reviewNote: "", reviewedById: null, reviewedAt: null };
    const old = await tx.completedDisplay.findUnique({ where: { dealId } });
    if (old && (old.status === "REQUESTED" || old.status === "APPROVED")) throw new Error("This deal has already been put forward");
    if (old) await tx.completedDisplay.update({ where: { id: old.id }, data });
    else await tx.completedDisplay.create({ data: { dealId, ...data } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "completed.display_requested", detail: { kind: snap.kind } });
  });
}

export async function withdrawDisplay(ctx: Ctx, dealId: string) {
  assertCan(ctx, "crm.manage");
  if (!manager(ctx)) throw new Error("A manager must withdraw a completed deal from display");
  await system(async (tx) => {
    const d = await tx.completedDisplay.findFirst({ where: { dealId, companyId: ctx.companyId } });
    if (!d) throw new Error("Not found");
    if (d.status !== "REQUESTED" && d.status !== "APPROVED") throw new Error("Nothing to withdraw");
    await tx.completedDisplay.update({ where: { id: d.id }, data: { status: "WITHDRAWN" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "completed.display_withdrawn", detail: {} });
  });
}

export async function companyDesk(ctx: Ctx) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deals = await tx.deal.findMany({ where: { companyId: ctx.companyId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 100, select: { id: true, ref: true, title: true, type: true, completedAt: true } });
    const shown = await tx.completedDisplay.findMany({ where: { dealId: { in: deals.map((d) => d.id) } } });
    return deals.map((d) => ({ ...d, display: shown.find((s) => s.dealId === d.id) ?? null }));
  });
}

// ---------- Platform check ----------

export async function displayQueue(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return system(async (tx) => {
    const rows = await tx.completedDisplay.findMany({ where: { status: "REQUESTED" }, orderBy: { createdAt: "asc" }, take: 100 });
    const deals: { id: string; ref: string; status: string; completedAt: Date | null }[] = [];
    for (const cid of [...new Set(rows.map((r) => r.companyId))]) deals.push(...(await withTenant(cid, "system", (c) => c.deal.findMany({ where: { companyId: cid, id: { in: rows.filter((r) => r.companyId === cid).map((r) => r.dealId) } }, select: { id: true, ref: true, status: true, completedAt: true } }))));
    const companies = await tx.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, deal: deals.find((d) => d.id === r.dealId) ?? null, companyName: companies.find((c) => c.id === r.companyId)?.name ?? "Company" }));
  });
}
export async function reviewDisplay(adminId: string, id: string, decision: "approve" | "reject", note: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const why = note.trim();
  if (decision === "reject" && why.length < 3) throw new Error("Say why you are turning this down");
  await system(async (tx) => {
    const r = await tx.completedDisplay.findUnique({ where: { id } });
    if (!r) throw new Error("Not found");
    if (r.status !== "REQUESTED") throw new Error("This has already been decided");
    if (decision === "approve") {
      const deal = await withTenant(r.companyId, "system", (c) => c.deal.findFirst({ where: { id: r.dealId, companyId: r.companyId } }));
      if (!deal || deal.status !== "COMPLETED" || !deal.completedAt) throw new Error("The deal is no longer a completed one, so it cannot be shown");
    }
    await tx.completedDisplay.update({ where: { id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", reviewNote: why, reviewedById: adminId, reviewedAt: new Date() } });
    await notify(tx, r.authorisedById, { kind: "completed", title: decision === "approve" ? "Your completed deal will be shown" : "Your completed deal was not approved for display", body: why, link: "/app/completed" });
    await logActivity(tx, { companyId: r.companyId, actorId: adminId, entityType: "deal", entityId: r.dealId, action: `completed.display_${decision}d`, detail: { note: why } });
  });
}

// ---------- Public ----------

export async function recentlyCompleted(o: { kind?: string; city?: string; page?: number; limit?: number; now?: Date } = {}) {
  const cfg = await readAwardConfig();
  const now = o.now ?? new Date();
  const since = new Date(now.getTime() - cfg.completedDays * 864e5);
  const kind = o.kind && o.kind in KIND_LABEL ? (o.kind as Kind) : undefined;
  const limit = o.limit ?? COMPLETED_PAGE;
  const where = { status: "APPROVED" as const, completedAt: { gte: since, lte: now }, ...(kind ? { kind } : {}), ...(o.city ? { city: { contains: o.city, mode: "insensitive" as const } } : {}) };
  const rows = await withPublic((tx) => tx.completedDisplay.findMany({ where, orderBy: { completedAt: "desc" }, take: 500 }));
  // The deal must still be a completed one: a sale that was later disputed or reopened comes off at once.
  const alive: { id: string }[] = [];
  for (const cid of [...new Set(rows.map((r) => r.companyId))]) alive.push(...(await withTenant(cid, "system", (c) => c.deal.findMany({ where: { companyId: cid, id: { in: rows.filter((r) => r.companyId === cid).map((r) => r.dealId) }, status: "COMPLETED" }, select: { id: true } }))));
  const ok = rows.filter((r) => alive.some((a) => a.id === r.dealId));
  const page = Math.max(0, o.page ?? 0);
  return { total: ok.length, page, pages: Math.max(1, Math.ceil(ok.length / limit)), rows: ok.slice(page * limit, page * limit + limit).map(toCard) };
}
export type Card = ReturnType<typeof toCard>;
function toCard(r: { id: string; kind: string; category: string; bedrooms: number | null; city: string; state: string; completedAt: Date }) {
  return { id: r.id, kind: r.kind as Kind, status: KIND_STATUS[r.kind as Kind], category: r.category, bedrooms: r.bedrooms, area: [r.city, r.state].filter(Boolean).join(", "), city: r.city, completedAt: r.completedAt };
}
/** The three landing-page sections, each with a handful of cards. */
export async function homeSections(now = new Date()) {
  const out = {} as Record<Kind, Card[]>;
  for (const k of Object.keys(KIND_LABEL) as Kind[]) out[k] = (await recentlyCompleted({ kind: k, limit: 4, now })).rows;
  return out;
}
