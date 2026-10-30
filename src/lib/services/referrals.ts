import { randomInt } from "node:crypto";
import { z } from "zod";

/** A whole number that may arrive as text from a form. */
const int = (min: number, max: number, minMessage?: string) => z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number({ error: "Enter a whole number" }).int("Enter a whole number").min(min, minMessage).max(max));
import { prisma, withPlatformAdmin, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { randomRef } from "../tokens";
import { CODE_ALPHABET, attributionOpen, campaignOpen, isCodeShape, maskName, qualifyingOpen, referralSignals, SIGNAL_TEXT } from "../reward-rules";
import { PROGRAMME_EVENTS, moveReward, openReward, readRewardSettings, system, SYSTEM } from "./rewards";

// Referrals: a person shares a link, someone signs up, and a reward opens only when the campaign's own condition is met in time.

type Audience = "SEEKER" | "OWNER" | "AGENT" | "COMPANY" | "DEVELOPER" | "VENDOR" | "SUBSCRIBER" | "LISTING" | "OTHER";
export type SignupKind = "SEEKER" | "COMPANY";
const AUDIENCES_FOR: Record<SignupKind, Audience[]> = {
  SEEKER: ["SEEKER", "OTHER"],
  COMPANY: ["COMPANY", "AGENT", "OWNER", "DEVELOPER", "VENDOR", "SUBSCRIBER", "LISTING", "OTHER"],
};

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Campaigns ----------

const campaignSchema = z.object({
  name: z.string().trim().min(3, "Name the campaign").max(120),
  audience: z.enum(["SEEKER", "OWNER", "AGENT", "COMPANY", "DEVELOPER", "VENDOR", "SUBSCRIBER", "LISTING", "OTHER"]),
  event: z.enum(PROGRAMME_EVENTS.REFERRAL),
  description: z.string().trim().max(1000).default(""),
  startsOn: z.string().min(1, "Choose a start date"),
  endsOn: z.string().optional().transform((v) => v || null),
  attributionDays: int(1, 365),
  qualifyWithinDays: int(1, 730),
  maxRewardsPerReferrer: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : null)),
});
export async function createCampaign(adminId: string, raw: z.input<typeof campaignSchema>) {
  await adminOnly(adminId);
  const d = campaignSchema.parse(raw);
  const startsOn = new Date(`${d.startsOn}T00:00:00+01:00`);
  const endsOn = d.endsOn ? new Date(`${d.endsOn}T00:00:00+01:00`) : null;
  if (Number.isNaN(startsOn.getTime()) || (endsOn && Number.isNaN(endsOn.getTime()))) throw new Error("Check the dates");
  if (endsOn && endsOn < startsOn) throw new Error("The campaign cannot end before it starts");
  if (d.maxRewardsPerReferrer !== null && !(d.maxRewardsPerReferrer >= 1)) throw new Error("The cap per referrer must be 1 or more");
  return withPlatformAdmin(adminId, async (tx) => {
    const c = await tx.referralCampaign.create({ data: { name: d.name, audience: d.audience, event: d.event, description: d.description, startsOn, endsOn, attributionDays: d.attributionDays, qualifyWithinDays: d.qualifyWithinDays, maxRewardsPerReferrer: d.maxRewardsPerReferrer, createdById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "referral_campaign", entityId: c.id, action: "referral_campaign.created", detail: { name: d.name, event: d.event } });
    return c;
  });
}
export async function endCampaign(adminId: string, campaignId: string) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.referralCampaign.update({ where: { id: campaignId }, data: { active: false } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "referral_campaign", entityId: campaignId, action: "referral_campaign.ended", detail: {} });
  });
}
export const listCampaigns = (userId: string) => withUser(userId, (tx) => tx.referralCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }));

// ---------- Codes and clicks ----------

const makeCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

export async function getOrCreateCode(userId: string) {
  return withUser(userId, async (tx) => {
    const have = await tx.referralCode.findUnique({ where: { userId } });
    if (have) return have;
    for (let i = 0; i < 5; i++) {
      try { return await tx.referralCode.create({ data: { userId, code: makeCode() } }); }
      catch (e) { if (i === 4 || (e as { code?: string }).code !== "P2002") throw e; }
    }
    throw new Error("Could not create a code");
  });
}
/** A visit to /r/CODE. Only a count is kept: nothing about the visitor. */
export async function countClick(code: string): Promise<boolean> {
  if (!isCodeShape(code)) return false;
  return system(async (tx) => {
    const r = await tx.referralCode.updateMany({ where: { code, active: true }, data: { clicks: { increment: 1 } } });
    return r.count === 1;
  });
}

