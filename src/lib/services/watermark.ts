/**
 * Watermarks on the property photos the public sees (the company's own copies stay clean):
 *  - Housy's mark, on every listing photo while the platform administrator keeps it on (Admin → Settings), in a corner or
 *    across the middle;
 *  - the business's own logo, in the other corner, when its plan includes "Logo watermark" and it switched it on with a logo
 *    uploaded (Profile).
 * Watermarked copies are made when a photo is first asked for and kept in memory for a while, so changing a setting shows on
 * the next view of each photo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { withPlatformAdmin, withTenant } from "../db";
import { platformConfig } from "./platform-config";
import { entitlementIn } from "./subscriptions";

let housyLogo: { inner: string; w: number; h: number } | null = null;
/** Housy's white logo, as SVG markup to place inside a larger picture. */
function logoMarkup() {
  if (housyLogo) return housyLogo;
  const svg = readFileSync(join(process.cwd(), "public", "brand", "housy-logo-white.svg"), "utf8");
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  housyLogo = { inner: svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""), w: m ? Number(m[1]) : 261, h: m ? Number(m[2]) : 73 };
  return housyLogo;
}

export type WatermarkPlan = { housy: false | "corner" | "centre"; logo: { bytes: Buffer; mime: string } | null };

/** The overlay for a photo of this size, as one SVG the size of the photo. */
function overlaySvg(width: number, height: number, plan: WatermarkPlan): string {
  const pad = Math.round(Math.max(10, Math.min(width, height) * 0.03));
  const parts: string[] = [];
  if (plan.housy) {
    const L = logoMarkup();
    const centre = plan.housy === "centre";
    const w = Math.round(Math.max(110, Math.min(width * (centre ? 0.42 : 0.2), centre ? 900 : 360)));
    const scale = w / L.w, h = Math.round(L.h * scale);
    const x = centre ? Math.round((width - w) / 2) : width - w - pad * 2;
    const y = centre ? Math.round((height - h) / 2) : height - h - pad * 2;
    // A soft dark backing keeps the white mark readable on bright skies and white walls.
    if (!centre) parts.push(`<rect x="${x - pad}" y="${y - pad * 0.7}" width="${w + pad * 2}" height="${h + pad * 1.4}" rx="${pad}" fill="#000" fill-opacity=".32"/>`);
    if (centre) {
      // A blurred dark copy underneath, so the faint white mark still shows on light walls.
      const shadow = L.inner.replace(/#FFFFFF|#fff\b|white/gi, "#000").replace(/#F2A007/gi, "#000");
      parts.push(`<defs><filter id="wm-soft" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="${(6 / scale).toFixed(1)}"/></filter></defs>`);
      parts.push(`<g transform="translate(${x} ${y + 2}) scale(${scale.toFixed(4)})" opacity=".28" filter="url(#wm-soft)">${shadow}</g>`);
    }
    parts.push(`<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})" opacity="${centre ? 0.55 : 0.9}">${L.inner}</g>`);
  }
  if (plan.logo) {
    const w = Math.round(Math.max(90, Math.min(width * 0.17, 260)));
    const h = Math.round(w * 0.5);
    const x = pad, y = height - h - pad;
    const data = `data:${plan.logo.mime};base64,${plan.logo.bytes.toString("base64")}`;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(pad * 0.8)}" fill="#fff" fill-opacity=".78"/>`);
    parts.push(`<image x="${x + pad * 0.5}" y="${y + pad * 0.4}" width="${w - pad}" height="${h - pad * 0.8}" preserveAspectRatio="xMidYMid meet" opacity=".92" href="${data}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** A photo with its watermarks, in the photo's own format. Pictures too small to carry a mark are left as they are. */
export async function applyWatermark(bytes: Buffer, mime: string, plan: WatermarkPlan): Promise<Buffer> {
  if (!plan.housy && !plan.logo) return bytes;
  const sharp = (await import("sharp")).default;
  const img = sharp(bytes, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0, height = meta.autoOrient?.height ?? meta.height ?? 0;
  if (width < 240 || height < 160) return bytes;
  const out = img.composite([{ input: Buffer.from(overlaySvg(width, height, plan)), top: 0, left: 0 }]);
  if (mime === "image/png") return out.png().toBuffer();
  if (mime === "image/webp") return out.webp({ quality: 86 }).toBuffer();
  return out.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/**
 * What goes on a company's photos now: Housy's mark (platform setting), and its logo if its plan includes the logo watermark,
 * it switched it on and a logo is uploaded. Read without a signed-in person (the public photo address).
 */
export async function watermarkPlanFor(companyId: string, now = new Date()): Promise<WatermarkPlan & { key: string }> {
  const cfg = await platformConfig();
  const housy = cfg.watermark.housy ? cfg.watermark.position : false;
  const c = await withPlatformAdmin("system", (tx) => tx.company.findUnique({ where: { id: companyId }, select: { logoWatermark: true, logoMime: true, logoBytes: true } }));
  const co = c?.logoWatermark && c.logoBytes && c.logoMime && (await logoWatermarkAllowed(companyId, now)) ? { bytes: Buffer.from(c.logoBytes), mime: c.logoMime } : null;
  const key = `${housy || "none"}:${co ? createHash("sha1").update(co.bytes).digest("hex").slice(0, 12) : "nologo"}`;
  return { housy, logo: co, key };
}

/**
 * Whether the business's plan includes the logo watermark: the workspace's own plan, or for an agent working for themselves,
 * the agent's personal plan.
 */
export async function logoWatermarkAllowed(companyId: string, now = new Date()): Promise<boolean> {
  const own = await withPlatformAdmin("system", (tx) => entitlementIn(tx, { kind: "COMPANY", companyId }, "LOGO_WATERMARK", now));
  if (own.access !== "NONE") return true;
  const agentOwner = await withTenant(companyId, "system", async (tx) => {
    const co = await tx.company.findUnique({ where: { id: companyId }, select: { businessType: true } });
    if (co?.businessType !== "INDEPENDENT_AGENT") return null;
    return (await tx.membership.findFirst({ where: { companyId, role: "COMPANY_SUPER_ADMIN", status: "ACTIVE" }, select: { userId: true } }))?.userId ?? null;
  });
  if (!agentOwner) return false;
  const mine = await withPlatformAdmin("system", (tx) => entitlementIn(tx, { kind: "USER", userId: agentOwner }, "LOGO_WATERMARK", now));
  return mine.access !== "NONE";
}

// Recently made copies, by photo and watermark plan. Small and bounded: a busy listing's photos are made once, not on every view.
const cache = new Map<string, Buffer>();
const MAX = 240;
const plans = new Map<string, { at: number; plan: Awaited<ReturnType<typeof watermarkPlanFor>> }>();

/** A public photo with today's watermarks. */
export async function watermarked(photo: { id: string; companyId: string; bytes: Uint8Array; mimeType: string }): Promise<Buffer> {
  let p = plans.get(photo.companyId);
  if (!p || Date.now() - p.at > 60_000) { p = { at: Date.now(), plan: await watermarkPlanFor(photo.companyId) }; plans.set(photo.companyId, p); }
  const key = `${photo.id}:${p.plan.key}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const out = await applyWatermark(Buffer.from(photo.bytes), photo.mimeType, p.plan).catch(() => Buffer.from(photo.bytes));
  cache.set(key, out);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return out;
}
