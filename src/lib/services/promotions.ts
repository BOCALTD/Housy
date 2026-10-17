import { coverPhotoIds } from "./listing-photos";
import { z } from "zod";
import { prisma, withPlatformAdmin, withPublic, withTenant } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { randomRef } from "../tokens";
import { discountPct, promoFee, promoLive, promoPriceProblem, rankListings, tierPerks, type TierName } from "../tier-rules";
import { notify } from "./notifications";
import { assertCan, type Ctx } from "./context";
import { tierOf, tiersFor } from "./tiers";
import { searchListings, type SearchFilters } from "./listings";

// Promotions. The platform runs campaigns; companies choose which of their published properties join; the platform approves each one.
// Basic companies pay a fee per property (recorded by hand once received). Silver and Gold companies join free. The public only ever
// sees an approved entry whose campaign is running and whose property is still published at the price it was approved against.

export const THEMES = ["RED", "GOLD", "GREEN", "PURPLE", "BLUE"] as const;
export const PROMO_PAGE = 8;
const PAY_KEY = "promo_payment_instructions";

const day = (label: string) => z.string().min(1, `Enter the ${label}`).transform((v, ctx) => {
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: "custom", message: `Enter a valid ${label}` }); return z.NEVER; }
  return d;
});
const campaignSchema = z.object({
  name: z.string().trim().min(3, "Name the campaign").max(80),
  tagline: z.string().trim().max(120).default(""),
  theme: z.enum(THEMES).default("RED"),
  startsOn: day("start date"),
  endsOn: day("end date"),
  fee: z.string().trim().default("0").transform((v, ctx) => {
    try { return v ? parseNairaToKobo(v) : 0n; } catch { ctx.addIssue({ code: "custom", message: "Enter the fee as a naira amount" }); return z.NEVER; }
  }),
  maxDiscountPct: z.preprocess((v) => (v === "" || v == null ? 60 : Number(v)), z.number().int("Whole number").min(1, "At least 1%").max(90, "At most 90%")),
}).refine((d) => d.endsOn >= d.startsOn, { message: "The campaign cannot end before it starts", path: ["endsOn"] });

async function assertAdmin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Admin: campaigns ----------

export async function saveCampaign(adminId: string, id: string | null, raw: z.input<typeof campaignSchema>) {
  await assertAdmin(adminId);
  const d = campaignSchema.parse(raw);
  return withPlatformAdmin(adminId, async (tx) => {
    const data = { name: d.name, tagline: d.tagline, theme: d.theme, startsOn: d.startsOn, endsOn: d.endsOn, feeKobo: d.fee, maxDiscountPct: d.maxDiscountPct };
    const c = id ? await tx.promoCampaign.update({ where: { id }, data }) : await tx.promoCampaign.create({ data: { ...data, createdById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_campaign", entityId: c.id, action: id ? "promo.campaign_updated" : "promo.campaign_created", detail: { name: d.name } });
    return c;
  });
}
export async function setCampaignActive(adminId: string, id: string, active: boolean) {
  await assertAdmin(adminId);
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.promoCampaign.update({ where: { id }, data: { active } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_campaign", entityId: id, action: active ? "promo.campaign_resumed" : "promo.campaign_ended", detail: {} });
  });
}
export async function listCampaigns() {
  return withPublic((tx) => tx.promoCampaign.findMany({ orderBy: { startsOn: "desc" }, take: 100 }));
}
/** Campaigns a company can still join: switched on and not yet finished. */
export async function openCampaigns() {
  const today = new Date(Date.now() - 864e5);
  return withPublic((tx) => tx.promoCampaign.findMany({ where: { active: true, endsOn: { gte: today } }, orderBy: { startsOn: "asc" }, take: 50 }));
}

export async function readPaymentInstructions(): Promise<string> {
  const r = await prisma.platformSetting.findUnique({ where: { key: PAY_KEY } });
  return r?.value ?? "";
}
export async function savePaymentInstructions(adminId: string, text: string) {
  await assertAdmin(adminId);
  const value = z.string().trim().max(600, "Keep the payment instructions under 600 characters").parse(text);
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.platformSetting.upsert({ where: { key: PAY_KEY }, create: { key: PAY_KEY, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "promo_payment", action: "settings.updated", detail: {} });
  });
}

// ---------- Company: requesting ----------

/** Published properties of the company that can still be put in a campaign. */
export async function eligibleListings(ctx: Ctx, campaignId: string) {
  assertCan(ctx, "listing.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const taken = await tx.promoEntry.findMany({ where: { campaignId, companyId: ctx.companyId, status: { in: ["REQUESTED", "APPROVED"] } }, select: { listingId: true } });
    return tx.listing.findMany({
      where: { companyId: ctx.companyId, status: "PUBLISHED", id: { notIn: taken.map((t) => t.listingId) } },
      orderBy: { title: "asc" }, select: { id: true, publicRef: true, title: true, priceKobo: true, city: true }, take: 200,
    });
  });
}

export async function requestPromo(ctx: Ctx, campaignId: string, listingId: string, promoPrice: string) {
  assertCan(ctx, "listing.manage");
  let promo: bigint;
  try { promo = parseNairaToKobo(promoPrice); } catch { throw new Error("Enter the promotional price as a naira amount"); }
  const tier = await tierOf(ctx.companyId);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const campaign = await tx.promoCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign || !campaign.active || campaign.endsOn.getTime() + 864e5 <= Date.now()) throw new Error("That campaign is not open");
    const listing = await tx.listing.findFirst({ where: { id: listingId, companyId: ctx.companyId } });
    if (!listing) throw new Error("Choose one of your properties");
    if (listing.status !== "PUBLISHED") throw new Error("Only published properties can join a promotion");
    const problem = promoPriceProblem(listing.priceKobo, promo, campaign.maxDiscountPct);
    if (problem) throw new Error(problem);
    // Two staff members asking at the same moment for the same property must not both succeed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`promo:${campaignId}:${listingId}`}))`;
    const dup = await tx.promoEntry.findFirst({ where: { campaignId, listingId, status: { in: ["REQUESTED", "APPROVED"] } } });
    if (dup) throw new Error("That property is already in this campaign");
    const entry = await tx.promoEntry.create({
      data: { ref: randomRef("PRM", 7), campaignId, companyId: ctx.companyId, listingId, originalPriceKobo: listing.priceKobo, promoPriceKobo: promo, requestedById: ctx.userId },
    });
    const fee = promoFee(tier, campaign.feeKobo, 1);
    await tx.promoPayment.create({ data: { entryId: entry.id, companyId: ctx.companyId, tierAtRequest: tier, feeKobo: fee, status: fee === 0n ? "NOT_REQUIRED" : "PENDING" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "promo_entry", entityId: entry.id, action: "promo.requested", detail: { campaign: campaign.name, listing: listing.publicRef, tier } });
    return entry;
  });
}