// ---------- Attribution ----------

/** Called after a sign-up. It never blocks the sign-up and never throws. Returns the attribution ref if one was made. */
export async function captureReferral(newUser: { id: string; name: string; email: string; companyId?: string | null }, kind: SignupKind, referral: { code: string; at: number } | null | undefined): Promise<string | null> {
  try {
    if (!referral || !isCodeShape(referral.code)) return null;
    const settings = await readRewardSettings();
    return await system(async (tx) => {
      const code = await tx.referralCode.findFirst({ where: { code: referral.code, active: true } });
      if (!code || code.userId === newUser.id) return null;
      const now = new Date();
      const campaigns = await tx.referralCampaign.findMany({ where: { audience: { in: AUDIENCES_FOR[kind] } }, orderBy: { startsOn: "desc" } });
      const campaign = campaigns.find((c) => campaignOpen(c, now) && attributionOpen(referral.at, c.attributionDays, now));
      if (!campaign) return null;
      const referrer = await tx.user.findUnique({ where: { id: code.userId }, select: { email: true, name: true, createdAt: true } });
      if (!referrer) return null;
      const burst = await tx.referralAttribution.count({ where: { referrerId: code.userId, registeredAt: { gte: new Date(now.getTime() - 864e5) } } });
      const signals = referralSignals({ referrer, referred: newUser, referrerSignupsLast24h: burst, burstLimit: settings.referralBurstPerDay, now });
      const a = await tx.referralAttribution.create({
        data: { ref: randomRef("RF", 8), codeId: code.id, referrerId: code.userId, referredUserId: newUser.id, referredName: newUser.name, referredCompanyId: newUser.companyId ?? null, campaignId: campaign.id, signals: signals.join(","), reviewState: signals.length ? "FLAGGED" : "CLEAR" },
      });
      if (campaign.event === "REFERRAL_REGISTERED") await qualify(tx, a.id, "REFERRAL_REGISTERED", "attribution", a.id, `${maskName(a.referredName)} signed up`);
      return a.ref;
    });
  } catch {
    return null;
  }
}


async function qualify(tx: Tx, attributionId: string, event: (typeof PROGRAMME_EVENTS.REFERRAL)[number], sourceType: string, sourceId: string, label: string) {
  const a = await tx.referralAttribution.findUnique({ where: { id: attributionId } });
  // One referred person or company earns the referrer one reward for the campaign, however many times they do the qualifying thing.
  if (!a || a.status !== "REGISTERED") return null;
  const c = await tx.referralCampaign.findUnique({ where: { id: a.campaignId } });
  if (!c || c.event !== event) return null;
  const now = new Date();
  if (!qualifyingOpen(a.registeredAt, c.qualifyWithinDays, now)) {
    await tx.referralAttribution.updateMany({ where: { id: a.id, status: "REGISTERED" }, data: { status: "EXPIRED", rejectReason: "The qualifying event came after the allowed time." } });
    return null;
  }
  let notEligible: string | undefined;
  if (c.maxRewardsPerReferrer) {
    const policyIds = (await tx.rewardPolicy.findMany({ where: { campaignId: c.id }, select: { id: true } })).map((p) => p.id);
    const used = await tx.reward.count({ where: { userId: a.referrerId, policyId: { in: policyIds }, status: { notIn: ["NOT_ELIGIBLE", "REJECTED", "CANCELLED"] } } });
    if (used >= c.maxRewardsPerReferrer) notEligible = `This campaign pays at most ${c.maxRewardsPerReferrer} rewards per person.`;
  }
  const reward = await openReward(tx, { userId: a.referrerId, programme: "REFERRAL", event, campaignId: c.id, sourceType, sourceId, sourceLabel: label, needsReview: a.reviewState === "FLAGGED", notEligible });
  await tx.referralAttribution.updateMany({ where: { id: a.id, status: "REGISTERED" }, data: { status: "QUALIFIED", qualifiedAt: now } });
  return reward;
}

