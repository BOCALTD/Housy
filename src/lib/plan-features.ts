/**
 * What each plan includes, as one list per audience, so every plan can be shown side by side with what it lacks struck through.
 * A feature is either an entitlement the plan carries or a perk of its tier (Silver, Gold). Pure, tested on its own.
 */
import type { TierName } from "./tier-rules";

export type Audience = "COMPANY" | "SEEKER" | "AGENT";
export type Feature = { id: string; label: string; entitlement?: string; tier?: TierName; always?: boolean };

const RANK: Record<TierName, number> = { BASIC: 0, SILVER: 1, GOLD: 2 };

export const FEATURES: Record<Audience, Feature[]> = {
  COMPANY: [
    { id: "workspace", label: "Company workspace: listings, tenants, rent, maintenance and documents", always: true },
    { id: "verified", label: "Identity and business checks with a public trust badge", always: true },
    { id: "contact", label: "Share phone numbers and email addresses in messages", entitlement: "CONTACT_DETAILS" },
    { id: "collab", label: "Collaborate with other companies on deals", entitlement: "COLLAB_COMPANY" },
    { id: "bulk", label: "Bulk messaging to clients and tenants", entitlement: "BULK_MESSAGING" },
    { id: "ads", label: "Advertise properties in sponsored places", entitlement: "ADVERTISING" },
    { id: "promos", label: "Free promotions (festive offers on the home page)", tier: "SILVER" },
    { id: "gold", label: "Gold badge and Premium tag on every listing", tier: "GOLD" },
    { id: "boost", label: "Automatic boost in search results", tier: "GOLD" },
  ],
  SEEKER: [
    { id: "browse", label: "Every photo and detail, saved homes and alerts", always: true },
    { id: "flatmates", label: "Flatmate matching and chat rooms", always: true },
    { id: "contact", label: "Share phone numbers and email addresses in messages", entitlement: "CONTACT_DETAILS" },
    { id: "collab", label: "Work with an agent on your search", entitlement: "COLLAB_SEEKER_AGENT" },
  ],
  AGENT: [
    { id: "profile", label: "Public agent profile with reviews, badges and reels", always: true },
    { id: "contact", label: "Share phone numbers and email addresses in messages", entitlement: "CONTACT_DETAILS" },
    { id: "ads", label: "Advertise properties in sponsored places", entitlement: "ADVERTISING" },
  ],
};

export type PlanLike = { tier?: string | null; entitlements: { key: string; limit: number | null }[] };

/** Whether a plan includes a feature, and its limit when it has one ("up to 10"). */
export function includes(plan: PlanLike, f: Feature): { yes: boolean; limit: number | null } {
  if (f.always) return { yes: true, limit: null };
  if (f.tier) return { yes: RANK[(plan.tier ?? "BASIC") as TierName] >= RANK[f.tier], limit: null };
  const e = plan.entitlements.find((x) => x.key === f.entitlement);
  return { yes: !!e, limit: e?.limit ?? null };
}

/** Features of the audience that a plan lacks. The top plan of each audience should lack none. */
export const missing = (audience: Audience, plan: PlanLike) => FEATURES[audience].filter((f) => !includes(plan, f).yes);
