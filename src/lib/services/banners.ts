import { z } from "zod";
import { prisma, withPlatformAdmin, withPublic } from "../db";
import { logActivity } from "../audit";
import { recordUndo, undoable } from "./undo";

// Promo banners. The platform administrator designs a banner elsewhere (Canva, Photoshop, Figma...) and uploads it, with an
// optional phone version. Housy shows it in the chosen places with a folded corner and a gentle float (still for people who
// prefer less motion). A switch turns the whole promo layout on or off: off hides banners and the festive offers slideshow;
// promotion prices on properties stay.

export const BANNER_PLACES = ["HOME", "SEARCH", "DASHBOARD"] as const;
export type BannerPlace = (typeof BANNER_PLACES)[number];
export const BANNER_PLACE_LABELS: Record<BannerPlace, string> = { HOME: "Homepage, top", SEARCH: "Above search results", DASHBOARD: "Top of dashboards" };
export const BANNER_FOLDS = ["BOTTOM_RIGHT", "TOP_RIGHT", "NONE"] as const;
export const BANNER_FOLD_LABELS: Record<(typeof BANNER_FOLDS)[number], string> = { BOTTOM_RIGHT: "Bottom right corner", TOP_RIGHT: "Top right corner", NONE: "No fold" };
const LAYOUT_KEY = "promo_layout_enabled";
export const MAX_BANNER_UPLOAD = 4 * 1024 * 1024;

async function assertAdmin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

/** Whether the promo layout is on (it is, until the administrator switches it off). */
export async function promoLayoutOn(): Promise<boolean> {
  const r = await prisma.platformSetting.findUnique({ where: { key: LAYOUT_KEY } });
  return r?.value !== "off";
}

export async function setPromoLayout(adminId: string, on: boolean) {
  await assertAdmin(adminId);
  const before = await promoLayoutOn();
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.platformSetting.upsert({ where: { key: LAYOUT_KEY }, create: { key: LAYOUT_KEY, value: on ? "on" : "off", updatedById: adminId }, update: { value: on ? "on" : "off", updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "promo_layout", action: "settings.promo_layout", detail: { on } });
  });
  return before === on ? null : recordUndo({ userId: adminId, kind: "banner.layout", label: on ? "promo layout switched on" : "promo layout switched off", payload: { on: before } });
}

/** A banner picture, checked and re-saved as WebP no wider than needed, so pages stay quick. */
export async function prepareBannerImage(bytes: Uint8Array, maxWidth: number) {
  if (bytes.byteLength === 0) throw new Error("Choose the banner picture");
  if (bytes.byteLength > MAX_BANNER_UPLOAD) throw new Error("The banner picture can be up to 4 MB. Export it smaller (JPG or WebP) and try again.");
  const sharp = (await import("sharp")).default;
  let meta;
  try { meta = await sharp(bytes, { failOn: "error" }).metadata(); } catch { throw new Error("That file is not a picture we can use. Upload a JPG, PNG or WebP."); }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new Error("Upload the banner as a JPG, PNG or WebP picture.");
  const w0 = meta.autoOrient?.width ?? meta.width ?? 0, h0 = meta.autoOrient?.height ?? meta.height ?? 0;
  if (w0 < 600 || h0 < 150) throw new Error("The banner is too small. Use a picture at least 600 pixels wide and 150 high (1600 × 500 looks sharp on most screens).");
  if (w0 / h0 > 8 || h0 / w0 > 2) throw new Error("That shape is too extreme for a banner. Use something between a wide strip (8 to 1) and a tall card (1 to 2).");
  const out = await sharp(bytes).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
  return { bytes: out.data, mime: "image/webp", w: out.info.width, h: out.info.height };
}

