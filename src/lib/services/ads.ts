import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { lockKey } from "../locks";
import { parseNairaToKobo } from "../money";
import { todayInLagos } from "../dates";
import { lagosDay } from "../notification-rules";
import { randomRef } from "../billing-rules";
import {
  DEFAULT_AD_CONFIG, PLACEMENTS, PLACEMENT_KEYS, adConfigProblem, campaignProblem, costPer, ctr, isBot, isLive, judgeClick, phaseOf, pickServed, suspensionReason,
  type AdConfig, type CampaignFacts, type Placement,
} from "../ad-rules";
import { matchSearch } from "../alert-rules";
import { entitlementIn } from "./subscriptions";
import { assertMayPay, ownerLabel, ownerOf, post, type Deps, type Payer } from "./billing";
import { notify } from "./notifications";
import { system } from "./rewards";
import type { Owner } from "./subscriptions";

// Advertising. A campaign promotes one published property in one place, for a budget paid in advance. The platform reviews it first.
// It runs only while it is approved, fully paid, inside its dates, the property is still published, and the advertiser's plan allows
// advertising. A click is charged once per visitor per day, never for the advertiser's own people or for bots, and spending can
// never pass what was paid: the database refuses it, and each click is billed under a lock for its campaign.

const nowOf = (d?: Deps) => d?.now ?? new Date();
const CONFIG_KEY = "ad_config";

async function assertAdmin(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Prices and limits ----------

export async function readAdConfig(): Promise<AdConfig> {
  const r = await prisma.platformSetting.findUnique({ where: { key: CONFIG_KEY } });
  if (!r) return DEFAULT_AD_CONFIG;
  try {
    const j = JSON.parse(r.value) as Partial<AdConfig>;
    const c: AdConfig = { ...DEFAULT_AD_CONFIG, ...j, cpcKobo: { ...DEFAULT_AD_CONFIG.cpcKobo, ...(j.cpcKobo ?? {}) } };
    return adConfigProblem(c) ? DEFAULT_AD_CONFIG : c;
  } catch { return DEFAULT_AD_CONFIG; }
}

export async function saveAdConfig(adminId: string, raw: { homeCpc: string; searchCpc: string; minBudget: string; maxBudget: string; maxDays: string }) {
  await assertAdmin(adminId);
  const naira = (v: string) => Number(parseNairaToKobo(v));
  const c: AdConfig = { cpcKobo: { HOME_FEATURED: naira(raw.homeCpc), SEARCH_TOP: naira(raw.searchCpc) }, minBudgetKobo: naira(raw.minBudget), maxBudgetKobo: naira(raw.maxBudget), maxDays: Number(raw.maxDays) };
  const problem = adConfigProblem(c);
  if (problem) throw new Error(problem);
  await system(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: JSON.stringify(c), updatedById: adminId }, update: { value: JSON.stringify(c), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: CONFIG_KEY, action: "settings.updated", detail: c as never });
  });
}

// ---------- The advertiser's side ----------

const ownerWhere = (o: Owner): Prisma.AdCampaignWhereInput => (o.kind === "USER" ? { ownerUserId: o.userId } : { ownerCompanyId: o.companyId });
const OPEN_STATES = ["PENDING_REVIEW", "APPROVED", "PAUSED", "SUSPENDED"] as const;

