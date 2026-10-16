import { lagosDay } from "./notification-rules";
import type { Access } from "./subscription-rules";

// Advertising rules: pure, so they can be tested without a database. A campaign promotes one published property in one place on
// the site, for a budget paid in advance, between two dates. The advertiser pays only for clicks that are real and new.

export type Placement = "HOME_FEATURED" | "SEARCH_TOP";
export const PLACEMENTS: Record<Placement, { label: string; slots: number; where: string }> = {
  HOME_FEATURED: { label: "Home page, featured", slots: 3, where: "above the latest listings on the home page" },
  SEARCH_TOP: { label: "Top of search results", slots: 2, where: "above the results of a search that matches the property" },
};
export const PLACEMENT_KEYS = Object.keys(PLACEMENTS) as Placement[];

export interface AdConfig { cpcKobo: Record<Placement, number>; minBudgetKobo: number; maxBudgetKobo: number; maxDays: number }
export const DEFAULT_AD_CONFIG: AdConfig = { cpcKobo: { HOME_FEATURED: 15_000, SEARCH_TOP: 10_000 }, minBudgetKobo: 500_000, maxBudgetKobo: 500_000_000, maxDays: 90 };

export function adConfigProblem(c: AdConfig): string | null {
  for (const p of PLACEMENT_KEYS) if (!Number.isInteger(c.cpcKobo[p]) || c.cpcKobo[p] < 100 || c.cpcKobo[p] > 10_000_000) return `The price of a click for "${PLACEMENTS[p].label}" must be between ₦1 and ₦100,000`;
  if (!Number.isInteger(c.minBudgetKobo) || c.minBudgetKobo < 10_000) return "The smallest budget must be at least ₦100";
  if (!Number.isInteger(c.maxBudgetKobo) || c.maxBudgetKobo < c.minBudgetKobo || c.maxBudgetKobo > 500_000_000) return "The largest budget must be at least the smallest, and at most ₦5,000,000";
  if (!Number.isInteger(c.maxDays) || c.maxDays < 1 || c.maxDays > 365) return "A campaign can run for 1 to 365 days";
  return null;
}

export interface CampaignInput { startsOn: string; endsOn: string; budgetKobo: bigint; dailyCapKobo: bigint | null; headline: string }

const DAY = 864e5;
const parseDay = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Why a campaign as typed cannot be accepted, or null. `today` is the date in Lagos as YYYY-MM-DD. */
export function campaignProblem(i: CampaignInput, cfg: AdConfig, cpcKobo: number, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startsOn) || Number.isNaN(parseDay(i.startsOn).getTime())) return "Enter a start date";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.endsOn) || Number.isNaN(parseDay(i.endsOn).getTime())) return "Enter an end date";
  if (i.startsOn < today) return "A campaign cannot start in the past";
  if (i.endsOn < i.startsOn) return "A campaign cannot end before it starts";
  const days = Math.round((parseDay(i.endsOn).getTime() - parseDay(i.startsOn).getTime()) / DAY) + 1;
  if (days > cfg.maxDays) return `A campaign can run for at most ${cfg.maxDays} days`;
  if (i.budgetKobo < BigInt(cfg.minBudgetKobo)) return `The budget must be at least ₦${(cfg.minBudgetKobo / 100).toLocaleString("en-NG")}`;
  if (i.budgetKobo > BigInt(cfg.maxBudgetKobo)) return `The budget can be at most ₦${(cfg.maxBudgetKobo / 100).toLocaleString("en-NG")}`;
  if (i.budgetKobo < BigInt(cpcKobo)) return "The budget must cover at least one click";
  if (i.dailyCapKobo !== null && (i.dailyCapKobo < BigInt(cpcKobo) || i.dailyCapKobo > i.budgetKobo)) return "The daily limit must cover at least one click and cannot be more than the budget";
  const h = i.headline.trim();
  if (h.length > 60) return "A headline is at most 60 characters";
  // Contact details and links belong on the property page, where they are checked; an advert is not a way around that.
  if (/https?:\/\/|www\.|@|\d{7,}/i.test(h)) return "A headline cannot hold links, email addresses or phone numbers";
  return null;
}

export type AdStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "PAUSED" | "SUSPENDED" | "ENDED";
export interface CampaignFacts { status: AdStatus; startsOn: Date; endsOn: Date; fundedKobo: bigint; spentKobo: bigint; budgetKobo: bigint; cpcKobo: bigint }

