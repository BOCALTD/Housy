// Pure rules for collaboration (master prompt Section 27). No database access here, so they can be tested alone.

export const COLLAB_KINDS = ["SEEKER_AGENT", "COMPANY_COMPANY"] as const;
export const COLLAB_PURPOSES = ["SEARCH_ASSISTANCE", "TRANSACTION", "INSPECTION", "DOCUMENT_EXCHANGE", "CO_LISTING", "REFERRAL", "CO_BROKERAGE", "MARKETING", "DEVELOPMENT", "CONTRACTOR", "OTHER"] as const;
export const SEEKER_PURPOSES = ["SEARCH_ASSISTANCE", "TRANSACTION", "INSPECTION", "DOCUMENT_EXCHANGE", "OTHER"] as const;
export const COMPANY_PURPOSES = ["CO_LISTING", "REFERRAL", "CO_BROKERAGE", "MARKETING", "DEVELOPMENT", "INSPECTION", "TRANSACTION", "DOCUMENT_EXCHANGE", "CONTRACTOR", "OTHER"] as const;
export const COLLAB_STATUSES = ["DRAFT", "PENDING", "ACTIVE", "DECLINED", "EXPIRED", "CANCELLED", "COMPLETED", "SUSPENDED"] as const;
export type CollabStatusName = (typeof COLLAB_STATUSES)[number];
export type CollabPurposeName = (typeof COLLAB_PURPOSES)[number];

const NEXT: Record<CollabStatusName, CollabStatusName[]> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["ACTIVE", "DECLINED", "CANCELLED", "EXPIRED"],
  ACTIVE: ["COMPLETED", "SUSPENDED"],
  SUSPENDED: ["ACTIVE", "COMPLETED"],
  DECLINED: [], EXPIRED: [], CANCELLED: [], COMPLETED: [],
};

/** Draft → Sent (pending) → accepted (active) or declined → completed, expired, cancelled or suspended. */
export function transitionProblem(from: CollabStatusName, to: CollabStatusName): string | null {
  if (from === to) return `The collaboration is already ${from.toLowerCase()}`;
  if (!NEXT[from].includes(to)) return `A collaboration that is ${from.toLowerCase()} cannot become ${to.toLowerCase()}`;
  return null;
}

export const OPEN_STATUSES: readonly CollabStatusName[] = ["DRAFT", "PENDING", "ACTIVE", "SUSPENDED"];
export const isOpen = (s: CollabStatusName) => OPEN_STATUSES.includes(s);