const link = z.string().trim().max(500).refine((v) => v === "" || (/^\/(?!\/)[^\s]*$/.test(v)) || /^https:\/\/[^\s/]+\.[^\s]+$/.test(v), "Enter a page on this site (starting with /) or a full https:// address, or leave it empty");
const bannerSchema = z.object({
  title: z.string().trim().min(3, "Say what the banner shows, for people who cannot see it").max(160),
  linkUrl: link.default(""),
  places: z.array(z.enum(BANNER_PLACES)).min(1, "Choose where the banner shows"),
  fold: z.enum(BANNER_FOLDS).default("BOTTOM_RIGHT"),
  float: z.boolean().default(true),
  startsAt: z.string().optional().transform((v) => (v ? new Date(`${v}T00:00:00`) : null)),
  endsAt: z.string().optional().transform((v) => (v ? new Date(`${v}T23:59:59`) : null)),
});

/** Add a banner, or change one (a new picture is optional when changing). */
export async function saveBanner(adminId: string, id: string | null, raw: z.input<typeof bannerSchema>, files: { desktop?: Uint8Array | null; mobile?: Uint8Array | null; dropMobile?: boolean }) {
  await assertAdmin(adminId);
  const d = bannerSchema.parse(raw);
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) throw new Error("The end date is before the start date");
  if (!id && !files.desktop?.byteLength) throw new Error("Choose the banner picture");
  const desktop = files.desktop?.byteLength ? await prepareBannerImage(files.desktop, 2400) : null;
  const mobile = files.mobile?.byteLength ? await prepareBannerImage(files.mobile, 1200) : null;
  return withPlatformAdmin(adminId, async (tx) => {
    const data = {
      title: d.title, linkUrl: d.linkUrl, places: d.places, fold: d.fold, float: d.float, startsAt: d.startsAt, endsAt: d.endsAt,
      ...(desktop ? { desktopMime: desktop.mime, desktopBytes: desktop.bytes, desktopW: desktop.w, desktopH: desktop.h } : {}),
      ...(mobile ? { mobileMime: mobile.mime, mobileBytes: mobile.bytes, mobileW: mobile.w, mobileH: mobile.h } : files.dropMobile ? { mobileMime: null, mobileBytes: null, mobileW: null, mobileH: null } : {}),
    };
    let row;
    if (id) {
      const had = await tx.promoBanner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!had) throw new Error("Banner not found");
      row = await tx.promoBanner.update({ where: { id }, data, select: { id: true } });
    } else {
      const last = await tx.promoBanner.findFirst({ where: { deletedAt: null }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      row = await tx.promoBanner.create({ data: { ...data, desktopMime: desktop!.mime, desktopBytes: desktop!.bytes, desktopW: desktop!.w, desktopH: desktop!.h, sortOrder: (last?.sortOrder ?? -1) + 1, createdById: adminId }, select: { id: true } });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_banner", entityId: row.id, action: id ? "banner.updated" : "banner.created", detail: { title: d.title, places: d.places } });
    return row.id;
  });
}

/** Show or hide one banner. */
export async function setBannerActive(adminId: string, id: string, active: boolean) {
  await assertAdmin(adminId);
  const before = await withPlatformAdmin(adminId, async (tx) => {
    const b = await tx.promoBanner.findFirst({ where: { id, deletedAt: null }, select: { active: true, title: true } });
    if (!b) throw new Error("Banner not found");
    await tx.promoBanner.update({ where: { id }, data: { active } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_banner", entityId: id, action: active ? "banner.shown" : "banner.hidden", detail: {} });
    return b;
  });
  return recordUndo({ userId: adminId, kind: "banner.active", label: `${active ? "showing" : "hiding"} "${before.title}"`, payload: { id, active: before.active } });
}

/** Remove a banner. It is kept for a day so the removal can be undone, then deleted for good. */
export async function removeBanner(adminId: string, id: string) {
  await assertAdmin(adminId);
  const title = await withPlatformAdmin(adminId, async (tx) => {
    const b = await tx.promoBanner.findFirst({ where: { id, deletedAt: null }, select: { title: true } });
    if (!b) throw new Error("Banner not found");
    await tx.promoBanner.update({ where: { id }, data: { deletedAt: new Date() } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "promo_banner", entityId: id, action: "banner.removed", detail: {} });
    return b.title;
  });
  return recordUndo({ userId: adminId, kind: "banner.remove", label: `removing "${title}"`, payload: { id } });
}

export async function moveBanner(adminId: string, id: string, dir: "up" | "down") {
  await assertAdmin(adminId);
  await withPlatformAdmin(adminId, async (tx) => {
    const all = await tx.promoBanner.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const i = all.findIndex((b) => b.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    for (let k = 0; k < all.length; k++) await tx.promoBanner.update({ where: { id: all[k].id }, data: { sortOrder: k } });
  });
}

const META = { id: true, title: true, linkUrl: true, places: true, fold: true, float: true, desktopW: true, desktopH: true, mobileW: true, mobileH: true, startsAt: true, endsAt: true, active: true, sortOrder: true, updatedAt: true } as const;

/** The administrator's list (removed banners older than a day are deleted for good here). */
export async function adminBanners(adminId: string) {
  await assertAdmin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    await tx.promoBanner.deleteMany({ where: { deletedAt: { lt: new Date(Date.now() - 864e5) } } });
    return tx.promoBanner.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: META });
  });
}