export async function withdrawPromo(ctx: Ctx, entryId: string) {
  assertCan(ctx, "listing.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const e = await tx.promoEntry.findFirst({ where: { id: entryId, companyId: ctx.companyId } });
    if (!e) throw new Error("Request not found");
    if (e.status !== "REQUESTED") throw new Error("Only a request still waiting for review can be withdrawn");
    await tx.promoEntry.update({ where: { id: e.id }, data: { status: "WITHDRAWN" } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "promo_entry", entityId: e.id, action: "promo.withdrawn", detail: {} });
  });
}

export async function myPromoEntries(ctx: Ctx) {
  assertCan(ctx, "listing.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.promoEntry.findMany({ where: { companyId: ctx.companyId }, include: { campaign: true, payment: true }, orderBy: { createdAt: "desc" }, take: 200 });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, publicRef: true, priceKobo: true, status: true } });
    return rows.map((r) => ({ ...r, listing: listings.find((l) => l.id === r.listingId) ?? null }));
  });
}

// ---------- Admin: review ----------

export async function promoQueue(adminId: string, state: "REQUESTED" | "APPROVED" | "REJECTED" | "ALL" = "REQUESTED") {
  await assertAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.promoEntry.findMany({ where: state === "ALL" ? {} : { status: state }, include: { campaign: true, payment: true }, orderBy: { createdAt: "asc" }, take: 300 });
    const listings = await tx.listing.findMany({ where: { id: { in: rows.map((r) => r.listingId) } }, select: { id: true, title: true, publicRef: true, priceKobo: true, status: true } });
    const companies = await tx.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, listing: listings.find((l) => l.id === r.listingId) ?? null, companyName: companies.find((c) => c.id === r.companyId)?.name ?? "Company" }));
  });
}

const refSchema = z.string().trim().min(4, "Enter the payment reference (at least 4 characters)").max(120);
export async function markPaymentReceived(adminId: string, entryId: string, reference: string, note = "") {
  await assertAdmin(adminId);
  const ref = refSchema.parse(reference);
  await withPlatformAdmin(adminId, async (tx) => {
    const p = await tx.promoPayment.findUnique({ where: { entryId } });
    if (!p) throw new Error("Payment not found");
    if (p.status !== "PENDING") throw new Error("This payment does not need confirming");
    await tx.promoPayment.update({ where: { id: p.id }, data: { status: "VERIFIED", reference: ref, note: note.slice(0, 300), verifiedById: adminId, verifiedAt: new Date() } });
    await logActivity(tx, { companyId: p.companyId, actorId: adminId, entityType: "promo_entry", entityId: entryId, action: "promo.payment_verified", detail: { reference: ref } });
  });
}