/** Advertising is a plan feature. Access must be full, and the plan's limit on campaigns at once must have room. */
async function assertMayAdvertise(tx: Tx, owner: Owner, excludeId?: string) {
  const e = await entitlementIn(tx, owner, "ADVERTISING");
  if (e.access !== "FULL") throw new Error(e.access === "READ_ONLY" ? "Your plan has run out, so you can look at campaigns but not add or send them." : "Your plan does not include advertising. Choose a plan that does.");
  if (e.limit !== null) {
    const open = await tx.adCampaign.count({ where: { ...ownerWhere(owner), status: { in: [...OPEN_STATES] }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (open >= e.limit) throw new Error(`Your plan allows ${e.limit} ${e.limit === 1 ? "campaign" : "campaigns"} at a time. End one to add another.`);
  }
}

export interface CampaignForm { name: string; listingRef: string; placement: string; headline: string; startsOn: string; endsOn: string; budget: string; dailyCap?: string }

/** Properties this advertiser may promote: published ones belonging to their company, or posted by them. */
export async function advertisableListings(p: Payer) {
  const owner = ownerOf(p);
  return system((tx) => tx.listing.findMany({ where: { status: "PUBLISHED", ...(owner.kind === "COMPANY" ? { companyId: owner.companyId } : { postedById: owner.userId }) }, orderBy: { publishedAt: "desc" }, take: 100, select: { id: true, publicRef: true, title: true, city: true, state: true } }));
}

async function parseForm(tx: Tx, owner: Owner, f: CampaignForm, cfg: AdConfig, now: Date) {
  if (!(PLACEMENT_KEYS as string[]).includes(f.placement)) throw new Error("Choose where the advert should appear");
  const placement = f.placement as Placement;
  const listing = await tx.listing.findFirst({ where: { publicRef: f.listingRef.trim(), status: "PUBLISHED", ...(owner.kind === "COMPANY" ? { companyId: owner.companyId } : { postedById: owner.userId }) } });
  if (!listing) throw new Error("Choose a published property of yours");
  let budget: bigint, cap: bigint | null = null;
  try { budget = parseNairaToKobo(f.budget); } catch { throw new Error("Enter the budget as a naira amount"); }
  try { cap = f.dailyCap && f.dailyCap.trim() ? parseNairaToKobo(f.dailyCap) : null; } catch { throw new Error("Enter the daily limit as a naira amount, or leave it empty"); }
  const cpc = cfg.cpcKobo[placement];
  const today = lagosDay(todayInLagos(now));
  const problem = campaignProblem({ startsOn: f.startsOn, endsOn: f.endsOn, budgetKobo: budget, dailyCapKobo: cap, headline: f.headline }, cfg, cpc, today);
  if (problem) throw new Error(problem);
  const name = f.name.trim();
  if (name.length < 1 || name.length > 80) throw new Error("Name the campaign (up to 80 characters)");
  return { name, listing, placement, budget, cap, cpc: BigInt(cpc), headline: f.headline.trim(), startsOn: new Date(`${f.startsOn}T00:00:00.000Z`), endsOn: new Date(`${f.endsOn}T00:00:00.000Z`) };
}

export async function createCampaign(p: Payer, f: CampaignForm, deps?: Deps) {
  assertMayPay(p);
  const owner = ownerOf(p), now = nowOf(deps), cfg = await readAdConfig();
  return system(async (tx) => {
    await assertMayAdvertise(tx, owner);
    const d = await parseForm(tx, owner, f, cfg, now);
    const c = await tx.adCampaign.create({
      data: { ref: randomRef("AD"), ownerKind: owner.kind, ownerUserId: owner.kind === "USER" ? owner.userId : null, ownerCompanyId: owner.kind === "COMPANY" ? owner.companyId : null, createdById: p.userId, name: d.name, listingId: d.listing.id, placement: d.placement, headline: d.headline, startsOn: d.startsOn, endsOn: d.endsOn, budgetKobo: d.budget, dailyCapKobo: d.cap, cpcKobo: d.cpc },
    });
    await logActivity(tx, { companyId: owner.kind === "COMPANY" ? owner.companyId : null, actorId: p.userId, entityType: "ad_campaign", entityId: c.id, action: "ad.created", detail: { ref: c.ref } });
    return c;
  });
}

async function mine(tx: Tx, p: Payer, id: string) {
  const c = await tx.adCampaign.findFirst({ where: { id, ...ownerWhere(ownerOf(p)) } });
  if (!c) throw new Error("Campaign not found");
  return c;
}

/** Change a campaign that has not been sent, or was not approved. The price of a click is set again from today's prices. */
export async function updateCampaign(p: Payer, id: string, f: CampaignForm, deps?: Deps) {
  assertMayPay(p);
  const owner = ownerOf(p), now = nowOf(deps), cfg = await readAdConfig();
  return system(async (tx) => {
    const c = await mine(tx, p, id);
    await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "DRAFT" && c.status !== "REJECTED") throw new Error("Only a campaign that has not been approved can be changed");
    const d = await parseForm(tx, owner, f, cfg, now);
    return tx.adCampaign.update({ where: { id: c.id }, data: { name: d.name, listingId: d.listing.id, placement: d.placement, headline: d.headline, startsOn: d.startsOn, endsOn: d.endsOn, budgetKobo: d.budget, dailyCapKobo: d.cap, cpcKobo: d.cpc, status: "DRAFT" } });
  });
}

export async function deleteDraft(p: Payer, id: string) {
  assertMayPay(p);
  await system(async (tx) => {
    const c = await mine(tx, p, id);
    if (c.status !== "DRAFT" && c.status !== "REJECTED") throw new Error("Only a campaign that was never approved can be deleted");
    if (c.fundedKobo > 0n) throw new Error("This campaign has been paid for");
    await tx.adCampaign.delete({ where: { id: c.id } });
  });
}

export async function submitCampaign(p: Payer, id: string, deps?: Deps) {
  assertMayPay(p);
  const owner = ownerOf(p), now = nowOf(deps), cfg = await readAdConfig();
  await system(async (tx) => {
    const c = await mine(tx, p, id);
    await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "DRAFT" && c.status !== "REJECTED") throw new Error("This campaign was already sent");
    await assertMayAdvertise(tx, owner, c.id);
    const listing = await tx.listing.findUnique({ where: { id: c.listingId } });
    if (!listing || listing.status !== "PUBLISHED") throw new Error("The property is not published, so it cannot be advertised");
    const problem = campaignProblem({ startsOn: c.startsOn.toISOString().slice(0, 10), endsOn: c.endsOn.toISOString().slice(0, 10), budgetKobo: c.budgetKobo, dailyCapKobo: c.dailyCapKobo, headline: c.headline }, cfg, Number(c.cpcKobo), lagosDay(todayInLagos(now)));
    if (problem) throw new Error(`${problem}. Change the campaign and send it again.`);
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: "PENDING_REVIEW", submittedAt: now, reviewNote: "" } });
    const admins = await tx.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 50 });
    for (const a of admins) await notify(tx, a.id, { kind: "admin.ad_review", title: "An advert needs review", body: c.name, link: "/admin/ads", dedupeKey: `ad-review:${c.id}:${now.toISOString().slice(0, 10)}` });
    await logActivity(tx, { companyId: c.ownerCompanyId, actorId: p.userId, entityType: "ad_campaign", entityId: c.id, action: "ad.submitted", detail: { ref: c.ref } });
  });
}

