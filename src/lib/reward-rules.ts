// Pure rules for rewards and referrals. No database here, so they can be tested exhaustively.

export const REWARD_STATUSES = ["NOT_ELIGIBLE", "UNDER_REVIEW", "ELIGIBLE", "APPROVED", "PAYABLE", "PAID", "REJECTED", "CANCELLED", "DISPUTED"] as const;
export type RewardStatusName = (typeof REWARD_STATUSES)[number];

/** Where a reward may go next. PAID, CANCELLED and NOT_ELIGIBLE-after-dispute are the ends of the road. */
export const REWARD_TRANSITIONS: Record<RewardStatusName, RewardStatusName[]> = {
  NOT_ELIGIBLE: ["DISPUTED"],
  UNDER_REVIEW: ["ELIGIBLE", "REJECTED", "NOT_ELIGIBLE"],
  ELIGIBLE: ["APPROVED", "REJECTED", "UNDER_REVIEW"],
  APPROVED: ["PAYABLE", "CANCELLED"],
  PAYABLE: ["PAID", "CANCELLED"],
  PAID: [],
  REJECTED: ["DISPUTED"],
  CANCELLED: [],
  DISPUTED: ["ELIGIBLE", "REJECTED"],
};

export function rewardMoveProblem(from: RewardStatusName, to: RewardStatusName): string | null {
  if (REWARD_TRANSITIONS[from].includes(to)) return null;
  if (from === "PAID") return "A paid reward cannot be changed";
  return `A reward that is ${label(from)} cannot become ${label(to)}`;
}
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

/** What the person sees in plain words, with what happens next. */
export function rewardExplainer(status: RewardStatusName, o: { payableAt?: Date | null; reason?: string } = {}): string {
  switch (status) {
    case "NOT_ELIGIBLE": return o.reason || "This did not qualify for a reward.";
    case "UNDER_REVIEW": return "A person at the platform is checking this before it can be approved.";
    case "ELIGIBLE": return "It qualified. It now waits for approval.";
    case "APPROVED": return `Approved. It becomes payable after a short safety period${o.payableAt ? `, on ${o.payableAt.toISOString().slice(0, 10)}` : ""}, in case the activity is reversed.`;
    case "PAYABLE": return "Payable. It will be included in the next payout.";
    case "PAID": return "Paid, and the payment was checked by a second person.";
    case "REJECTED": return o.reason || "Not approved.";
    case "CANCELLED": return o.reason || "Cancelled.";
    case "DISPUTED": return "You asked for a second look. We will answer in writing.";
  }
}

// ---------- Months, windows ----------

/** The month a date falls in, in Lagos: "2026-10". */
export function monthKey(d: Date): string {
  const lagos = new Date(d.getTime() + 3600_000);
  return `${lagos.getUTCFullYear()}-${String(lagos.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1) - 3600_000), end: new Date(Date.UTC(y, m, 1) - 3600_000) };
}
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 864e5);
export const payableAt = (approvedAt: Date, holdDays: number) => addDays(approvedAt, holdDays);

export interface CampaignWindow { startsOn: Date; endsOn: Date | null; active: boolean }
/** A campaign accepts new sign-ups from its start date to the end of its end date. */
export function campaignOpen(c: CampaignWindow, now: Date): boolean {
  if (!c.active || now.getTime() < c.startsOn.getTime()) return false;
  return c.endsOn === null || now.getTime() < c.endsOn.getTime() + 864e5;
}
/** The link was followed recently enough for the sign-up to count. */
export function attributionOpen(clickedAt: number, days: number, now: Date): boolean {
  return Number.isFinite(clickedAt) && clickedAt <= now.getTime() + 60_000 && now.getTime() - clickedAt <= days * 864e5;
}
export function qualifyingOpen(registeredAt: Date, days: number, now: Date): boolean {
  return now.getTime() <= addDays(registeredAt, days).getTime();
}

// ---------- Suspicious activity ----------
// A signal is a reason for a person to look. It is never, on its own, a verdict.

export const SIGNAL_TEXT: Record<string, string> = {
  SAME_EMAIL_ROOT: "The sign-up email is the same mailbox as the referrer's, apart from dots or a plus tag.",
  SAME_NAME: "The sign-up name matches the referrer's name.",
  BURST: "The referrer has had an unusual number of sign-ups in one day.",
  NEW_REFERRER: "The referrer's account was created only minutes before this sign-up.",
  SAME_PHOTO: "A photograph in this report was used in a different report.",
  REPEAT_REJECTIONS: "This person has had several reports rejected recently.",
  REPORT_BURST: "This person submitted an unusual number of reports in one day.",
  OUTSIDE_COVERAGE: "The map position is outside Nigeria.",
  SAME_TEXT: "The description is word for word the same as another report.",
};

/** The mailbox behind an address: lower case, no +tag, and no dots for the providers that ignore them. */
export function normaliseEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  const dotless = domain === "gmail.com" || domain === "googlemail.com" ? base.replace(/\./g, "") : base;
  return `${dotless}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

export interface ReferralFacts {
  referrer: { email: string; name: string; createdAt: Date };
  referred: { email: string; name: string };
  referrerSignupsLast24h: number;
  burstLimit: number;
  now: Date;
}
export function referralSignals(f: ReferralFacts): string[] {
  const out: string[] = [];
  if (normaliseEmail(f.referrer.email) === normaliseEmail(f.referred.email)) out.push("SAME_EMAIL_ROOT");
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  if (n(f.referrer.name) === n(f.referred.name)) out.push("SAME_NAME");
  if (f.referrerSignupsLast24h >= f.burstLimit) out.push("BURST");
  if (f.now.getTime() - f.referrer.createdAt.getTime() < 3600_000) out.push("NEW_REFERRER");
  return out;
}

/** "Tunde Okafor" becomes "T*** O.", so a referrer can tell their referrals apart without learning more than they were told. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  const first = `${parts[0][0]?.toUpperCase() ?? ""}***`;
  return parts.length === 1 ? first : `${first} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Does a referral code look like one we issue? Letters and digits without the easily confused ones. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const isCodeShape = (s: string) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(s);
