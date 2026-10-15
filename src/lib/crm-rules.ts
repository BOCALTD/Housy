// Pure rules for the CRM (master prompt Phase 8). No database access here, so they can be tested alone.

export const CLIENT_KINDS = ["INDIVIDUAL", "ORGANISATION"] as const;
export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"] as const;
export const ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "MEETING", "WHATSAPP", "FOLLOW_UP"] as const;
export const TIMELINES = ["UNKNOWN", "IMMEDIATE", "WITHIN_3_MONTHS", "WITHIN_6_MONTHS", "LATER"] as const;
export const FINANCING = ["UNKNOWN", "CASH", "MORTGAGE_APPROVED", "MORTGAGE_PENDING"] as const;
export const MATCH_STATUSES = ["SUGGESTED", "SENT", "INTERESTED", "REJECTED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Digits only, in Nigerian international form where that is clear: 0803... and +234803... both become 234803... */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("234") && digits.length >= 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  if (digits.length === 10 && /^[789]/.test(digits)) return `234${digits}`;
  return digits;
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normaliseName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(mr|mrs|ms|miss|dr|chief|engr|alhaji|alhaja|prof|ltd|limited|plc)\b/g, " ").replace(/\s+/g, " ").trim();
}

export interface ClientKeys { id?: string; name: string; emailNorm: string; phoneNorm: string; city: string }

/** Why two client records may be the same person or organisation. An empty list means no match. */
export function duplicateReasons(a: ClientKeys, b: ClientKeys): string[] {
  const out: string[] = [];
  if (a.emailNorm && a.emailNorm === b.emailNorm) out.push("same email address");
  if (a.phoneNorm && a.phoneNorm === b.phoneNorm) out.push("same phone number");
  const na = normaliseName(a.name);
  const nb = normaliseName(b.name);
  if (na.length >= 4 && na === nb && (!a.city || !b.city || a.city.trim().toLowerCase() === b.city.trim().toLowerCase())) out.push("same name");
  return out;
}

export interface Qualification {
  budgetMaxKobo: bigint | null;
  timeline: string;
  financing: string;
  decisionMaker: boolean;
  hasContact: boolean;
}

/** A 0 to 100 score from what has been established. It helps people sort their follow-up; it never decides anything. */
export function qualificationScore(q: Qualification): number {
  let s = 0;
  if (q.budgetMaxKobo !== null && q.budgetMaxKobo > 0n) s += 25;
  s += ({ IMMEDIATE: 30, WITHIN_3_MONTHS: 20, WITHIN_6_MONTHS: 10, LATER: 0, UNKNOWN: 0 } as Record<string, number>)[q.timeline] ?? 0;
  s += ({ CASH: 20, MORTGAGE_APPROVED: 20, MORTGAGE_PENDING: 10, UNKNOWN: 0 } as Record<string, number>)[q.financing] ?? 0;
  if (q.decisionMaker) s += 15;
  if (q.hasContact) s += 10;
  return s;
}

/** What must be known before a lead can be called qualified. */
export function qualificationProblem(q: Qualification): string | null {
  if (q.budgetMaxKobo === null || q.budgetMaxKobo <= 0n) return "Record the client's budget before qualifying the lead";
  if (q.timeline === "UNKNOWN") return "Record when the client wants to move before qualifying the lead";
  if (!q.hasContact) return "The client needs a phone number or email address";
  return null;
}

const NEXT: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["CONTACTED", "QUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "LOST"],
  QUALIFIED: ["CONVERTED", "LOST", "CONTACTED"],
  CONVERTED: [],
  LOST: ["CONTACTED"],
};
export function leadTransitionProblem(from: LeadStatus, to: LeadStatus): string | null {
  if (from === to) return "The lead is already at that stage";
  if (!NEXT[from].includes(to)) return `A lead that is ${from.toLowerCase()} cannot move to ${to.toLowerCase()}`;
  return null;
}

export interface Need {
  purpose: string; city: string; state: string; assetClass: string; bedroomsMin: number | null; budgetMinKobo: bigint | null; budgetMaxKobo: bigint;
}
export interface Offering { purpose: string; city: string; state: string; priceKobo: bigint; bedrooms: number | null; assetClass: string }

/**
 * How well a published listing fits a client's stated need. The purpose must be the same and the price must not be above the
 * budget; anything else is scored. Returns null when the listing does not qualify at all.
 */
export function matchScore(n: Need, o: Offering): { score: number; reasons: string[] } | null {
  if (n.purpose !== o.purpose) return null;
  if (o.priceKobo > n.budgetMaxKobo) return null;
  if (n.budgetMinKobo !== null && o.priceKobo < n.budgetMinKobo) return null;
  if (n.bedroomsMin !== null && (o.bedrooms === null || o.bedrooms < n.bedroomsMin)) return null;
  const reasons: string[] = ["within budget"];
  let score = 30;
  const sameCity = n.city.trim() !== "" && n.city.trim().toLowerCase() === o.city.trim().toLowerCase();
  const sameState = n.state.trim() !== "" && n.state.trim().toLowerCase() === o.state.trim().toLowerCase();
  if (sameCity) { score += 40; reasons.push("same city"); } else if (sameState) { score += 15; reasons.push("same state"); } else if (n.city.trim() !== "" || n.state.trim() !== "") return null;
  if (n.bedroomsMin !== null) { score += 15; reasons.push("enough bedrooms"); }
  if (n.assetClass && n.assetClass === o.assetClass) { score += 15; reasons.push("same type of property"); }
  return { score: Math.min(score, 100), reasons };
}
