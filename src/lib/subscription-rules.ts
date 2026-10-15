// Pure rules for subscriptions and entitlements (master prompt Sections 27 and 41). No database access here.

/** The features a plan can allow. The platform administrator decides which plan has which; a plan never grants access to anyone's data. */
export const ENTITLEMENT_KEYS = ["COLLAB_SEEKER_AGENT", "COLLAB_COMPANY", "CONTACT_DETAILS", "BULK_MESSAGING"] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  COLLAB_SEEKER_AGENT: "Collaborate with an agent (seeker)",
  COLLAB_COMPANY: "Collaborate with another company",
  CONTACT_DETAILS: "Share phone numbers and email addresses in messages",
  BULK_MESSAGING: "Bulk messaging",
};

/** Whether a feature counts something (workspaces) or is simply on or off. */
export const COUNTED_ENTITLEMENTS: readonly EntitlementKey[] = ["COLLAB_SEEKER_AGENT", "COLLAB_COMPANY"];

export type SubscriptionState = "NONE" | "TRIAL" | "ACTIVE" | "GRACE" | "READ_ONLY" | "SUSPENDED";
export type Access = "FULL" | "READ_ONLY" | "NONE";

export interface SubLike { status: "TRIAL" | "ACTIVE" | "CANCELLED"; periodEnd: Date }
export interface PolicyLike { graceDays: number; readOnlyDays: number }

const DAY = 864e5;

/**
 * Where a subscription stands at a moment.
 *  - Until the period ends: trial or active.
 *  - A cancelled subscription stops at the end of the period it paid for and has no grace.
 *  - Otherwise, after the period ends: grace (everything still works, with a warning), then read-only (people can look but not add),
 *    then suspended (records are kept, nothing can be used). The two lengths come from the plan.
 */
export function subscriptionState(sub: SubLike | null | undefined, policy: PolicyLike | null | undefined, now: Date = new Date()): SubscriptionState {
  if (!sub || !policy) return "NONE";
  const end = sub.periodEnd.getTime();
  const t = now.getTime();
  if (t <= end) return sub.status === "TRIAL" ? "TRIAL" : "ACTIVE";
  if (sub.status === "CANCELLED") return "NONE";
  if (t <= end + policy.graceDays * DAY) return "GRACE";
  if (t <= end + (policy.graceDays + policy.readOnlyDays) * DAY) return "READ_ONLY";
  return "SUSPENDED";
}

export function accessFor(state: SubscriptionState): Access {
  if (state === "TRIAL" || state === "ACTIVE" || state === "GRACE") return "FULL";
  if (state === "READ_ONLY") return "READ_ONLY";
  return "NONE";
}

const ORDER: Access[] = ["NONE", "READ_ONLY", "FULL"];
/** When two parties each hold a subscription, the workspace follows the weaker of the two. */
export function weakest(...accesses: Access[]): Access {
  return accesses.reduce((a, b) => (ORDER.indexOf(b) < ORDER.indexOf(a) ? b : a), "FULL" as Access);
}

/** The day access changes next, for the explanation shown to the person ("what happens to my access"). */
export function nextChange(sub: SubLike, policy: PolicyLike, now: Date = new Date()): { on: Date; becomes: SubscriptionState } | null {
  const end = sub.periodEnd.getTime();
  const t = now.getTime();
  const graceEnd = end + policy.graceDays * DAY;
  const readEnd = graceEnd + policy.readOnlyDays * DAY;
  if (t <= end) return { on: new Date(end), becomes: sub.status === "CANCELLED" ? "NONE" : policy.graceDays > 0 ? "GRACE" : policy.readOnlyDays > 0 ? "READ_ONLY" : "SUSPENDED" };
  if (sub.status === "CANCELLED") return null;
  if (t <= graceEnd) return { on: new Date(graceEnd), becomes: policy.readOnlyDays > 0 ? "READ_ONLY" : "SUSPENDED" };
  if (t <= readEnd) return { on: new Date(readEnd), becomes: "SUSPENDED" };
  return null;
}

/** Plain words for the state, for pages and notices. */
export function explainState(state: SubscriptionState, subject: string): string {
  switch (state) {
    case "NONE": return `${subject} has no active subscription for this feature.`;
    case "TRIAL": return `${subject} is on a trial.`;
    case "ACTIVE": return `${subject} is active.`;
    case "GRACE": return `${subject} has expired and is in its grace period. Everything still works. Renew before the grace period ends.`;
    case "READ_ONLY": return `${subject} has expired and is read-only. People can look at their records but cannot add or change anything until it is renewed.`;
    case "SUSPENDED": return `${subject} is suspended because it was not renewed. Records are kept, and access returns when it is renewed.`;
  }
}

/** Contact details (phone numbers and email addresses) inside free text. */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)(?:\+?234|0)[\s.-]?[789][01](?:[\s.-]?\d){8}(?!\d)|(?<!\d)\+?\d(?:[\s.-]?\d){9,13}(?!\d)/g;

export function hasContactDetails(text: string): boolean {
  EMAIL.lastIndex = 0; PHONE.lastIndex = 0;
  return EMAIL.test(text) || PHONE.test(text);
}
export function maskContactDetails(text: string): string {
  return text.replace(EMAIL, "[email hidden]").replace(PHONE, "[phone hidden]");
}