export function inviteExpiry(sentAt: Date, days: number): Date {
  return new Date(sentAt.getTime() + days * 864e5);
}
export function inviteExpired(status: CollabStatusName, expiresAt: Date | null, now: Date): boolean {
  return status === "PENDING" && expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
/** A workspace with an end date finishes when that day is over. */
export function workspaceEnded(status: CollabStatusName, endsOn: Date | null, today: Date): boolean {
  return status === "ACTIVE" && endsOn !== null && endsOn.getTime() < today.getTime();
}

export interface ParticipantLike { revokedAt: Date | null; expiresAt: Date | null }
export function participantActive(p: ParticipantLike, now: Date): boolean {
  return p.revokedAt === null && (p.expiresAt === null || p.expiresAt.getTime() > now.getTime());
}

export type PlanAccess = "FULL" | "READ_ONLY" | "NONE";

/**
 * What a participant can do in a workspace right now. Work needs an active workspace and a plan in force; a plan in read-only
 * shows the workspace without letting anyone add to it; a lapsed plan suspends it (records are kept, nothing is shown) until it
 * is renewed. A finished workspace stays readable as a record.
 */
export function workspaceMode(status: CollabStatusName, plan: PlanAccess): { view: boolean; write: boolean; reason: string } {
  if (status === "COMPLETED") return { view: true, write: false, reason: "This collaboration is finished. It is kept as a record." };
  if (status !== "ACTIVE") return { view: false, write: false, reason: status === "SUSPENDED" ? "This collaboration is suspended." : "This collaboration is not active." };
  if (plan === "FULL") return { view: true, write: true, reason: "" };
  if (plan === "READ_ONLY") return { view: true, write: false, reason: "A subscription has expired, so the workspace is read-only until it is renewed." };
  return { view: false, write: false, reason: "A subscription has lapsed, so the workspace is suspended until it is renewed. Nothing has been deleted." };
}

export type Need = "VIEW" | "COMMENT" | "TASKS" | "SHARE" | "DOCUMENTS";
export interface PermLike { canComment: boolean; canTasks: boolean; canShare: boolean; canDocuments: boolean }
export function participantCan(p: PermLike, need: Need): boolean {
  switch (need) {
    case "VIEW": return true;
    case "COMMENT": return p.canComment;
    case "TASKS": return p.canTasks;
    case "SHARE": return p.canShare;
    case "DOCUMENTS": return p.canDocuments;
  }
}

// ---------- What may be shared ----------
// A shared item is a copy of the fields the sharer ticked. These builders are the only way a record becomes shared data, and they
// accept only the fields listed here: there is no client, owner, buyer, price history or internal note to pass in by mistake.

export interface FieldRow { label: string; value: string }
export interface Snapshot { title: string; summary: string; fields: FieldRow[] }

export interface DealForShare { title: string; type: string; stage: string; askingKobo: bigint; agreedKobo: bigint | null; expectedCloseOn: Date | null }
export interface PropertyForShare { name: string; assetClass: string; category: string; city: string; state: string; address: string; priceKobo?: bigint | null; purpose?: string; bedrooms?: number | null; bathrooms?: number | null }
export interface DealShareOptions { stage: boolean; asking: boolean; agreed: boolean; expectedClose: boolean; propertyAddress: boolean; note: string }

const STAGES_WITH_PRICE = ["AGREED", "LEGAL", "COMPLETED"];
const human = (v: string) => { const s = v.toLowerCase().replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

export function dealSnapshot(deal: DealForShare, property: PropertyForShare, o: DealShareOptions, formatMoney: (k: bigint) => string, formatDay: (d: Date) => string): Snapshot {
  const fields: FieldRow[] = [{ label: "Type", value: human(deal.type) }, { label: "Property", value: property.name }, { label: "Location", value: [property.city, property.state].filter(Boolean).join(", ") || "Not stated" }];
  if (o.propertyAddress && property.address) fields.push({ label: "Address", value: property.address });
  if (o.stage) fields.push({ label: "Stage", value: human(deal.stage) });
  if (o.asking) fields.push({ label: "Asking price", value: formatMoney(deal.askingKobo) });
  // An agreed price is shown only once one has been agreed.
  if (o.agreed && deal.agreedKobo !== null && STAGES_WITH_PRICE.includes(deal.stage)) fields.push({ label: "Agreed price", value: formatMoney(deal.agreedKobo) });
  if (o.expectedClose && deal.expectedCloseOn) fields.push({ label: "Expected closing", value: formatDay(deal.expectedCloseOn) });
  const note = o.note.trim().slice(0, 500);
  if (note) fields.push({ label: "Note from the sharer", value: note });
  return { title: deal.title.slice(0, 160), summary: `${human(deal.type)} of ${property.name}`, fields };
}

export function propertySnapshot(p: PropertyForShare, o: { address: boolean; price: boolean; note: string }, formatMoney: (k: bigint) => string): Snapshot {
  const kind = [p.assetClass ? human(p.assetClass) : "", p.category].filter(Boolean).join(" · ");
  const fields: FieldRow[] = [...(kind ? [{ label: "Type", value: kind }] : []), { label: "Location", value: [p.city, p.state].filter(Boolean).join(", ") || "Not stated" }];
  if (p.purpose) fields.push({ label: "For", value: human(p.purpose) });
  if (p.bedrooms != null) fields.push({ label: "Bedrooms", value: String(p.bedrooms) });
  if (p.bathrooms != null) fields.push({ label: "Bathrooms", value: String(p.bathrooms) });
  if (o.address && p.address) fields.push({ label: "Address", value: p.address });
  if (o.price && p.priceKobo != null) fields.push({ label: "Price", value: formatMoney(p.priceKobo) });
  const note = o.note.trim().slice(0, 500);
  if (note) fields.push({ label: "Note from the sharer", value: note });
  return { title: p.name.slice(0, 160), summary: kind, fields };
}
