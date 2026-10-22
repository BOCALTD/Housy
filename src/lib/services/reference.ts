import { z } from "zod";
import { withPlatformAdmin, withPublic } from "../db";
import { logActivity } from "../audit";
import { AMENITIES, PROPERTY_TYPES, TITLE_DOCUMENTS } from "../listing-rules";

export const REF_KINDS = ["PROPERTY_TYPE", "AMENITY", "TITLE_DOCUMENT"] as const;
export type RefKind = (typeof REF_KINDS)[number];
const DEFAULTS: Record<RefKind, Record<string, string>> = { PROPERTY_TYPE: PROPERTY_TYPES, AMENITY: AMENITIES, TITLE_DOCUMENT: TITLE_DOCUMENTS };
/** Property types are fixed codes (the database checks them); administrators may rename, hide and reorder them, not add new ones. */
export const CAN_ADD: Record<RefKind, boolean> = { PROPERTY_TYPE: false, AMENITY: true, TITLE_DOCUMENT: true };

export type RefItem = { code: string; label: string; active: boolean; position: number; country: string; custom: boolean };
export type RefData = Record<RefKind, RefItem[]>;

let cached: { at: number; data: RefData } | null = null;

/** The built-in values with the administrators' changes applied. Cached for a minute. */
export async function refData(now = Date.now()): Promise<RefData> {
  if (cached && now - cached.at < 60_000) return cached.data;
  const rows = await withPublic((tx) => tx.referenceItem.findMany()).catch(() => []);
  const out = {} as RefData;
  for (const kind of REF_KINDS) {
    const base = Object.entries(DEFAULTS[kind]).map(([code, label], i) => ({ code, label, active: true, position: i * 10, country: "", custom: false }));
    for (const r of rows.filter((x) => x.kind === kind)) {
      const b = base.find((x) => x.code === r.code);
      if (b) Object.assign(b, { label: r.label, active: r.active, position: r.position, country: r.country });
      else if (CAN_ADD[kind]) base.push({ code: r.code, label: r.label, active: r.active, position: r.position, country: r.country, custom: true });
    }
    out[kind] = base.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  }
  cached = { at: now, data: out };
  return out;
}
export function clearRefCache() { cached = null; }

/** Active values for forms and filters, optionally only those that apply in one country (blank country = everywhere). */
export function activeOf(d: RefData, kind: RefKind, country?: string) {
  return d[kind].filter((x) => x.active && (!country || !x.country || x.country === country));
}
/** Labels for every value, active or not, so older listings still read well after a value is hidden. */
export function labelsOf(d: RefData, kind: RefKind): Record<string, string> {
  return Object.fromEntries(d[kind].map((x) => [x.code, x.label]));
}

const schema = z.object({
  kind: z.enum(REF_KINDS),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Codes are capital letters, digits and underscores, starting with a letter"),
  label: z.string().trim().min(2, "Give a label").max(80),
  active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).max(1000).default(500),
  country: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, "Use a two-letter country code, or leave it empty for everywhere").default(""),
});

export async function saveReference(adminId: string, input: z.input<typeof schema>) {
  const d = schema.parse(input);
  if (!CAN_ADD[d.kind] && !(d.code in DEFAULTS[d.kind])) throw new Error("New property types need a software change; you can rename, hide or reorder the existing ones");
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.referenceItem.upsert({ where: { kind_code: { kind: d.kind, code: d.code } }, create: { ...d, updatedById: adminId }, update: { label: d.label, active: d.active, position: d.position, country: d.country, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "reference", entityId: `${d.kind}:${d.code}`, action: "reference.saved", detail: d });
  });
  clearRefCache();
}