export async function reviewPromo(adminId: string, entryId: string, decision: "approve" | "reject", note: string) {
  await assertAdmin(adminId);
  const reason = note.trim();
  let notice = null as { companyId: string; title: string; body: string } | null;
  if (decision === "reject" && reason.length < 3) throw new Error("Say why you are turning this down");
  await withPlatformAdmin(adminId, async (tx) => {
    const e = await tx.promoEntry.findUnique({ where: { id: entryId }, include: { campaign: true, payment: true } });
    if (!e) throw new Error("Request not found");
    if (e.status !== "REQUESTED") throw new Error("This request has already been decided");
    if (decision === "approve") {
      const listing = await tx.listing.findUnique({ where: { id: e.listingId } });
      if (!listing || listing.status !== "PUBLISHED") throw new Error("The property is no longer published");
      if (listing.priceKobo !== e.originalPriceKobo) throw new Error("The listed price changed since the request. Ask the company to request again at the new price.");
      if (e.payment && e.payment.status === "PENDING") {
        // A company that upgraded after asking no longer owes the fee.
        const tier = (await tx.companyTier.findUnique({ where: { companyId: e.companyId } }));
        const now = tier && tier.validUntil.getTime() > Date.now() ? tier.tier : "BASIC";
        if (tierPerks(now as TierName).freePromos) await tx.promoPayment.update({ where: { id: e.payment.id }, data: { status: "NOT_REQUIRED", feeKobo: 0n, note: `Waived: the company is now on a plan with free promotions (fee was ${e.payment.feeKobo} kobo)` } });
        else throw new Error("Payment has not been confirmed yet");
      }
    }
    await tx.promoEntry.update({ where: { id: e.id }, data: { status: decision === "approve" ? "APPROVED" : "REJECTED", reviewNote: reason, reviewedById: adminId, reviewedAt: new Date() } });
    notice = { companyId: e.companyId, title: decision === "approve" ? "Your promotion was approved" : "Your promotion was not approved", body: `${e.campaign.name}${reason ? `: ${reason}` : ""}` };
    await logActivity(tx, { companyId: e.companyId, actorId: adminId, entityType: "promo_entry", entityId: e.id, action: decision === "approve" ? "promo.approved" : "promo.rejected", detail: { reason } });
  });
  if (notice) {
    const n = notice;
    const members = await withTenant(n.companyId, "system", (tx) => tx.membership.findMany({ where: { companyId: n.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] } }, select: { userId: true } }));
    await withPlatformAdmin(adminId, async (tx) => { for (const m of members) await notify(tx, m.userId, { kind: "promo", title: n.title, body: n.body, link: "/app/promotions" }); });
  }
}

// ---------- Public ----------

export interface LivePromo { entryId: string; campaignName: string; tagline: string; theme: string; originalKobo: bigint; promoKobo: bigint; pct: number; endsOn: Date }

/** Promotions that may be shown right now, by listing id. */
export async function livePromos(listings: { id: string; status: string; priceKobo: bigint }[]): Promise<Map<string, LivePromo>> {
  const out = new Map<string, LivePromo>();
  if (!listings.length) return out;
  const now = new Date();
  const rows = await withPublic((tx) => tx.promoEntry.findMany({ where: { listingId: { in: listings.map((l) => l.id) }, status: "APPROVED" }, include: { campaign: true } }));
  for (const r of rows) {
    const l = listings.find((x) => x.id === r.listingId);
    if (!l) continue;
    if (!promoLive({ entryStatus: r.status, campaign: r.campaign, listingStatus: l.status, listingPriceKobo: l.priceKobo, originalPriceKobo: r.originalPriceKobo, now })) continue;
    out.set(l.id, { entryId: r.id, campaignName: r.campaign.name, tagline: r.campaign.tagline, theme: r.campaign.theme, originalKobo: r.originalPriceKobo, promoKobo: r.promoPriceKobo, pct: Math.round(discountPct(r.originalPriceKobo, r.promoPriceKobo)), endsOn: r.campaign.endsOn });
  }
  return out;
}

/** Search results with their tier and live promotion attached, Gold listings lifted as the ranking rules say. */
export async function searchListingsRanked(f: SearchFilters) {
  const rows = await searchListings(f);
  const [tiers, promos] = await Promise.all([tiersFor(rows.map((r) => r.companyId)), livePromos(rows)]);
  const seed = new Date().toISOString().slice(0, 10);
  const ranked = rankListings(rows, (r) => tierPerks(tiers.get(r.companyId) ?? "BASIC").autoBoost, seed);
  const covers = await coverPhotoIds(ranked.map((r) => r.id));
  return ranked.map((r) => ({ ...r, tier: tiers.get(r.companyId) ?? ("BASIC" as TierName), promo: promos.get(r.id) ?? null, coverPhotoId: covers.get(r.id) ?? null }));
}

export async function listingExtras(l: { id: string; companyId: string; status: string; priceKobo: bigint }) {
  const [tier, promos] = await Promise.all([tierOf(l.companyId), livePromos([l])]);
  return { tier, promo: promos.get(l.id) ?? null };
}