export type Phase = "NOT_SUBMITTED" | "IN_REVIEW" | "REJECTED" | "WAITING_FOR_PAYMENT" | "SCHEDULED" | "LIVE" | "PAUSED" | "SUSPENDED" | "ENDED";

/** Where a campaign stands. It is live only when it is approved, fully paid, inside its dates, and has budget for another click. */
export function phaseOf(c: CampaignFacts, now: Date): Phase {
  if (c.status === "DRAFT") return "NOT_SUBMITTED";
  if (c.status === "PENDING_REVIEW") return "IN_REVIEW";
  if (c.status === "REJECTED") return "REJECTED";
  if (c.status === "PAUSED") return "PAUSED";
  if (c.status === "SUSPENDED") return "SUSPENDED";
  if (c.status === "ENDED") return "ENDED";
  const today = lagosDay(now);
  if (today > lagosDay(c.endsOn)) return "ENDED";
  if (c.fundedKobo < c.budgetKobo) return "WAITING_FOR_PAYMENT";
  if (today < lagosDay(c.startsOn)) return "SCHEDULED";
  if (c.fundedKobo - c.spentKobo < c.cpcKobo) return "ENDED";
  return "LIVE";
}
export const isLive = (c: CampaignFacts, now: Date) => phaseOf(c, now) === "LIVE";

export const PHASE_TEXT: Record<Phase, string> = {
  NOT_SUBMITTED: "Not sent for review", IN_REVIEW: "Waiting for review", REJECTED: "Not approved", WAITING_FOR_PAYMENT: "Approved, waiting for payment", SCHEDULED: "Paid, starts on its start date",
  LIVE: "Running", PAUSED: "Paused", SUSPENDED: "Suspended", ENDED: "Ended",
};

export interface Conditions { listingPublished: boolean; access: Access }
/** The defined reasons a running campaign is stopped automatically. Null means it may run. */
export function suspensionReason(c: Conditions): string | null {
  if (!c.listingPublished) return "The property is no longer published, so there is nothing to advertise.";
  if (c.access !== "FULL") return "The plan that allows advertising has run out. Renew it and the campaign resumes.";
  return null;
}

export const BOT_PATTERN = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|python-requests|curl\/|wget|monitor|uptime/i;
export const isBot = (ua: string | null | undefined) => !ua || BOT_PATTERN.test(ua);

export type ClickVerdict = { bill: true } | { bill: false; reason: "NOT_LIVE" | "BOT" | "OWN" | "REPEAT" | "DAILY_LIMIT" | "NO_BUDGET" };

/** Whether one click is paid for. Only a real person, who is not the advertiser, who has not already clicked this advert today, while it is live and within its limits. */
export function judgeClick(o: { live: boolean; bot: boolean; own: boolean; repeat: boolean; cpcKobo: bigint; remainingKobo: bigint; spentTodayKobo: bigint; dailyCapKobo: bigint | null }): ClickVerdict {
  if (!o.live) return { bill: false, reason: "NOT_LIVE" };
  if (o.bot) return { bill: false, reason: "BOT" };
  if (o.own) return { bill: false, reason: "OWN" };
  if (o.repeat) return { bill: false, reason: "REPEAT" };
  if (o.remainingKobo < o.cpcKobo) return { bill: false, reason: "NO_BUDGET" };
  if (o.dailyCapKobo !== null && o.spentTodayKobo + o.cpcKobo > o.dailyCapKobo) return { bill: false, reason: "DAILY_LIMIT" };
  return { bill: true };
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
export const ctr = (impressions: number, clicks: number) => pct(clicks, impressions);
export const costPer = (spentKobo: bigint, n: number): bigint | null => (n > 0 ? spentKobo / BigInt(n) : null);

/** Pick who is shown. Adverts that have been shown least today go first, so a small budget is not crowded out; ties are broken by a daily seed. */
export function pickServed<T extends { id: string; shownToday: number }>(candidates: T[], slots: number, seed: string): T[] {
  const h = (s: string) => { let x = 2166136261; for (const ch of `${seed}|${s}`) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
  return [...candidates].sort((a, b) => a.shownToday - b.shownToday || h(a.id) - h(b.id)).slice(0, slots);
}
