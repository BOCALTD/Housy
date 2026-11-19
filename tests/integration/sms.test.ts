/**
 * Text messages: queued with important notices, sent only to people who turned them on and have a number, held in quiet hours
 * (except security notices), retried, and given up on when the provider refuses.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { notify } from "../../src/lib/services/notifications";
import { savePrefs } from "../../src/lib/services/delivery";
import { processSms, saveSmsConfig, smsConfigForAdmin, type SmsDriver } from "../../src/lib/services/sms";
import { system } from "../../src/lib/services/rewards";
import { lagosHour } from "../../src/lib/notification-rules";
import { newCompany, newPlatformAdmin } from "./helpers";
import { saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { createClient } from "../../src/lib/services/crm";
import { createDeal } from "../../src/lib/services/deal";
import { issueInvite, sendInviteToClient, sendReviewReminders } from "../../src/lib/services/reviews";

after(() => prisma.$disconnect());
const base = { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT" as const, quietStart: null, quietEnd: null, areas: "" };

function recorder(result: (n: number) => Awaited<ReturnType<SmsDriver["send"]>>) {
  const sent: { to: string; body: string }[] = [];
  return { sent, driver: { name: "fake", async send(to: string, body: string) { sent.push({ to, body }); return result(sent.length); } } satisfies SmsDriver };
}

test("important notices are texted to people who asked, at the right time", async () => {
  const co = await newCompany("sms");
  const rows = () => system((tx) => tx.smsOutbox.findMany({ where: { userId: co.userId }, orderBy: { createdAt: "asc" } }));
  await processSms({ driver: null });

  // Not every notice is texted; the same notice on the same day goes once.
  await withTenant(co.companyId, co.userId, async (tx) => {
    await notify(tx, co.userId, { kind: "reel.liked", title: "Someone liked your reel" });
    await notify(tx, co.userId, { kind: "inspection.confirmed", title: "Inspection confirmed", body: "Friday 10:00", link: "/me/inspections/x1" });
    await notify(tx, co.userId, { kind: "inspection.confirmed", title: "Inspection confirmed", body: "Friday 10:00", link: "/me/inspections/x1" });
  });
  assert.equal((await rows()).length, 1);

  // SMS off: skipped, nothing sent.
  const r1 = recorder(() => ({ ok: true, id: "a" }));
  await processSms({ driver: r1.driver });
  assert.equal(r1.sent.length, 0);
  assert.equal((await rows())[0].status, "SKIPPED");

  // Turning it on needs a number; a bad number is refused with a plain message.
  await assert.rejects(savePrefs(co.userId, { ...base, smsImportant: true, phone: "" }), /mobile number/);
  await assert.rejects(savePrefs(co.userId, { ...base, smsImportant: true, phone: "12" }), /country code/);
  await savePrefs(co.userId, { ...base, smsImportant: true, phone: "0803 123 4567" });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: co.userId } })).phone, "+2348031234567");

  await withTenant(co.companyId, co.userId, (tx) => notify(tx, co.userId, { kind: "inspection.reminder", title: "Inspection tomorrow", link: "/me/inspections/x2" }));
  await processSms({ driver: r1.driver });
  assert.ok(r1.sent.some((s) => s.to === "+2348031234567" && s.body === "Inspection tomorrow"));
  assert.equal((await rows()).find((r) => r.kind === "inspection.reminder")!.status, "SENT");

  // In quiet hours an ordinary notice waits; a security notice does not.
  const tz = (await prisma.user.findUniqueOrThrow({ where: { id: co.userId }, select: { timeZone: true } })).timeZone;
  const h = lagosHour(new Date(), tz || undefined);
  await savePrefs(co.userId, { ...base, quietStart: h, quietEnd: (h + 2) % 24, smsImportant: true });
  await withTenant(co.companyId, co.userId, async (tx) => {
    await notify(tx, co.userId, { kind: "billing.failed", title: "Your payment failed", link: "/me/billing" });
    await notify(tx, co.userId, { kind: "security.password_changed", title: "Your password was changed", link: "/me/security" });
  });
  const r2 = recorder(() => ({ ok: true, id: "b" }));
  await processSms({ driver: r2.driver });
  const mine = (b: string) => r2.sent.filter((s) => s.to === "+2348031234567" && s.body === b).length;
  assert.equal(mine("Your password was changed"), 1);
  assert.equal(mine("Your payment failed"), 0);
  assert.equal((await rows()).find((r) => r.kind === "billing.failed")!.status, "QUEUED");

  // A provider outage is retried later; a refusal is final.
  await savePrefs(co.userId, { ...base, smsImportant: true });
  const r3 = recorder(() => ({ ok: false, permanent: false, error: "503" }));
  const later = new Date(Date.now() + 3 * 3600_000);
  await processSms({ driver: r3.driver, now: later });
  const failed = (await rows()).find((r) => r.kind === "billing.failed")!;
  assert.equal(failed.status, "FAILED");
  assert.ok(failed.nextAttemptAt > later);
  const r4 = recorder(() => ({ ok: false, permanent: true, error: "400 invalid number" }));
  await processSms({ driver: r4.driver, now: new Date(Date.now() + 12 * 3600_000) });
  assert.equal((await rows()).find((r) => r.kind === "billing.failed")!.status, "DEAD");
});

test("the provider settings: platform admin only, checked, secrets never shown whole", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("smsadmin");
  await assert.rejects(saveSmsConfig(co.userId, { provider: "none" }), /platform administrator/);
  await assert.rejects(saveSmsConfig(admin.id, { provider: "twilio", twilioSid: "nope" }), /Account SID/);
  await assert.rejects(saveSmsConfig(admin.id, { provider: "termii", termiiKey: "k", termiiSender: "x" }), /sender ID/);
  await saveSmsConfig(admin.id, { provider: "termii", termiiKey: "TL-secret-key-1234", termiiSender: "Housy" });
  const shown = await smsConfigForAdmin();
  assert.equal(shown.termiiKeyTail, "…1234");
  assert.ok(!JSON.stringify(shown).includes("TL-secret"));
  // Saving again without the key keeps it.
  await saveSmsConfig(admin.id, { provider: "termii", termiiSender: "Housy2" });
  assert.equal((await smsConfigForAdmin()).termiiKeyTail, "…1234");
  await saveSmsConfig(admin.id, { provider: "none" });
});

test("a review link can be texted to the client, with one reminder after three days", async () => {
  const co = await newCompany("smsreview");
  const tag = Math.random().toString(36).slice(2, 8);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Text Homes ${tag}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: "Text Agent", headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  const asset = await createAsset(co, { name: `House ${tag}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const phone = `0803${Math.floor(1000000 + Math.random() * 8999999)}`;
  const client = await createClient(co, { name: `Bola ${tag}`, phone } as never);
  const deal = await createDeal(co, { clientId: client.id, assetId: asset.id, type: "SALE", asking: "50,000,000" });
  await withTenant(co.companyId, co.userId, (tx) => tx.deal.update({ where: { id: deal.id }, data: { stage: "COMPLETED", status: "COMPLETED", agreedKobo: 4_800_000_000n, completedAt: new Date(), completedById: co.membershipId } }));
  const inv = await issueInvite(co, { basis: "TRANSACTION", basisRef: deal.id });

  await assert.rejects(sendInviteToClient(co, { basis: "TRANSACTION", basisRef: deal.id, token: inv.token, email: true, sms: false }), /no email address/);
  assert.deepEqual(await sendInviteToClient(co, { basis: "TRANSACTION", basisRef: deal.id, token: inv.token, email: false, sms: true }), ["text"]);
  const to = `+234${phone.slice(1)}`;
  const texts = () => system((tx) => tx.smsOutbox.findMany({ where: { companyId: co.companyId, toPhone: to }, orderBy: { createdAt: "asc" } }));
  const first = await texts();
  assert.equal(first.length, 1);
  assert.ok(first[0].body.includes(inv.token), "the text carries the link");
  const row = await system((tx) => tx.reviewInvite.findFirstOrThrow({ where: { companyId: co.companyId, basisRef: deal.id } }));
  assert.equal(row.sentVia, "text");
  assert.ok(row.sealedToken && !row.sealedToken.includes(inv.token), "the link is kept encrypted");

  // Not yet three days: no reminder. After three days: one, and never a second.
  await sendReviewReminders(new Date(Date.now() + 864e5));
  assert.equal((await texts()).length, 1);
  await sendReviewReminders(new Date(Date.now() + 4 * 864e5));
  await sendReviewReminders(new Date(Date.now() + 5 * 864e5));
  const all = await texts();
  assert.equal(all.length, 2);
  assert.match(all[1].body, /^Reminder:/);
  const after3 = await system((tx) => tx.reviewInvite.findFirstOrThrow({ where: { id: row.id } }));
  assert.ok(after3.remindedAt);
  assert.equal(after3.sealedToken, null, "the link is not kept once the reminder has gone");
});
