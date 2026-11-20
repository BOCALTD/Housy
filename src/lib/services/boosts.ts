import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withPlatformAdmin, withPublic, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { parseNairaToKobo } from "../money";
import { randomRef } from "../billing-rules";
import { notify } from "./notifications";
import { system } from "./rewards";
import { ownerLabel } from "./billing";
import { assertCan, type Ctx } from "./context";

// Boosts. A company pays to lift one published property for a number of days: it shows in a "Boosted" row above search results
// that match it, first among results sorted by newest, and carries a "Boosted" label wherever it appears, so seekers always know.
// The price per day is set by the platform administrator (Admin → Promotions); no price means boosts are not on sale.
// Paying works like every other invoice: online (Paystack or Stripe), or by bank transfer that the administrator records.

export const BOOST_DAYS = [3, 7, 14, 30] as const;
const PRICE_KEY = "boost_price_per_day_kobo";
const DAY = 864e5;

export async function boostPricePerDay(): Promise<bigint> {
  const r = await prisma.platformSetting.findUnique({ where: { key: PRICE_KEY } });
  try { return r?.value ? BigInt(r.value) : 0n; } catch { return 0n; }
}

export async function saveBoostPrice(adminId: string, raw: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  let kobo: bigint;
  try { kobo = raw.trim() ? parseNairaToKobo(raw) : 0n; } catch { throw new Error("Enter the price per day as a naira amount, or 0 to stop selling boosts"); }
  if (kobo > 100_000_000n) throw new Error("That price per day is too high");
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.platformSetting.upsert({ where: { key: PRICE_KEY }, create: { key: PRICE_KEY, value: kobo.toString(), updatedById: adminId }, update: { value: kobo.toString(), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "boost_price", action: "settings.updated", detail: { pricePerDayKobo: kobo.toString() } });
  });
  return kobo;
}

const buySchema = z.object({
  listingId: z.string().min(1, "Choose a property"),
  days: z.coerce.number().refine((n) => (BOOST_DAYS as readonly number[]).includes(n), "Choose how many days"),
});

/**
 * Ask to boost a property: makes the boost and its invoice. Nothing is lifted until the invoice is paid. A second request for the
 * same property while one is waiting for payment replaces the first.
 */
export async function requestBoost(ctx: Ctx, raw: z.input<typeof buySchema>) {
  assertCan(ctx, "listing.manage");
  const d = buySchema.parse(raw);
  const perDay = await boostPricePerDay();
  if (perDay <= 0n) throw new Error("Boosts are not on sale at the moment");
  const boost = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: d.listingId, companyId: ctx.companyId }, select: { id: true, status: true, publicRef: true, title: true } });
    if (!listing) throw new Error("Choose one of your properties");
    if (listing.status !== "PUBLISHED") throw new Error("Only a published property can be boosted");
    return tx.listingBoost.create({ data: { ref: randomRef("BST"), companyId: ctx.companyId, listingId: listing.id, days: d.days, priceKobo: perDay * BigInt(d.days), createdById: ctx.userId } });
  });
  return system(async (tx) => {
    await lockKey(tx, `boost-listing:${boost.listingId}`);
    // One waiting boost per property: an earlier unpaid one is replaced.
    const waiting = await tx.listingBoost.findMany({ where: { listingId: boost.listingId, status: "AWAITING_PAYMENT", id: { not: boost.id } } });
    for (const w of waiting) await cancelIn(tx, w.id, "Replaced by a newer boost request");
    const listing = await tx.listing.findUniqueOrThrow({ where: { id: boost.listingId }, select: { title: true, publicRef: true } });
    const inv = await tx.invoice.create({
      data: {
        ref: randomRef("INV"), purpose: "BOOST", ownerKind: "COMPANY", ownerCompanyId: ctx.companyId, ownerName: await ownerLabel(tx, { kind: "COMPANY", companyId: ctx.companyId }),
        subjectId: boost.id, description: `Boost for ${boost.days} days: ${listing.title} (${listing.publicRef})`.slice(0, 300), amountKobo: boost.priceKobo, currency: boost.currency, dueOn: new Date(), createdById: ctx.userId,
      },
    });
    const b = await tx.listingBoost.update({ where: { id: boost.id }, data: { invoiceId: inv.id } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing_boost", entityId: b.id, action: "boost.requested", detail: { listing: listing.publicRef, days: b.days, invoice: inv.ref } });
    return { boost: b, invoice: inv };
  });
}

async function cancelIn(tx: Tx, boostId: string, reason: string) {
  const b = await tx.listingBoost.findUniqueOrThrow({ where: { id: boostId } });
  if (b.status !== "AWAITING_PAYMENT") throw new Error("Only a boost waiting for payment can be cancelled");
  if (b.invoiceId) {
    await lockKey(tx, `invoice:${b.invoiceId}`);
    const inv = await tx.invoice.findUnique({ where: { id: b.invoiceId } });
    if (inv?.status === "PAID") throw new Error("This boost has already been paid");
    if (inv?.status === "OPEN") await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason.slice(0, 300) } });
  }
  await tx.listingBoost.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelReason: reason.slice(0, 300) } });
}

