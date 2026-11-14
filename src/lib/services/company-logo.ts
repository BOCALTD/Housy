/**
 * A business's logo: shown on its public profile and, when its plan includes it and it switches it on, as a watermark on its
 * property photos (watermark.ts). Logos are re-drawn on the server (at most 600 pixels wide, as PNG) so nothing but the picture
 * is kept.
 */
import { withPlatformAdmin, withTenant } from "../db";
import { logActivity } from "../audit";
import { assertCan, type Ctx } from "./context";
import { logoWatermarkAllowed } from "./watermark";

const MAGIC: Record<string, number[]> = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };

export async function saveCompanyLogo(ctx: Ctx, type: string, bytes: Uint8Array) {
  assertCan(ctx, "settings.manage");
  const magic = MAGIC[type];
  if (!magic) throw new Error("Use a JPG, PNG or WEBP picture for the logo.");
  if (!bytes.byteLength) throw new Error("The picture is empty.");
  if (bytes.byteLength > 3 * 1024 * 1024) throw new Error("That picture is too large. Use one under 3 MB.");
  if (!magic.every((b, i) => bytes[i] === b)) throw new Error("The file is not the picture type it claims to be.");
  const sharp = (await import("sharp")).default;
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(bytes), { failOn: "error" }).rotate().resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  } catch { throw new Error("That picture could not be read. Try another file."); }
  if (png.byteLength > 1024 * 1024) throw new Error("That logo is too detailed to keep. Use a simpler picture.");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { logoMime: "image/png", logoBytes: png } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.logo_saved", detail: { bytes: png.byteLength } });
  });
}

export async function removeCompanyLogo(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { logoMime: null, logoBytes: null, logoWatermark: false } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.logo_removed", detail: {} });
  });
}

/** Switch the logo watermark on or off. On needs a logo and a plan that includes it. */
export async function setLogoWatermark(ctx: Ctx, on: boolean) {
  assertCan(ctx, "settings.manage");
  if (on) {
    const has = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { logoBytes: true } }));
    if (!has.logoBytes) throw new Error("Upload your logo first.");
    if (!(await logoWatermarkAllowed(ctx.companyId))) throw new Error("Your plan does not include the logo watermark. Choose the Pro or Elite plan under Billing.");
  }
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { logoWatermark: on } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: on ? "company.logo_watermark_on" : "company.logo_watermark_off", detail: {} });
  });
}

/** What the profile page shows about the logo. */
export async function logoState(ctx: Ctx) {
  const c = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { logoMime: true, logoWatermark: true } }));
  return { hasLogo: !!c.logoMime, watermark: c.logoWatermark, allowed: await logoWatermarkAllowed(ctx.companyId) };
}

/** A company's logo for its public pages. */
export async function publicLogo(companyId: string) {
  return withPlatformAdmin("system", (tx) => tx.company.findUnique({ where: { id: companyId }, select: { logoMime: true, logoBytes: true, suspendedAt: true } }));
}