/** A qualifying thing happened to a referred person or company. Safe to call for anyone: it does nothing if they were not referred. */
export async function referralEvent(event: (typeof PROGRAMME_EVENTS.REFERRAL)[number], who: { userId?: string | null; companyId?: string | null }, source: { type: string; id: string; label: string }): Promise<void> {
  try {
    await system(async (tx) => {
      const a = await tx.referralAttribution.findFirst({ where: { OR: [...(who.userId ? [{ referredUserId: who.userId }] : []), ...(who.companyId ? [{ referredCompanyId: who.companyId }] : [])] } });
      if (a) await qualify(tx, a.id, event, source.type, source.id, source.label);
    });
  } catch { /* A reward must never break the action that triggered it. */ }
}

export async function recordCustomEvent(adminId: string, attributionId: string, note: string) {
  await adminOnly(adminId);
  const text = z.string().trim().min(5, "Say what happened").max(300).parse(note);
  const reward = await withPlatformAdmin(adminId, async (tx) => {
    const a = await tx.referralAttribution.findUnique({ where: { id: attributionId } });
    if (!a) throw new Error("Referral not found");
    const r = await qualify(tx, a.id, "REFERRAL_CUSTOM", "attribution_custom", a.id, text);
    if (r) await logActivity(tx, { companyId: null, actorId: adminId, entityType: "referral", entityId: a.id, action: "referral.custom_event", detail: { note: text } });
    return r;
  });
  // The failure is raised after the transaction so that an expiry recorded inside it is kept.
  if (!reward) throw new Error("This referral cannot earn that reward: its campaign does not reward a custom event, it was already rewarded, or it has expired.");
  return reward;
}

/** A person looks at a flagged referral and decides. */
export async function reviewAttribution(adminId: string, attributionId: string, decision: "clear" | "reject", noteRaw: string) {
  await adminOnly(adminId);
  const note = z.string().trim().min(5, "Write what you found").max(500).parse(noteRaw);
  return withPlatformAdmin(adminId, async (tx) => {
    const a = await tx.referralAttribution.findUnique({ where: { id: attributionId } });
    if (!a) throw new Error("Referral not found");
    if (a.reviewState !== "FLAGGED") throw new Error("This referral is not waiting for a check");
    const admin = await tx.user.findUniqueOrThrow({ where: { id: adminId }, select: { name: true } });
    const policyIds = (await tx.rewardPolicy.findMany({ where: { campaignId: a.campaignId }, select: { id: true } })).map((p) => p.id);
    const candidates = await tx.reward.findMany({ where: { userId: a.referrerId, status: "UNDER_REVIEW", policyId: { in: policyIds } } });
    const held = [];
    for (const r of candidates) {
      if ((r.sourceType === "attribution" || r.sourceType === "attribution_custom") && r.sourceId === a.id) held.push(r);
      else if (a.referredCompanyId && r.sourceType === "listing" && (await tx.listing.findUnique({ where: { id: r.sourceId }, select: { companyId: true } }))?.companyId === a.referredCompanyId) held.push(r);
      else if (a.referredCompanyId && r.sourceType === "subscription" && (await tx.subscription.findUnique({ where: { id: r.sourceId }, select: { ownerCompanyId: true } }))?.ownerCompanyId === a.referredCompanyId) held.push(r);
    }
    if (decision === "clear") {
      await tx.referralAttribution.update({ where: { id: a.id }, data: { reviewState: "CLEARED", reviewNote: note, reviewedById: adminId } });
      for (const r of held) await moveReward(tx, r, "ELIGIBLE", { id: adminId, name: admin.name }, `Checked and cleared: ${note}`);
    } else {
      await tx.referralAttribution.update({ where: { id: a.id }, data: { reviewState: "CONFIRMED_ABUSE", reviewNote: note, reviewedById: adminId, status: "REJECTED", rejectReason: note } });
      for (const r of held) await moveReward(tx, r, "REJECTED", { id: adminId, name: admin.name }, note);
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "referral", entityId: a.id, action: `referral.${decision}`, detail: { note } });
  });
}

// ---------- Reading ----------

export const REFERRAL_PAGE = 10;