export async function cancelBoost(ctx: Ctx, boostId: string) {
  assertCan(ctx, "listing.manage");
  const mine = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.listingBoost.findFirst({ where: { id: boostId, companyId: ctx.companyId } }));
  if (!mine) throw new Error("Boost not found");
  await system(async (tx) => {
    await lockKey(tx, `boost-listing:${mine.listingId}`);
    await cancelIn(tx, mine.id, "Cancelled by the company before payment");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing_boost", entityId: mine.id, action: "boost.cancelled", detail: {} });
  });
}

/** A paid boost invoice starts the boost: now, or when the property's current boost ends. Called once, from settling the payment. */
export async function applyBoostPayment(tx: Tx, inv: Prisma.InvoiceGetPayload<object>, now: Date) {
  const b = await tx.listingBoost.findUnique({ where: { id: inv.subjectId } });
  if (!b) throw new Error("The boost on this invoice no longer exists");
  await lockKey(tx, `boost-listing:${b.listingId}`);
  if (b.status !== "AWAITING_PAYMENT") return;
  const latest = await tx.listingBoost.findFirst({ where: { listingId: b.listingId, status: "ACTIVE", endsAt: { gt: now } }, orderBy: { endsAt: "desc" } });
  const startsAt = latest?.endsAt && latest.endsAt > now ? latest.endsAt : now;
  const endsAt = new Date(startsAt.getTime() + b.days * DAY);
  await tx.listingBoost.update({ where: { id: b.id }, data: { status: "ACTIVE", startsAt, endsAt } });
  await tx.invoice.update({ where: { id: inv.id }, data: { appliedAt: now, coversTo: endsAt } });
  await logActivity(tx, { companyId: b.companyId, actorId: inv.createdById, entityType: "listing_boost", entityId: b.id, action: "boost.started", detail: { invoice: inv.ref, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
  await notify(tx, b.createdById, { kind: "promo", title: "Your boost is paid", body: startsAt > now ? `It starts when the current boost ends, and runs for ${b.days} days.` : `The property is boosted for ${b.days} days.`, link: "/app/promotions", dedupeKey: `boost-on:${b.id}` });
}

/** The company's boosts, newest first, with the properties it could boost. */
export async function myBoosts(ctx: Ctx) {
  assertCan(ctx, "listing.manage");
  const perDay = await boostPricePerDay();
  const { boosts, listings } = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [boosts, listings] = await Promise.all([
      tx.listingBoost.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 100, include: { listing: { select: { id: true, title: true, publicRef: true, status: true } } } }),
      tx.listing.findMany({ where: { companyId: ctx.companyId, status: "PUBLISHED" }, select: { id: true, title: true, publicRef: true }, orderBy: { publishedAt: "desc" }, take: 300 }),
    ]);
    return { boosts, listings };
  });
  const invoices = await system((s) => s.invoice.findMany({ where: { id: { in: boosts.map((b) => b.invoiceId).filter((x): x is string => !!x) }, ownerCompanyId: ctx.companyId }, select: { id: true, ref: true, status: true } }));
  return { perDay, listings, boosts: boosts.map((b) => ({ ...b, invoice: invoices.find((i) => i.id === b.invoiceId) ?? null })) };
}

/** Of these listings, the ones boosted right now. */
export async function boostedNow(listingIds: string[], now = new Date()): Promise<Set<string>> {
  if (!listingIds.length) return new Set();
  const rows = await withPublic((tx) => tx.listingBoost.findMany({ where: { listingId: { in: listingIds }, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } }, select: { listingId: true } }));
  return new Set(rows.map((r) => r.listingId));
}

/** Boosted properties matching a search, for the "Boosted" row above the results: a few at a time, taking turns day by day. */
export async function boostedMatching(where: Prisma.ListingWhereInput, take = 3, now = new Date()) {
  return withPublic(async (tx) => {
    const ids = (await tx.listingBoost.findMany({ where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } }, select: { listingId: true }, take: 500 })).map((r) => r.listingId);
    if (!ids.length) return [];
    const rows = await tx.listing.findMany({ where: { AND: [where, { id: { in: [...new Set(ids)] } }] }, take: 100 });
    const seed = now.toISOString().slice(0, 10);
    const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
    return rows.sort((a, b) => h(`${seed}:${a.id}`) - h(`${seed}:${b.id}`)).slice(0, take);
  });
}

/** Admin: boosts for the promotions page. */
export async function adminBoosts(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.listingBoost.findMany({ where: { status: { in: ["ACTIVE", "AWAITING_PAYMENT"] } }, orderBy: { createdAt: "desc" }, take: 200, include: { listing: { select: { title: true, publicRef: true } } } });
    const companies = await tx.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, companyName: companies.find((c) => c.id === r.companyId)?.name ?? "Company" }));
  });
}