export async function pauseCampaign(p: Payer, id: string) {
  assertMayPay(p);
  await system(async (tx) => {
    const c = await mine(tx, p, id); await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "APPROVED") throw new Error("Only a running or scheduled campaign can be paused");
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: "PAUSED" } });
  });
}
export async function resumeCampaign(p: Payer, id: string) {
  assertMayPay(p);
  await system(async (tx) => {
    const c = await mine(tx, p, id); await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "PAUSED") throw new Error("This campaign is not paused");
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: "APPROVED" } });
  });
}
/** Stop for good. Budget not spent stays with the advertiser and can be refunded by the platform. */
export async function endCampaign(p: Payer, id: string, deps?: Deps) {
  assertMayPay(p);
  const now = nowOf(deps);
  await system(async (tx) => {
    const c = await mine(tx, p, id); await lockKey(tx, `ad:${c.id}`);
    if (c.status === "ENDED") throw new Error("This campaign has already ended");
    if (c.status === "DRAFT" || c.status === "REJECTED" || c.status === "PENDING_REVIEW") throw new Error("This campaign has not started. Delete it instead.");
    const e = await tx.adCampaign.update({ where: { id: c.id }, data: { status: "ENDED", endedReason: "Ended by the advertiser" } });
    await settleSpendIn(tx, e, now);
    await logActivity(tx, { companyId: c.ownerCompanyId, actorId: p.userId, entityType: "ad_campaign", entityId: c.id, action: "ad.ended", detail: {} });
  });
}

// ---------- Platform review ----------

export async function adQueue(adminId: string, o: { status?: string; page?: number } = {}) {
  await assertAdmin(adminId);
  const status = (["PENDING_REVIEW", "APPROVED", "SUSPENDED", "ENDED", "PAUSED", "REJECTED"] as const).find((s) => s === o.status) ?? "PENDING_REVIEW";
  const page = Math.max(0, o.page ?? 0);
  return system(async (tx) => {
    const [rows, total, counts] = await Promise.all([
      tx.adCampaign.findMany({ where: { status }, orderBy: { createdAt: "desc" }, skip: page * 20, take: 20, include: { listing: { select: { title: true, publicRef: true, city: true, status: true } } } }),
      tx.adCampaign.count({ where: { status } }),
      tx.adCampaign.groupBy({ by: ["status"], _count: true }),
    ]);
    const names = await ownerNames(tx, rows);
    return { rows: rows.map((r) => ({ ...r, ownerName: names.get(r.id) ?? "" })), total, page, status, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number> };
  });
}