export async function myReferrals(userId: string, page = 1) {
  const code = await getOrCreateCode(userId);
  return withUser(userId, async (tx) => {
    const [rows, groups, campaigns] = await Promise.all([
      tx.referralAttribution.findMany({ where: { referrerId: userId }, orderBy: { registeredAt: "desc" }, skip: (page - 1) * REFERRAL_PAGE, take: REFERRAL_PAGE + 1 }),
      tx.referralAttribution.groupBy({ by: ["status"], where: { referrerId: userId }, _count: { _all: true } }),
      tx.referralCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const now = new Date();
    const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return {
      code: code.code, clicks: code.clicks, total, counts,
      conversion: total ? Math.round(((counts.QUALIFIED ?? 0) / total) * 100) : 0,
      items: rows.slice(0, REFERRAL_PAGE).map((a) => {
        const c = byId.get(a.campaignId);
        const signals = a.signals ? a.signals.split(",") : [];
        const why = a.status === "REJECTED" ? a.rejectReason || "Not accepted after a check." : a.status === "EXPIRED" ? a.rejectReason : a.status === "QUALIFIED" ? "The condition was met." : c ? `Waiting for: ${c.event.replace(/_/g, " ").toLowerCase()}, within ${c.qualifyWithinDays} days of sign-up.` : "";
        return { id: a.id, ref: a.ref, who: maskName(a.referredName), status: a.status, registeredAt: a.registeredAt, campaign: c?.name ?? "Campaign", event: c?.event ?? "", why, underCheck: a.reviewState === "FLAGGED" && !!signals.length, opensUntil: c && c.endsOn ? c.endsOn : null, stillOpen: c ? a.status === "REGISTERED" && qualifyingOpen(a.registeredAt, c.qualifyWithinDays, now) : false };
      }),
      more: rows.length > REFERRAL_PAGE,
    };
  });
}

export async function adminReferrals(adminId: string, state: "FLAGGED" | "ALL" = "FLAGGED", page = 1) {
  await adminOnly(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const where = state === "FLAGGED" ? { reviewState: "FLAGGED" as const } : {};
    const rows = await tx.referralAttribution.findMany({ where, orderBy: { registeredAt: "desc" }, skip: (page - 1) * REFERRAL_PAGE, take: REFERRAL_PAGE + 1 });
    const users = await tx.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.referrerId, r.referredUserId]) } }, select: { id: true, name: true, email: true } });
    const u = new Map(users.map((x) => [x.id, x]));
    const [byStatus, byReview, codes, campaigns, rewards] = await Promise.all([
      tx.referralAttribution.groupBy({ by: ["status"], _count: { _all: true } }),
      tx.referralAttribution.groupBy({ by: ["reviewState"], _count: { _all: true } }),
      tx.referralCode.aggregate({ _sum: { clicks: true }, _count: { _all: true } }),
      tx.referralCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      tx.reward.groupBy({ by: ["status"], where: { programme: "REFERRAL" }, _count: { _all: true }, _sum: { amountKobo: true } }),
    ]);
    const perCampaign = await tx.referralAttribution.groupBy({ by: ["campaignId", "status"], _count: { _all: true } });
    return {
      items: rows.slice(0, REFERRAL_PAGE).map((a) => ({ ...a, referrerName: u.get(a.referrerId)?.name ?? "", referrerEmail: u.get(a.referrerId)?.email ?? "", referredEmail: u.get(a.referredUserId)?.email ?? "", signalText: (a.signals ? a.signals.split(",") : []).map((s) => SIGNAL_TEXT[s] ?? s) })),
      more: rows.length > REFERRAL_PAGE,
      stats: { byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])), byReview: Object.fromEntries(byReview.map((s) => [s.reviewState, s._count._all])), clicks: codes._sum.clicks ?? 0, codes: codes._count._all, rewards: rewards.map((r) => ({ status: r.status, count: r._count._all, kobo: r._sum.amountKobo ?? 0n })) },
      campaigns: campaigns.map((c) => ({ ...c, registered: perCampaign.filter((p) => p.campaignId === c.id).reduce((s, p) => s + p._count._all, 0), qualified: perCampaign.find((p) => p.campaignId === c.id && p.status === "QUALIFIED")?._count._all ?? 0 })),
    };
  });
}
export { SYSTEM };
