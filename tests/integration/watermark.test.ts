/**
 * Property photo watermarks: Housy's mark on public photos (switchable by the administrator), and a business's own logo in the
 * other corner, only on a plan that includes it, once it has uploaded a logo and switched it on. Company copies stay clean.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { forgetPlatformConfig, saveWatermark, platformConfig } from "../../src/lib/services/platform-config";
import { logoState, removeCompanyLogo, saveCompanyLogo, setLogoWatermark } from "../../src/lib/services/company-logo";
import { applyWatermark, watermarkPlanFor } from "../../src/lib/services/watermark";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(async () => { forgetPlatformConfig(); await prisma.$disconnect(); });

const logoPng = () => sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 29, g: 78, b: 216, alpha: 1 } } }).png().toBuffer();
const photo = () => sharp({ create: { width: 1200, height: 800, channels: 3, background: "#e9dccb" } }).jpeg().toBuffer();

test("Housy's mark goes on public photos while it is switched on; the logo watermark needs a paid plan, a logo and the switch", async () => {
  const admin = await newPlatformAdmin();
  await saveWatermark(admin.id, { housy: true, position: "corner" });
  const co = await newCompany("wm-co");
  const staff = await addMember(co, "AGENT", "wmagent");

  let plan = await watermarkPlanFor(co.companyId);
  assert.equal(plan.housy, "corner");
  assert.equal(plan.logo, null);

  // A logo: checked, re-drawn as PNG, and only by someone who manages settings.
  await assert.rejects(saveCompanyLogo(staff, "image/png", new Uint8Array(await logoPng())), /permission/);
  await assert.rejects(saveCompanyLogo(co, "image/png", new Uint8Array([1, 2, 3, 4])), /not the picture type/);
  await assert.rejects(saveCompanyLogo(co, "image/gif", new Uint8Array(await logoPng())), /JPG, PNG or WEBP/);
  await saveCompanyLogo(co, "image/png", new Uint8Array(await logoPng()));
  assert.deepEqual(await logoState(co), { hasLogo: true, watermark: false, allowed: false });

  // Not on the free plan.
  await assert.rejects(setLogoWatermark(co, true), /plan does not include/);
  const pro = await withPlatformAdmin(admin.id, (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-silver" } }));
  await assignSubscription(admin.id, { planId: pro.id, periodEnd: relativeDate(60), companyId: co.companyId });
  await setLogoWatermark(co, true);
  plan = await watermarkPlanFor(co.companyId);
  assert.ok(plan.logo, "the logo goes on the photos");

  // The marks really are on the picture, which keeps its size and format.
  const original = await photo();
  const marked = await applyWatermark(original, "image/jpeg", plan);
  const meta = await sharp(marked).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1200, 800, "jpeg"]);
  const corner = async (b: Buffer, left: number) => (await sharp(await sharp(b).extract({ left, top: 700, width: 120, height: 80 }).toBuffer()).stats()).channels[2].mean;
  assert.ok(Math.abs((await corner(marked, 1060)) - (await corner(original, 1060))) > 5, "Housy's mark bottom right");
  assert.ok(Math.abs((await corner(marked, 20)) - (await corner(original, 20))) > 5, "the logo bottom left");
  const tiny = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  assert.equal(await applyWatermark(tiny, "image/jpeg", plan), tiny, "pictures too small for a mark are left alone");

  // The administrator can switch Housy's mark off; removing the logo switches the logo watermark off.
  await saveWatermark(admin.id, { housy: false, position: "centre" });
  assert.deepEqual((await platformConfig()).watermark, { housy: false, position: "centre" });
  assert.equal((await watermarkPlanFor(co.companyId)).housy, false);
  await removeCompanyLogo(co);
  assert.deepEqual(await logoState(co), { hasLogo: false, watermark: false, allowed: true });
  await assert.rejects(setLogoWatermark(co, true), /Upload your logo first/);
  await saveWatermark(admin.id, { housy: true, position: "corner" });
});