export type PublicBanner = { id: string; title: string; linkUrl: string; fold: string; float: boolean; desktopW: number; desktopH: number; mobileW: number | null; mobileH: number | null; v: number };

/** Banners showing now in one place, in the administrator's order. None while the promo layout is off. */
export async function bannersFor(place: BannerPlace, now = new Date()): Promise<PublicBanner[]> {
  if (!(await promoLayoutOn())) return [];
  const rows = await withPublic((tx) => tx.promoBanner.findMany({
    where: { active: true, deletedAt: null, places: { has: place }, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 8, select: META,
  }));
  return rows.map((r) => ({ id: r.id, title: r.title, linkUrl: r.linkUrl, fold: r.fold, float: r.float, desktopW: r.desktopW, desktopH: r.desktopH, mobileW: r.mobileW, mobileH: r.mobileH, v: r.updatedAt.getTime() }));
}

/** A banner's picture: public while it can show; the administrator can also preview hidden ones. */
export async function bannerImage(id: string, variant: "desktop" | "mobile", adminId: string | null) {
  const select = variant === "mobile" ? { mobileBytes: true, mobileMime: true } : { desktopBytes: true, desktopMime: true };
  const row = adminId
    ? await withPlatformAdmin(adminId, (tx) => tx.promoBanner.findFirst({ where: { id, deletedAt: null }, select }))
    : await withPublic((tx) => tx.promoBanner.findFirst({ where: { id, active: true, deletedAt: null }, select }));
  if (!row) return null;
  const r = row as { mobileBytes?: Uint8Array | null; mobileMime?: string | null; desktopBytes?: Uint8Array; desktopMime?: string };
  const bytes = variant === "mobile" ? r.mobileBytes : r.desktopBytes;
  const mime = variant === "mobile" ? r.mobileMime : r.desktopMime;
  return bytes && mime ? { bytes: Buffer.from(bytes), mime } : null;
}

// ---------- Undo ----------

undoable("banner.layout", async (a, p) => { await setPromoLayout(a.userId, !!(p as { on: boolean }).on); });
undoable("banner.active", async (a, p) => {
  const { id, active } = p as { id: string; active: boolean };
  await assertAdmin(a.userId);
  await withPlatformAdmin(a.userId, (tx) => tx.promoBanner.update({ where: { id }, data: { active } }));
});
undoable("banner.remove", async (a, p) => {
  const { id } = p as { id: string };
  await assertAdmin(a.userId);
  await withPlatformAdmin(a.userId, async (tx) => {
    const r = await tx.promoBanner.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } });
    if (!r.count) throw new Error("That banner is gone for good.");
    await logActivity(tx, { companyId: null, actorId: a.userId, entityType: "promo_banner", entityId: id, action: "banner.restored", detail: {} });
  });
});
