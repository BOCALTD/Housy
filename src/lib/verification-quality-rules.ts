/**
 * Verification network, stage 8: quality. Credentials that expire, complaints about providers, and the performance
 * indicators Housy and each provider see. Pure rules, used by the services and tested on their own.
 */

/** Documents whose expiry matters: an organisation with none current of a kind it has filed cannot take cases. */
export const EXPIRING_KINDS = ["LICENCE", "CERTIFICATE"] as const;
export const EXPIRY_WARNING_DAYS = 30;

type Doc = { kind: string; expiresOn: Date | null };
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Kinds the organisation has filed but holds no current document of (every one of them has passed its expiry date). */
export function expiredKinds(docs: Doc[], today: Date): string[] {
  const t = dayOf(today);
  return EXPIRING_KINDS.filter((k) => {
    const mine = docs.filter((d) => d.kind === k);
    return mine.length > 0 && mine.every((d) => d.expiresOn !== null && dayOf(d.expiresOn) < t);
  });
}

/** valid, expiring (within the warning window) or expired, for one document. */
export function credentialState(expiresOn: Date | null, today: Date): "valid" | "expiring" | "expired" | "none" {
  if (!expiresOn) return "none";
  const t = dayOf(today), e = dayOf(expiresOn);
  if (e < t) return "expired";
  const warn = dayOf(new Date(today.getTime() + EXPIRY_WARNING_DAYS * 86_400_000));
  return e <= warn ? "expiring" : "valid";
}

// ---------- Complaints ----------

export const COMPLAINT_CATEGORIES = [
  ["CONDUCT", "Conduct of the provider's staff"],
  ["DELAY", "Delay or missed dates"],
  ["QUALITY", "Quality of the work or report"],
  ["COMMUNICATION", "Communication"],
  ["CONFIDENTIALITY", "Confidentiality or misuse of information"],
  ["FRAUD", "Suspected fraud or dishonesty"],
  ["OTHER", "Something else"],
] as const;
export const COMPLAINT_CODES = COMPLAINT_CATEGORIES.map((c) => c[0]);

export const COMPLAINT_STATUSES = ["OPEN", "INVESTIGATING", "UPHELD", "NOT_UPHELD", "WITHDRAWN"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_WORDS: Record<ComplaintStatus, string> = { OPEN: "Received", INVESTIGATING: "Being looked into", UPHELD: "Upheld", NOT_UPHELD: "Not upheld", WITHDRAWN: "Withdrawn" };
export const COMPLAINT_MOVES: [ComplaintStatus, ComplaintStatus][] = [
  ["OPEN", "INVESTIGATING"], ["OPEN", "UPHELD"], ["OPEN", "NOT_UPHELD"], ["OPEN", "WITHDRAWN"],
  ["INVESTIGATING", "UPHELD"], ["INVESTIGATING", "NOT_UPHELD"], ["INVESTIGATING", "WITHDRAWN"],
];
export const canMoveComplaint = (a: ComplaintStatus, b: ComplaintStatus) => COMPLAINT_MOVES.some(([x, y]) => x === a && y === b);
export const complaintRef = (year: number, n: number) => `HVC-${year}-${String(n).padStart(6, "0")}`;

// ---------- Performance ----------

export type CaseRecord = {
  offeredAt: Date; answer: "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN" | "OFFERED"; answeredAt: Date | null;
  acceptedAt: Date | null; deliveredAt: Date | null; requiredBy: Date | null; housyCorrections: number; disputed: boolean;
  disputeReopened: boolean; revoked: boolean; rating: number | null;
};

export type Kpis = {
  offered: number; accepted: number; declined: number; expired: number; acceptanceRate: number | null; medianHoursToAnswer: number | null;
  delivered: number; onTimeRate: number | null; medianDaysToDeliver: number | null; correctionRate: number | null;
  disputes: number; disputesUpheld: number; revoked: number; averageRating: number | null; ratings: number;
  complaints: number; complaintsUpheld: number; flags: string[];
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Indicators from a provider's case records and complaints. Rates are percentages to one decimal; a rate is null until there
 * is something to measure. Flags are raised only on enough cases to be fair (5 delivered, 5 offered).
 */
export function providerKpis(records: CaseRecord[], complaints: { status: string }[]): Kpis {
  const answered = records.filter((r) => r.answer !== "OFFERED" && r.answer !== "WITHDRAWN");
  const accepted = records.filter((r) => r.answer === "ACCEPTED");
  const delivered = accepted.filter((r) => r.deliveredAt);
  const onTime = delivered.filter((r) => !r.requiredBy || r.deliveredAt! <= r.requiredBy);
  const ratings = records.map((r) => r.rating).filter((x): x is number => x !== null);
  const k: Kpis = {
    offered: answered.length,
    accepted: accepted.length,
    declined: records.filter((r) => r.answer === "DECLINED").length,
    expired: records.filter((r) => r.answer === "EXPIRED").length,
    acceptanceRate: rate(accepted.length, answered.length),
    medianHoursToAnswer: median(answered.filter((r) => r.answeredAt).map((r) => Math.round(((r.answeredAt!.getTime() - r.offeredAt.getTime()) / 3_600_000) * 10) / 10)),
    delivered: delivered.length,
    onTimeRate: rate(onTime.length, delivered.length),
    medianDaysToDeliver: median(delivered.filter((r) => r.acceptedAt).map((r) => Math.round(((r.deliveredAt!.getTime() - r.acceptedAt!.getTime()) / 86_400_000) * 10) / 10)),
    correctionRate: rate(delivered.filter((r) => r.housyCorrections > 0).length, delivered.length),
    disputes: records.filter((r) => r.disputed).length,
    disputesUpheld: records.filter((r) => r.disputeReopened).length,
    revoked: records.filter((r) => r.revoked).length,
    averageRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    ratings: ratings.length,
    complaints: complaints.length,
    complaintsUpheld: complaints.filter((c) => c.status === "UPHELD").length,
    flags: [],
  };
  if (k.delivered >= 5 && (k.onTimeRate ?? 100) < 70) k.flags.push("Fewer than 70% of reports delivered on time");
  if (k.offered >= 5 && (k.acceptanceRate ?? 100) < 50) k.flags.push("Declines or lets expire more than half of the cases offered");
  if (k.delivered >= 5 && (k.correctionRate ?? 0) > 30) k.flags.push("Housy sent back more than 30% of reports for correction");
  if (k.revoked > 0) k.flags.push(`${k.revoked} report${k.revoked === 1 ? "" : "s"} revoked`);
  if (k.complaintsUpheld >= 2) k.flags.push(`${k.complaintsUpheld} complaints upheld`);
  if (k.ratings >= 5 && (k.averageRating ?? 5) < 3) k.flags.push("Average customer rating below 3 out of 5");
  return k;
}