async function ownerNames(tx: Tx, rows: { id: string; ownerUserId: string | null; ownerCompanyId: string | null }[]) {
  const users = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const cos = await tx.company.findMany({ where: { id: { in: rows.map((r) => r.ownerCompanyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.ownerUserId ? (users.find((u) => u.id === r.ownerUserId)?.name ?? "") : (cos.find((c) => c.id === r.ownerCompanyId)?.name ?? "")]));
}

/** Approve (and raise the invoice for the budget) or turn down. Nothing runs until it is paid. */
export async function reviewCampaign(adminId: string, id: string, decision: "approve" | "reject", noteInput: string, deps?: Deps) {
  await assertAdmin(adminId);
  const note = noteInput.trim();
  if (decision === "reject" && note.length < 5) throw new Error("Say why the campaign was not approved");
  const now = nowOf(deps);
  await system(async (tx) => {
    const c = await tx.adCampaign.findUnique({ where: { id } });
    if (!c) throw new Error("Campaign not found");
    await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "PENDING_REVIEW") throw new Error("This campaign is not waiting for review");
    const listing = await tx.listing.findUnique({ where: { id: c.listingId } });
    if (decision === "approve" && listing?.status !== "PUBLISHED") throw new Error("The property is not published, so the campaign cannot be approved");
    if (decision === "reject") {
      await tx.adCampaign.update({ where: { id: c.id }, data: { status: "REJECTED", reviewNote: note.slice(0, 500), reviewedById: adminId, reviewedAt: now } });
      await notify(tx, c.createdById, { kind: "billing.ad_rejected", title: "Your campaign was not approved", body: `${c.name}: ${note}`, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-rej:${c.id}:${now.getTime()}` });
    } else {
      let invoiceId = c.invoiceId;
      const existing = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : null;
      if (!existing || existing.status === "VOID" || existing.amountKobo !== c.budgetKobo) {
        if (existing && existing.status === "OPEN") await tx.invoice.update({ where: { id: existing.id }, data: { status: "VOID", voidedAt: now, voidReason: "Replaced after the campaign was changed" } });
        const owner: Owner = c.ownerUserId ? { kind: "USER", userId: c.ownerUserId } : { kind: "COMPANY", companyId: c.ownerCompanyId! };
        const inv = await tx.invoice.create({
          data: {
            ref: randomRef("INV"), purpose: "AD_CAMPAIGN", ownerKind: owner.kind, ownerUserId: c.ownerUserId, ownerCompanyId: c.ownerCompanyId,
            ownerName: await ownerLabel(tx, owner),
            subjectId: c.id, description: `Advertising budget for "${c.name}" (${PLACEMENTS[c.placement as Placement].label})`.slice(0, 300), amountKobo: c.budgetKobo, dueOn: c.startsOn, createdById: c.createdById,
          },
        });
        invoiceId = inv.id;
      }
      await tx.adCampaign.update({ where: { id: c.id }, data: { status: "APPROVED", reviewNote: note.slice(0, 500), reviewedById: adminId, reviewedAt: now, invoiceId } });
      await notify(tx, c.createdById, { kind: "billing.ad_approved", title: "Your campaign was approved", body: `${c.name}. Pay the budget and it starts on its start date.`, link: c.ownerUserId ? "/me/billing" : "/app/billing", dedupeKey: `ad-ok:${c.id}:${now.getTime()}` });
    }
    await logActivity(tx, { companyId: c.ownerCompanyId, actorId: adminId, entityType: "ad_campaign", entityId: c.id, action: decision === "approve" ? "ad.approved" : "ad.rejected", detail: { note } });
  });
}

export async function suspendCampaign(adminId: string, id: string, reasonInput: string) {
  await assertAdmin(adminId);
  const reason = reasonInput.trim();
  if (reason.length < 5) throw new Error("Give the reason for suspending this campaign");
  await system(async (tx) => {
    const c = await tx.adCampaign.findUnique({ where: { id } });
    if (!c) throw new Error("Campaign not found");
    await lockKey(tx, `ad:${c.id}`);
    if (c.status !== "APPROVED" && c.status !== "PAUSED") throw new Error("Only a running, scheduled or paused campaign can be suspended");
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: "SUSPENDED", suspendedBy: "ADMIN", suspendReason: reason.slice(0, 500), suspendedAt: new Date() } });
    await notify(tx, c.createdById, { kind: "billing.ad_suspended", title: "Your campaign was suspended", body: `${c.name}: ${reason}`, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-susp:${c.id}:${Date.now()}` });
    await logActivity(tx, { companyId: c.ownerCompanyId, actorId: adminId, entityType: "ad_campaign", entityId: c.id, action: "ad.suspended", detail: { reason } });
  });
}
export async function liftSuspension(adminId: string, id: string) {
  await assertAdmin(adminId);
  await system(async (tx) => {
    const c = await tx.adCampaign.findUnique({ where: { id } });
    if (!c || c.status !== "SUSPENDED") throw new Error("This campaign is not suspended");
    await lockKey(tx, `ad:${c.id}`);
    await tx.adCampaign.update({ where: { id: c.id }, data: { status: "APPROVED", suspendedBy: "", suspendReason: "", suspendedAt: null } });
    await logActivity(tx, { companyId: c.ownerCompanyId, actorId: adminId, entityType: "ad_campaign", entityId: c.id, action: "ad.suspension_lifted", detail: {} });
  });
}

// ---------- Money ----------

/** A paid invoice funds its campaign. Called once per payment, inside the settlement transaction. */
export async function fundCampaign(tx: Tx, inv: Prisma.InvoiceGetPayload<object>, now: Date): Promise<void> {
  const c = await tx.adCampaign.findUnique({ where: { id: inv.subjectId } });
  if (!c) throw new Error("The campaign on this invoice no longer exists");
  await lockKey(tx, `ad:${c.id}`);
  await tx.adCampaign.update({ where: { id: c.id }, data: { fundedKobo: { increment: inv.amountKobo } } });
  await tx.invoice.update({ where: { id: inv.id }, data: { appliedAt: now } });
  await notify(tx, c.createdById, { kind: "billing.ad_funded", title: "Your campaign is paid for", body: `${c.name} starts on its start date once it is approved.`, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-funded:${inv.id}` });
}

/** Budget paid in and not yet spent. */
export async function unspentFor(tx: Tx, campaignId: string): Promise<bigint> {
  const c = await tx.adCampaign.findUnique({ where: { id: campaignId }, select: { fundedKobo: true, spentKobo: true } });
  if (!c) return 0n;
  const left = c.fundedKobo - c.spentKobo;
  return left > 0n ? left : 0n;
}

/** Money went back to the advertiser: the budget shrinks and the campaign stops, so it can never spend what is no longer there. */
export async function applyCampaignRefund(tx: Tx, campaignId: string, amount: bigint, now: Date): Promise<void> {
  await lockKey(tx, `ad:${campaignId}`);
  const c = await tx.adCampaign.findUnique({ where: { id: campaignId } });
  if (!c) return;
  const updated = await tx.adCampaign.update({ where: { id: c.id }, data: { fundedKobo: c.fundedKobo - amount, status: "ENDED", endedReason: c.status === "ENDED" ? c.endedReason : "Budget refunded" } });
  await settleSpendIn(tx, updated, now);
}

/** Move what has been spent from the advertiser's held funds to earned revenue. Safe to repeat: each step has its own key. */
export async function settleSpendIn(tx: Tx, c: { id: string; spentKobo: bigint; postedKobo: bigint }, _now: Date): Promise<bigint> {
  const delta = c.spentKobo - c.postedKobo;
  if (delta <= 0n) return 0n;
  const base = { ledger: "ADVERTISING" as const, kind: "SPEND" as const, campaignId: c.id, actorId: "system:ads", note: "Clicks charged" };
  await post(tx, { ...base, account: "FUNDS_HELD", amountKobo: -delta, entryKey: `spend:${c.id}:${c.postedKobo}:h` });
  await post(tx, { ...base, account: "REVENUE", amountKobo: delta, entryKey: `spend:${c.id}:${c.postedKobo}:r` });
  await tx.adCampaign.update({ where: { id: c.id }, data: { postedKobo: c.spentKobo } });
  return delta;
}

// ---------- Showing adverts ----------

export function viewerKeyFor(ip: string, ua: string, now: Date = new Date()): string {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.APP_DB_PASSWORD || "dev-secret";
  return createHash("sha256").update(`${secret}|${lagosDay(now)}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

const factsOf = (c: { status: string; startsOn: Date; endsOn: Date; fundedKobo: bigint; spentKobo: bigint; budgetKobo: bigint; cpcKobo: bigint }): CampaignFacts => ({ status: c.status as CampaignFacts["status"], startsOn: c.startsOn, endsOn: c.endsOn, fundedKobo: c.fundedKobo, spentKobo: c.spentKobo, budgetKobo: c.budgetKobo, cpcKobo: c.cpcKobo });

export interface SponsoredItem { ref: string; headline: string; listing: { publicRef: string; title: string; priceKobo: bigint; purpose: string; city: string; state: string; bedrooms: number | null; bathrooms: number | null } }

/**
 * The adverts to show in one place. Only campaigns that are live right now, whose property is still published and whose plan still
 * allows advertising are considered. For search results the property must itself match the search. Showing counts as an impression.
 */
export async function sponsoredFor(placement: Placement, o: { filters?: { q?: string; purpose?: string; city?: string; maxPrice?: string; minBeds?: string }; bot?: boolean; now?: Date } = {}): Promise<SponsoredItem[]> {
  const now = o.now ?? new Date(), today = lagosDay(now);
  return system(async (tx) => {
    const cands = await tx.adCampaign.findMany({ where: { status: "APPROVED", placement, startsOn: { lte: new Date(now.getTime() + 864e5) }, listing: { status: "PUBLISHED" } }, include: { listing: true, days: { where: { day: today } } }, take: 200 });
    const owners = new Map<string, Awaited<ReturnType<typeof entitlementIn>>>();
    const live: ((typeof cands)[number] & { shownToday: number })[] = [];
    for (const c of cands) {
      if (!isLive(factsOf(c), now)) continue;
      const k = c.ownerUserId ? `u:${c.ownerUserId}` : `c:${c.ownerCompanyId}`;
      if (!owners.has(k)) owners.set(k, await entitlementIn(tx, c.ownerUserId ? { kind: "USER", userId: c.ownerUserId } : { kind: "COMPANY", companyId: c.ownerCompanyId! }, "ADVERTISING", now));
      if (owners.get(k)!.access !== "FULL") continue;
      if (placement === "SEARCH_TOP") {
        const f = o.filters ?? {};
        let maxKobo: bigint | null = null;
        try { maxKobo = f.maxPrice ? parseNairaToKobo(f.maxPrice) : null; } catch { maxKobo = null; }
        const beds = f.minBeds ? Number.parseInt(f.minBeds, 10) : NaN;
        if (!matchSearch(c.listing, { purpose: f.purpose ?? "", city: f.city ?? "", q: f.q ?? "", maxKobo, minBeds: Number.isInteger(beds) ? beds : null })) continue;
      }
      live.push({ ...c, shownToday: c.days[0]?.impressions ?? 0 });
    }
    const chosen = pickServed(live, PLACEMENTS[placement].slots, today);
    if (!o.bot) {
      for (const c of chosen) {
        await tx.adCampaign.update({ where: { id: c.id }, data: { impressions: { increment: 1 } } });
        await tx.adDay.upsert({ where: { campaignId_day: { campaignId: c.id, day: today } }, create: { campaignId: c.id, day: today, impressions: 1 }, update: { impressions: { increment: 1 } } });
      }
    }
    return chosen.map((c) => ({ ref: c.ref, headline: c.headline, listing: { publicRef: c.listing.publicRef, title: c.listing.title, priceKobo: c.listing.priceKobo, purpose: c.listing.purpose, city: c.listing.city, state: c.listing.state, bedrooms: c.listing.bedrooms, bathrooms: c.listing.bathrooms } }));
  });
}

/**
 * Someone clicked an advert. They always reach the property (the advert is not a trap), but the advertiser is charged only when the
 * click is live, from a real person who is not the advertiser's own, and the first from that visitor today. The charge happens under
 * the campaign's lock, so two clicks at the same moment can never spend the same money.
 */
export async function recordClick(ref: string, v: { viewerKey: string; userId?: string | null; ua?: string | null; now?: Date }): Promise<{ to: string }> {
  const now = v.now ?? new Date(), today = lagosDay(now), bot = isBot(v.ua);
  const c0 = await system((tx) => tx.adCampaign.findUnique({ where: { ref }, include: { listing: { select: { publicRef: true, companyId: true, postedById: true } } } }));
  if (!c0) return { to: "/" };
  const to = `/properties/${c0.listing.publicRef}?ad=${encodeURIComponent(c0.ref)}`;
  const own = !!v.userId && (v.userId === c0.ownerUserId || v.userId === c0.listing.postedById || (await isMemberOf(v.userId, c0.ownerCompanyId ?? c0.listing.companyId)));
  await system(async (tx) => {
    await lockKey(tx, `ad:${c0.id}`);
    const c = await tx.adCampaign.findUniqueOrThrow({ where: { id: c0.id }, include: { listing: { select: { status: true } }, days: { where: { day: today } } } });
    const ent = await entitlementIn(tx, c.ownerUserId ? { kind: "USER", userId: c.ownerUserId } : { kind: "COMPANY", companyId: c.ownerCompanyId! }, "ADVERTISING", now);
    const live = isLive(factsOf(c), now) && c.listing.status === "PUBLISHED" && ent.access === "FULL";
    const repeat = !!(await tx.adClick.findFirst({ where: { campaignId: c.id, viewerKey: v.viewerKey, createdAt: { gt: new Date(now.getTime() - 864e5) } }, select: { id: true } }));
    const verdict = judgeClick({ live, bot, own, repeat, cpcKobo: c.cpcKobo, remainingKobo: c.fundedKobo - c.spentKobo, spentTodayKobo: c.days[0]?.spentKobo ?? 0n, dailyCapKobo: c.dailyCapKobo });
    await tx.adClick.create({ data: { campaignId: c.id, viewerKey: v.viewerKey, userId: v.userId ?? null, billed: verdict.bill, reason: verdict.bill ? "" : verdict.reason } });
    if (bot) return;
    const cost = verdict.bill ? c.cpcKobo : 0n;
    const updated = await tx.adCampaign.update({ where: { id: c.id }, data: { clicks: { increment: 1 }, ...(verdict.bill ? { billedClicks: { increment: 1 }, spentKobo: { increment: cost } } : {}) } });
    await tx.adDay.upsert({ where: { campaignId_day: { campaignId: c.id, day: today } }, create: { campaignId: c.id, day: today, clicks: 1, billedClicks: verdict.bill ? 1 : 0, spentKobo: cost }, update: { clicks: { increment: 1 }, ...(verdict.bill ? { billedClicks: { increment: 1 }, spentKobo: { increment: cost } } : {}) } });
    if (verdict.bill && updated.fundedKobo - updated.spentKobo < updated.cpcKobo) {
      const ended = await tx.adCampaign.update({ where: { id: c.id }, data: { status: "ENDED", endedReason: "The budget was used up" } });
      await settleSpendIn(tx, ended, now);
      await notify(tx, c.createdById, { kind: "billing.ad_ended", title: "Your campaign used its whole budget", body: c.name, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-done:${c.id}` });
    }
  });
  return { to };
}

async function isMemberOf(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const m = await withTenant(companyId, userId, (tx) => tx.membership.findFirst({ where: { companyId, userId, status: "ACTIVE" }, select: { id: true } }));
  return !!m;
}

/** A visit to a property page, once per visitor per day, remembered as coming from an advert or not. An advert visit wins over an earlier ordinary one. */
export async function recordView(listingId: string, viewerKey: string, adRef: string | null, now: Date = new Date()): Promise<void> {
  let via = "ORGANIC";
  if (adRef) {
    const ok = await system((tx) => tx.adCampaign.findFirst({ where: { ref: adRef, listingId }, select: { id: true } }));
    if (ok) via = "AD";
  }
  await system((tx) => tx.$executeRaw`INSERT INTO listing_view_keys (listing_id, day, viewer_key, via) VALUES (${listingId}, ${lagosDay(now)}, ${viewerKey}, ${via}) ON CONFLICT (listing_id, day, viewer_key) DO UPDATE SET via = 'AD' WHERE EXCLUDED.via = 'AD'`);
}

/** Which campaign an enquiry came from: the advert must be for this property and the same visitor must have clicked it in the last week. */
export async function attributeEnquiry(listingId: string, adRef: string | null, viewerKey: string, now: Date = new Date()): Promise<string | null> {
  if (!adRef) return null;
  return system(async (tx) => {
    const c = await tx.adCampaign.findFirst({ where: { ref: adRef, listingId }, select: { id: true } });
    if (!c) return null;
    const click = await tx.adClick.findFirst({ where: { campaignId: c.id, viewerKey, createdAt: { gt: new Date(now.getTime() - 7 * 864e5) } }, select: { id: true } });
    // The visitor key changes each day, so a click made yesterday cannot be matched today; the same-day click is what can be proven.
    return click ? c.id : null;
  });
}

// ---------- Suspending and ending automatically ----------

/**
 * The defined conditions under which a campaign stops without anyone deciding: its dates are over, its budget is used up, its
 * property is no longer published, or the advertiser's plan no longer allows advertising. When the cause goes away a campaign that
 * was stopped by this check starts again; one an administrator suspended stays suspended. Spend is moved into the books here too.
 */
export async function evaluateCampaigns(deps?: Deps): Promise<{ ended: number; suspended: number; resumed: number; settled: number }> {
  const now = nowOf(deps);
  const ids = await system((tx) => tx.adCampaign.findMany({ where: { OR: [{ status: "APPROVED" }, { status: "SUSPENDED", suspendedBy: "SYSTEM" }, { status: "PAUSED" }] }, select: { id: true }, take: 2000 }));
  let ended = 0, suspended = 0, resumed = 0, settled = 0;
  for (const { id } of ids) {
    await system(async (tx) => {
      await lockKey(tx, `ad:${id}`);
      const c = await tx.adCampaign.findUnique({ where: { id }, include: { listing: { select: { status: true } } } });
      if (!c || !["APPROVED", "SUSPENDED", "PAUSED"].includes(c.status)) return;
      const phase = phaseOf({ ...factsOf(c), status: c.status === "SUSPENDED" || c.status === "PAUSED" ? "APPROVED" : (c.status as CampaignFacts["status"]) }, now);
      if (phase === "ENDED") {
        const e = await tx.adCampaign.update({ where: { id }, data: { status: "ENDED", endedReason: lagosDay(now) > lagosDay(c.endsOn) ? "The end date passed" : "The budget was used up", suspendedBy: "", suspendReason: "" } });
        await settleSpendIn(tx, e, now);
        ended++;
        return;
      }
      if (c.status === "PAUSED") return;
      const ent = await entitlementIn(tx, c.ownerUserId ? { kind: "USER", userId: c.ownerUserId } : { kind: "COMPANY", companyId: c.ownerCompanyId! }, "ADVERTISING", now);
      const reason = suspensionReason({ listingPublished: c.listing.status === "PUBLISHED", access: ent.access });
      if (c.status === "APPROVED" && reason) {
        await tx.adCampaign.update({ where: { id }, data: { status: "SUSPENDED", suspendedBy: "SYSTEM", suspendReason: reason, suspendedAt: now } });
        await notify(tx, c.createdById, { kind: "billing.ad_suspended", title: "Your campaign was stopped", body: `${c.name}: ${reason}`, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-susp:${c.id}:${lagosDay(now)}` });
        suspended++;
      } else if (c.status === "SUSPENDED" && !reason) {
        await tx.adCampaign.update({ where: { id }, data: { status: "APPROVED", suspendedBy: "", suspendReason: "", suspendedAt: null } });
        await notify(tx, c.createdById, { kind: "billing.ad_resumed", title: "Your campaign is running again", body: c.name, link: c.ownerUserId ? "/me/ads" : "/app/ads", dedupeKey: `ad-res:${c.id}:${lagosDay(now)}` });
        resumed++;
      }
    });
  }
  const owing = await system((tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM ad_campaigns WHERE spent_kobo > posted_kobo LIMIT 2000`);
  for (const { id } of owing) {
    const d = await system(async (tx) => {
      await lockKey(tx, `ad:${id}`);
      const c = await tx.adCampaign.findUnique({ where: { id } });
      return c ? settleSpendIn(tx, c, now) : 0n;
    });
    if (d > 0n) settled++;
  }
  return { ended, suspended, resumed, settled };
}

// ---------- Reading and reporting ----------

export async function myCampaigns(p: Payer) {
  assertMayPay(p, "billing.view");
  return system((tx) => tx.adCampaign.findMany({ where: ownerWhere(ownerOf(p)), orderBy: { createdAt: "desc" }, take: 100, include: { listing: { select: { title: true, publicRef: true, status: true } } } }));
}

export async function myCampaign(p: Payer, ref: string) {
  assertMayPay(p, "billing.view");
  return system((tx) => tx.adCampaign.findFirst({ where: { ref, ...ownerWhere(ownerOf(p)) }, include: { listing: { select: { id: true, title: true, publicRef: true, status: true } } } }));
}

export type Who = { admin: string } | { payer: Payer };

/**
 * How a campaign did, with the paid and the organic attention to the same property kept apart. Visits and enquiries that came through
 * the advert are counted as paid; all other visits and enquiries in the same dates are organic, and the dates just before the
 * campaign give a baseline to compare against.
 */
export async function campaignReport(who: Who, ref: string, now: Date = new Date()) {
  if ("admin" in who) await assertAdmin(who.admin); else assertMayPay(who.payer, "billing.view");
  const c = await system((tx) => tx.adCampaign.findFirst({ where: { ref, ...("payer" in who ? ownerWhere(ownerOf(who.payer)) : {}) }, include: { days: { orderBy: { day: "asc" } }, listing: { select: { id: true, title: true, publicRef: true, companyId: true } } } }));
  if (!c) return null;
  const from = lagosDay(c.startsOn), last = lagosDay(c.endsOn), today = lagosDay(now);
  const to = today < last ? today : last;
  const started = today >= from;
  const baseFrom = lagosDay(new Date(c.startsOn.getTime() - 14 * 864e5)), baseTo = lagosDay(new Date(c.startsOn.getTime() - 864e5));
  const { views, baseViews } = await system(async (tx) => ({
    views: started ? await tx.listingViewKey.groupBy({ by: ["via", "day"], where: { listingId: c.listingId, day: { gte: from, lte: to } }, _count: true }) : [],
    baseViews: await tx.listingViewKey.count({ where: { listingId: c.listingId, day: { gte: baseFrom, lte: baseTo }, via: "ORGANIC" } }),
  }));
  // Enquiries belong to the listing's company, so they are counted inside that company's own context; only counts leave it.
  const periodEnd = new Date(Math.min(now.getTime(), c.endsOn.getTime() + 864e5));
  const enquiries = started ? await withTenant(c.listing.companyId, "system", (tx) => tx.enquiry.groupBy({ by: ["adCampaignId"], where: { listingId: c.listingId, createdAt: { gte: c.startsOn, lt: periodEnd } }, _count: true })) : [];
  const sum = (via: string) => views.filter((x) => x.via === via).reduce((n, x) => n + x._count, 0);
  const paidEnq = enquiries.filter((e) => e.adCampaignId === c.id).reduce((n, e) => n + e._count, 0);
  const otherAdEnq = enquiries.filter((e) => e.adCampaignId && e.adCampaignId !== c.id).reduce((n, e) => n + e._count, 0);
  const organicEnq = enquiries.filter((e) => !e.adCampaignId).reduce((n, e) => n + e._count, 0);
  const daysRun = started ? Math.max(1, Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 864e5) + 1) : 0;
  const organicViews = sum("ORGANIC");
  const daily = c.days.map((d) => ({ day: d.day, impressions: d.impressions, clicks: d.clicks, billedClicks: d.billedClicks, spentKobo: d.spentKobo, paidViews: views.filter((x) => x.day === d.day && x.via === "AD").reduce((n, x) => n + x._count, 0), organicViews: views.filter((x) => x.day === d.day && x.via === "ORGANIC").reduce((n, x) => n + x._count, 0) }));
  return {
    campaign: c,
    phase: phaseOf(factsOf(c), now),
    paid: { impressions: c.impressions, clicks: c.clicks, billedClicks: c.billedClicks, ctr: ctr(c.impressions, c.clicks), spentKobo: c.spentKobo, costPerClickKobo: costPer(c.spentKobo, c.billedClicks), views: sum("AD"), enquiries: paidEnq, costPerEnquiryKobo: costPer(c.spentKobo, paidEnq) },
    organic: { views: organicViews, enquiries: organicEnq, viewsPerDay: daysRun ? Math.round((organicViews / daysRun) * 10) / 10 : 0, baselineViewsPerDay: Math.round((baseViews / 14) * 10) / 10, otherAdEnquiries: otherAdEnq },
    remainingKobo: c.fundedKobo - c.spentKobo,
    daily,
    period: { from, to, started },
  };
}
export type CampaignReport = NonNullable<Awaited<ReturnType<typeof campaignReport>>>;

const csvCell = (v: string | number | bigint) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const naira = (k: bigint) => (Number(k) / 100).toFixed(2);

/** The report as a spreadsheet file. */
export function reportCsv(r: CampaignReport): string {
  const rows: (string | number | bigint)[][] = [
    ["Campaign", r.campaign.ref, r.campaign.name], ["Property", r.campaign.listing.publicRef, r.campaign.listing.title], ["Placement", PLACEMENTS[r.campaign.placement as Placement].label], ["Dates", r.period.from, r.period.to], [],
    ["Paid: impressions", r.paid.impressions], ["Paid: clicks", r.paid.clicks], ["Paid: billed clicks", r.paid.billedClicks], ["Paid: click-through rate %", r.paid.ctr], ["Paid: spent (NGN)", naira(r.paid.spentKobo)], ["Paid: visits from the advert", r.paid.views], ["Paid: enquiries", r.paid.enquiries],
    ["Organic: visits", r.organic.views], ["Organic: enquiries", r.organic.enquiries], ["Organic: visits per day during", r.organic.viewsPerDay], ["Organic: visits per day before", r.organic.baselineViewsPerDay], [],
    ["Day", "Impressions", "Clicks", "Billed clicks", "Spent (NGN)", "Visits from advert", "Organic visits"],
    ...r.daily.map((d) => [d.day, d.impressions, d.clicks, d.billedClicks, naira(d.spentKobo), d.paidViews, d.organicViews]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
