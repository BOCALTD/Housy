import { createHash } from "node:crypto";

// Pure rules for reviews and reputation. Nothing here knows about advertising, plan levels or promotions: those cannot move a score
// because they are not inputs. The facts a score is worked from are stored with it so anyone can recompute it.

export const FORMULA_VERSION = 1;
export type Basis = "ENQUIRY" | "INSPECTION" | "TRANSACTION";
export const BASIS_LABEL: Record<Basis, string> = { ENQUIRY: "Verified enquiry", INSPECTION: "Verified viewing", TRANSACTION: "Verified transaction" };
export const BASIS_WEIGHT: Record<Basis, number> = { TRANSACTION: 1, INSPECTION: 0.8, ENQUIRY: 0.5 };
export const CATEGORIES = [
  { key: "communication", label: "Communication" }, { key: "professionalism", label: "Professionalism" }, { key: "accuracy", label: "Listing accuracy" },
  { key: "responsiveness", label: "Responsiveness" }, { key: "serviceQuality", label: "Service quality" }, { key: "handling", label: "Transaction handling" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const PRIOR_MEAN = 3.5;
export const PRIOR_WEIGHT = 3;
export const HALF_LIFE_DAYS = 180;

export interface ReviewFact { o: number; b: Basis; d: string; l: number; a?: number | null }
export interface ReputationInputs {
  asOf: string;
  reviews: ReviewFact[];
  conversations: number;
  repliedWithin24h: number;
  completedDeals: number;
  upheldComplaints: number;
}
export type BadgeKey = "HIGHLY_RATED" | "TOP_RATED" | "TRUSTED" | "FAST_RESPONDER" | "EXPERIENCED" | "RISING";
export const BADGES: Record<BadgeKey, { label: string; how: string }> = {
  HIGHLY_RATED: { label: "Highly Rated", how: "At least 5 verified reviews with a strong, evidence-weighted average." },
  TOP_RATED: { label: "Top Rated", how: "At least 15 verified reviews, an excellent average and no upheld complaints." },
  TRUSTED: { label: "Trusted", how: "At least 3 reviews from completed transactions, a good average and no upheld complaints." },
  FAST_RESPONDER: { label: "Fast Responder", how: "Replies to at least 80% of new conversations within a day." },
  EXPERIENCED: { label: "Experienced", how: "Ten or more completed deals recorded on the platform." },
  RISING: { label: "Rising", how: "Three or more strong reviews in the last 90 days from someone still building a record." },
};
export interface Reputation { score: number; reviewCount: number; average: number; weightedAverage: number; components: Record<string, number>; badges: BadgeKey[] }

const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`).getTime();
const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeReputation(i: ReputationInputs): Reputation {
  const asOf = day(i.asOf);
  let wSum = 0, woSum = 0, plain = 0;
  for (const r of i.reviews) {
    const age = Math.max(0, (asOf - day(r.d)) / 864e5);
    const w = BASIS_WEIGHT[r.b] * Math.pow(0.5, age / HALF_LIFE_DAYS) * (r.l >= 40 ? 1 : 0.8);
    wSum += w; woSum += w * r.o; plain += r.o;
  }
  const n = i.reviews.length;
  const bayes = (PRIOR_WEIGHT * PRIOR_MEAN + woSum) / (PRIOR_WEIGHT + wSum);
  const reviewScore = ((bayes - 1) / 4) * 100;
  const rate = i.conversations >= 5 ? i.repliedWithin24h / i.conversations : null;
  const response = rate === null ? 50 : rate * 100;
  const experience = Math.min(100, (Math.log2(1 + i.completedDeals) / Math.log2(26)) * 100);
  const penalty = Math.min(30, 10 * i.upheldComplaints);
  const score = Math.max(0, Math.min(100, Math.round(0.65 * reviewScore + 0.2 * response + 0.15 * experience - penalty)));

  const badges: BadgeKey[] = [];
  const transactions = i.reviews.filter((r) => r.b === "TRANSACTION").length;
  const recent = i.reviews.filter((r) => (asOf - day(r.d)) / 864e5 <= 90);
  const recentAvg = recent.length ? recent.reduce((a, r) => a + r.o, 0) / recent.length : 0;
  if (n >= 5 && bayes >= 4.3) badges.push("HIGHLY_RATED");
  if (n >= 15 && bayes >= 4.6 && i.upheldComplaints === 0) badges.push("TOP_RATED");
  if (transactions >= 3 && i.upheldComplaints === 0 && bayes >= 4) badges.push("TRUSTED");
  if (i.conversations >= 10 && rate !== null && rate >= 0.8) badges.push("FAST_RESPONDER");
  if (i.completedDeals >= 10) badges.push("EXPERIENCED");
  if (recent.length >= 3 && recentAvg >= 4.5 && i.completedDeals < 10) badges.push("RISING");
  return {
    score, reviewCount: n, average: n ? r1(plain / n) : 0, weightedAverage: r1(bayes),
    components: { reviews: Math.round(reviewScore), responsiveness: Math.round(response), experience: Math.round(experience), complaintPenalty: penalty },
    badges,
  };
}

export const inputsHash = (i: ReputationInputs): string => createHash("sha256").update(JSON.stringify({ ...i, reviews: [...i.reviews].sort((a, b) => (a.d + a.o + a.b + a.l).localeCompare(b.d + b.o + b.b + b.l)) })).digest("hex");

// ---------- Manipulation signals ----------

export interface SignalFacts {
  reviewerAgeHours: number;
  referredByTarget: boolean;
  reviewsForTargetLast48h: number;
  reviewerReviewsLast24h: number;
  sameTextElsewhere: boolean;
}
export const SIGNAL_TEXT: Record<string, string> = {
  NEW_ACCOUNT: "The reviewer's account is less than an hour old.",
  REFERRED_BY_TARGET: "The reviewer joined through the reviewed agent's own referral link.",
  BURST: "Several reviews arrived for the same person within two days.",
  REVIEW_SPREE: "The reviewer posted several reviews in one day.",
  DUPLICATE_TEXT: "The same wording appears in another review of this person, or from this reviewer.",
};
export function reviewSignals(f: SignalFacts): string[] {
  const out: string[] = [];
  if (f.reviewerAgeHours < 1) out.push("NEW_ACCOUNT");
  if (f.referredByTarget) out.push("REFERRED_BY_TARGET");
  if (f.reviewsForTargetLast48h >= 3) out.push("BURST");
  if (f.reviewerReviewsLast24h >= 3) out.push("REVIEW_SPREE");
  if (f.sameTextElsewhere) out.push("DUPLICATE_TEXT");
  return out;
}
export const normaliseText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const textHash = (s: string): string => { const n = normaliseText(s); return n.length < 15 ? "" : createHash("sha256").update(n).digest("hex"); };

/** The only moves a review can make. A review that is hidden or removed no longer counts; a held one waits for a person. */
export const COUNTS: Record<string, boolean> = { PUBLISHED: true, HELD: false, HIDDEN: false, REMOVED: false };
