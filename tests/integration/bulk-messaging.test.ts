/**
 * Bulk messaging: only on plans that include it, only to consenting clients or current tenants, limited, and every recipient can
 * stop the company's messages for good.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import { createClient } from "../../src/lib/services/crm";
import { assignSubscription } from "../../src/lib/services/subscriptions";
import { bulkOverview, bulkUnsubscribeUrl, cancelBulk, optOutBulk, previewAudience, processBulk, sendBulk } from "../../src/lib/services/bulk-messaging";
import type { EmailDriver, Outgoing } from "../../src/lib/email-drivers";
import { newCompany, newPlatformAdmin, relativeDate, withRole } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
function recorder(fail: (m: Outgoing) => false | "retry" | "permanent" = () => false) {
  const sent: Outgoing[] = [];
  const driver: EmailDriver = { name: "test", async send(m) { const f = fail(m); if (f) return { ok: false, permanent: f === "permanent", error: "boom" }; sent.push(m); return { ok: true, id: `id-${sent.length}` }; } };
  return { sent, driver };
}

async function elite(label: string) {
  const admin = await newPlatformAdmin();
  const co = await newCompany(label);
  const gold = await withPlatformAdmin(admin.id, (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } }));
  await assignSubscription(admin.id, { planId: gold.id, periodEnd: relativeDate(60), companyId: co.companyId });
  return { admin, co };
}

test("only a plan with bulk messaging can send, and only managers and administrators", async () => {
  const basic = await newCompany("bulkbasic");
  await createClient(basic, { name: "Client One", email: `one-${uid()}@example.test`, marketingConsent: true } as never);
  assert.equal((await bulkOverview(basic)).allowance.allowed, false);
  await assert.rejects(sendBulk(basic, { audience: "CLIENTS", subject: "Hello there", body: "A message for everyone." }), /not on your plan/);
  const { co } = await elite("bulkperm");
  await assert.rejects(sendBulk(withRole(co, "AGENT"), { audience: "CLIENTS", subject: "Hello there", body: "A message for everyone." }), /permission/i);
});

test("clients who agreed and current tenants get one email each; opting out stops it for good", async () => {
  const { co } = await elite("bulksend");
  const tag = uid();
  await createClient(co, { name: "Consenting Ada", email: `ada-${tag}@example.test`, marketingConsent: true } as never);
  await createClient(co, { name: "Consenting Bola", email: `BOLA-${tag}@example.test`, marketingConsent: true } as never);
  await createClient(co, { name: "No consent", email: `nope-${tag}@example.test`, marketingConsent: false } as never);
  await createClient(co, { name: "No email", phone: "0803 000 0000", marketingConsent: true } as never);
  const asset = await createAsset(co, { name: "Block A", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await createLease(co, asset.id, { occupantName: "Tenant Tolu", occupantContact: `0803 111 2222, tolu-${tag}@example.test`, startDate: relativeDate(-30), endDate: relativeDate(300), rent: "1,000,000", frequency: "YEARLY" } as never);

  assert.deepEqual(await previewAudience(co, { audience: "CLIENTS" }), { recipients: 2, noEmail: 1, optedOut: 0 });
  assert.deepEqual(await previewAudience(co, { audience: "TENANTS" }), { recipients: 1, noEmail: 0, optedOut: 0 });
  await assert.rejects(sendBulk(co, { audience: "CLIENTS", subject: "Hi", body: "Too short subject" }), /subject/);

  const b = await sendBulk(co, { audience: "CLIENTS", subject: "New homes in Lekki", body: "We have new homes.\n\nCall us to view." });
  assert.equal(b.recipients, 2);
  // Nothing is sent without an email provider; nothing is marked as sent either.
  const none = await processBulk({ driver: null });
  assert.equal(none.configured, false);
  assert.ok(none.waiting >= 2);

  const r = recorder();
  await processBulk({ driver: r.driver });
  const mine = r.sent.filter((m) => m.to.endsWith(`${tag}@example.test`));
  assert.deepEqual(mine.map((m) => m.to).sort(), [`ada-${tag}@example.test`, `bola-${tag}@example.test`]);
  assert.match(mine[0].subject, /: New homes in Lekki$/);
  assert.ok(mine[0].headers?.["List-Unsubscribe"]?.includes("/api/unsubscribe/company?t="));
  assert.equal(mine[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const view = await bulkOverview(co);
  assert.equal(view.history[0].status, "SENT");
  assert.equal(view.history[0].tally.SENT, 2);
  assert.equal(view.used, 2);
  // Running again sends nothing twice.
  const again = recorder();
  await processBulk({ driver: again.driver });
  assert.equal(again.sent.filter((m) => m.to.endsWith(`${tag}@example.test`)).length, 0);

  // Ada stops the company's messages from the link in her email.
  const link = new URL(bulkUnsubscribeUrl(co.companyId, `ada-${tag}@example.test`));
  const done = await optOutBulk(link.searchParams.get("t")!);
  assert.equal(done.email, `ada-${tag}@example.test`);
  await assert.rejects(optOutBulk("forged.token"), /not valid/);
  assert.deepEqual(await previewAudience(co, { audience: "CLIENTS" }), { recipients: 1, noEmail: 1, optedOut: 1 });
  // The company can see the opt-out but cannot remove it.
  await assert.rejects(withTenant(co.companyId, co.userId, (tx) => tx.bulkOptOut.deleteMany({ where: { companyId: co.companyId } })).then((n) => { if (n.count === 0) throw new Error("not removed"); }));

  // Tenants of current leases, by property.
  const t = await sendBulk(co, { audience: "TENANTS", assetId: asset.id, subject: "Water off Saturday", body: "The water will be off from 8am to noon." });
  assert.equal(t.recipients, 1);
  const r2 = recorder();
  await processBulk({ driver: r2.driver });
  const tolu = r2.sent.find((m) => m.to === `tolu-${tag}@example.test`)!;
  assert.match(tolu.text, /^Hello Tenant Tolu,/);
  assert.match(tolu.text, /rent a property managed by/);
});

test("a send can be stopped, an opt-out reaches emails still waiting, failures are retried and the monthly limit holds", async () => {
  const { admin, co } = await elite("bulklimit");
  const tag = uid();
  for (let i = 0; i < 4; i++) await createClient(co, { name: `Client ${i}`, email: `c${i}-${tag}@example.test`, marketingConsent: true } as never);
  const b = await sendBulk(co, { audience: "CLIENTS", subject: "First message", body: "Hello to all of our clients." });
  // c0 opts out before anything goes; c1 fails once; the rest go.
  await optOutBulk(new URL(bulkUnsubscribeUrl(co.companyId, `c0-${tag}@example.test`)).searchParams.get("t")!);
  let tries = 0;
  const r = recorder((m) => (m.to === `c1-${tag}@example.test` && tries++ === 0 ? "retry" : false));
  const run = await processBulk({ driver: r.driver });
  assert.ok(run.retrying >= 1);
  assert.equal(r.sent.filter((m) => m.to.endsWith(tag + "@example.test")).length, 2);
  assert.equal((await bulkOverview(co)).history[0].status, "SENDING");
  const later = recorder();
  await processBulk({ driver: later.driver, now: new Date(Date.now() + 10 * 60_000) });
  assert.ok(later.sent.some((m) => m.to === `c1-${tag}@example.test`));
  const h = (await bulkOverview(co)).history.find((x) => x.id === b.id)!;
  assert.equal(h.status, "SENT");
  assert.equal(h.tally.SKIPPED, 1);

  // Stopping a send: nothing more goes.
  const s = await sendBulk(co, { audience: "CLIENTS", subject: "Second message", body: "Another note for our clients." });
  assert.equal(await cancelBulk(co, s.id), 3);
  await assert.rejects(cancelBulk(co, s.id), /finished/);
  const none = recorder();
  await processBulk({ driver: none.driver });
  assert.equal(none.sent.filter((m) => m.subject.endsWith("Second message")).length, 0);

  // The plan's monthly number of recipients is enforced.
  await withPlatformAdmin(admin.id, async (tx) => {
    const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } });
    await tx.planEntitlement.updateMany({ where: { planId: plan.id, key: "BULK_MESSAGING" }, data: { limit: 5 } });
  });
  try {
    await assert.rejects(sendBulk(co, { audience: "CLIENTS", subject: "Third message", body: "One more note for our clients." }), /only 1 is left on your plan/);
  } finally {
    await withPlatformAdmin(admin.id, async (tx) => {
      const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-gold" } });
      await tx.planEntitlement.updateMany({ where: { planId: plan.id, key: "BULK_MESSAGING" }, data: { limit: null } });
    });
  }
  // Another company sees none of it.
  const other = await newCompany("bulkother");
  await assert.rejects(cancelBulk({ ...other, role: "COMPANY_SUPER_ADMIN" }, b.id), /not found/);
  assert.equal(await withTenant(other.companyId, other.userId, (tx) => tx.bulkRecipient.count({ where: { bulkId: b.id } })), 0);
});
