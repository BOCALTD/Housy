/**
 * Property photo watermarks:
 *  - Housy's mark is fixed on each property when it is posted, from the setting then. Switching it off or on asks whether the
 *    change is for every property already posted too, or only for properties posted from now on.
 *  - A business whose plan includes the logo watermark never gets Housy's mark: it shows its own logo, or keeps photos clean.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prisma, withPlatformAdmin, withTenant } from "../../src/lib/db";
import { forgetPlatformConfig, saveWatermark, platformConfig, watermarkCounts } from "../../src/lib/services/platform-config";
import { logoState, removeCompanyLogo, saveCompanyLogo, setLogoWatermark } from "../../src/lib/services/company-logo";
import { applyWatermark, watermarkPlanFor } from "../../src/lib/services/watermark";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(async () => { await saveWatermark((await newPlatformAdmin()).id, { housy: true, position: "corner", scope: "new" }); forgetPlatformConfig(); await prisma.$disconnect(); });

const logoPng = () => sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 29, g: 78, b: 216, alpha: 1 } } }).png().toBuffer();
const photo = () => sharp({ create: { width: 1200, height: 800, channels: 3, background: "#e9dccb" } }).jpeg().toBuffer();
const corner = async (b: Buffer, left: number) => (await sharp(await sharp(b).extract({ left, top: 700, width: 120, height: 80 }).toBuffer()).stats()).channels[2].mean;

async function post(co: Ctx, adminId: string, name: string) {
  const asset = await createAsset(co, { name, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" } as never);
  await saveListingDraft(co, asset.id, { title: `${name} to let`, purpose: "RENT", price: "1,200,000", city: "Yaba", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(adminId, l.id, "approve", "ok");
  return l.id;
}
const flag = (adminId: string, id: string) => withPlatformAdmin(adminId, async (tx) => (await tx.listing.findUniqueOrThrow({ where: { id } })).housyWatermark);

test("Housy's mark is fixed per property when posted; switching it asks whether it is for all posted properties or only new ones", async () => {
  const admin = await newPlatformAdmin();
  await saveWatermark(admin.id, { housy: true, position: "corner", scope: "all" });
  const co = await newCompany("wm-scope");
  const first = await post(co, admin.id, "First flat");
  assert.equal(await flag(admin.id, first), true, "posted while on");

  // Off for new properties only: the one already posted keeps the mark.
  await saveWatermark(admin.id, { housy: false, position: "corner", scope: "new" });
  const second = await post(co, admin.id, "Second flat");
  assert.equal(await flag(admin.id, first), true);
  assert.equal(await flag(admin.id, second), false, "posted while off");
  assert.equal((await watermarkPlanFor(co.companyId, true)).housy, "corner", "the first still shows it");
  assert.equal((await watermarkPlanFor(co.companyId, false)).housy, false);

  // On for all: every posted property gets it.
  const r = await saveWatermark(admin.id, { housy: true, position: "centre", scope: "all" });
  assert.ok(r.changed >= 2);
  assert.deepEqual([await flag(admin.id, first), await flag(admin.id, second)], [true, true]);
  assert.equal((await watermarkPlanFor(co.companyId, true)).housy, "centre", "the position applies everywhere");

  // Off for all: none keeps it.
  await saveWatermark(admin.id, { housy: false, position: "corner", scope: "all" });
  assert.deepEqual([await flag(admin.id, first), await flag(admin.id, second)], [false, false]);
  const counts = await watermarkCounts();
  assert.equal(counts.on, 0);
  // On for new only: posted ones stay without it; the next one gets it.
  await saveWatermark(admin.id, { housy: true, position: "corner", scope: "new" });
  const third = await post(co, admin.id, "Third flat");
  assert.deepEqual([await flag(admin.id, first), await flag(admin.id, third)], [false, true]);
  assert.equal((await platformConfig()).watermark.housy, true);
});

test("a business paying for its logo watermark never gets Housy's mark: its logo, or clean photos", async () => {
  const admin = await newPlatformAdmin();
  await saveWatermark(admin.id, { housy: true, position: "corner", scope: "new" });
  const co = await newCompany("wm-logo");
  const staff = await addMember(co, "AGENT", "wmagent");
  assert.equal((await watermarkPlanFor(co.companyId, true)).housy, "corner", "free plan: Housy's mark");

  await assert.rejects(saveCompanyLogo(staff, "image/png", new Uint8Array(await logoPng())), /permission/);
  await assert.rejects(saveCompanyLogo(co, "image/png", new Uint8Array([1, 2, 3, 4])), /not the picture type/);
  await assert.rejects(saveCompanyLogo(co, "image/gif", new Uint8Array(await logoPng())), /JPG, PNG or WEBP/);
  await saveCompanyLogo(co, "image/png", new Uint8Array(await logoPng()));
  assert.deepEqual(await logoState(co), { hasLogo: true, watermark: false, allowed: false });
  await assert.rejects(setLogoWatermark(co, true), /plan does not include/);

  const pro = await withPlatformAdmin(admin.id, (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-silver" } }));
  await assignSubscription(admin.id, { planId: pro.id, periodEnd: relativeDate(60), companyId: co.companyId });
  let plan = await watermarkPlanFor(co.companyId, true);
  assert.deepEqual([plan.housy, plan.logo], [false, null], "paid, logo not switched on: clean photos");
  const original = await photo();
  assert.equal(await applyWatermark(original, "image/jpeg", plan), original, "nothing is added");

  await setLogoWatermark(co, true);
  plan = await watermarkPlanFor(co.companyId, true);
  assert.equal(plan.housy, false, "Housy's mark stays off");
  assert.ok(plan.logo);
  const marked = await applyWatermark(original, "image/jpeg", plan);
  const meta = await sharp(marked).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1200, 800, "jpeg"]);
  assert.ok(Math.abs((await corner(marked, 20)) - (await corner(original, 20))) > 5, "the logo, bottom left");
  assert.ok(Math.abs((await corner(marked, 1060)) - (await corner(original, 1060))) < 1, "no Housy mark, bottom right");

  // On the free plan, Housy's mark is drawn bottom right.
  const free = await applyWatermark(original, "image/jpeg", { housy: "corner", logo: null });
  assert.ok(Math.abs((await corner(free, 1060)) - (await corner(original, 1060))) > 5);
  const tiny = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  assert.equal(await applyWatermark(tiny, "image/jpeg", { housy: "corner", logo: null }), tiny, "too small for a mark");

  await removeCompanyLogo(co);
  assert.deepEqual(await logoState(co), { hasLogo: false, watermark: false, allowed: true });
  await assert.rejects(setLogoWatermark(co, true), /Upload your logo first/);
});
