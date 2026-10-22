import { z } from "zod";
import { withPlatformAdmin } from "../db";
import { validateUpload } from "../storage";

export const PARTNER_KINDS = ["BANK", "LAW_FIRM", "SURVEYOR", "VALUER", "DEVELOPER", "INSURER", "MEDIA", "TECHNOLOGY", "ASSOCIATION", "OTHER"] as const;
const schema = z.object({
  name: z.string().trim().min(2, "Enter the partner's name").max(120),
  kind: z.enum(PARTNER_KINDS),
  url: z.string().trim().max(300).refine((u) => u === "" || /^https:\/\//.test(u), "The website must start with https://").default(""),
  blurb: z.string().trim().max(300).default(""),
  position: z.coerce.number().int().min(0).max(1000).default(0),
});

/** Partners are added by platform administrators only, once a real agreement exists. Nothing here is invented or shown by default. */
export async function addPartner(adminId: string, input: z.input<typeof schema>, logo: { type: string; bytes: Uint8Array } | null) {
  const d = schema.parse(input);
  if (logo) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(logo.type)) throw new Error("The logo must be a PNG, JPG or WEBP picture");
    if (logo.bytes.byteLength > 1024 * 1024) throw new Error("The logo must be 1 MB or smaller");
    validateUpload(logo.type, logo.bytes);
  }
  return withPlatformAdmin(adminId, async (tx) => (await tx.partner.create({
    data: { ...d, addedById: adminId, logoMime: logo?.type ?? null, logoBytes: logo ? Buffer.from(logo.bytes) : null }, select: { id: true },
  })).id);
}

export async function setPartnerActive(adminId: string, id: string, active: boolean) {
  await withPlatformAdmin(adminId, (tx) => tx.partner.update({ where: { id }, data: { active } }));
}

export async function removePartner(adminId: string, id: string) {
  await withPlatformAdmin(adminId, (tx) => tx.partner.delete({ where: { id } }));
}

export async function partnersForAdmin(adminId: string) {
  return withPlatformAdmin(adminId, (tx) => tx.partner.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, url: true, blurb: true, active: true, position: true, logoMime: true } }));
}
