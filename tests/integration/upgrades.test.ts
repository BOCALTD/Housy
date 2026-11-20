/**
 * Upgrades: promo codes take money off the first period (and a full discount switches the plan on with nothing to pay), each code
 * keeps its limits, free trials can be started once per person or company per plan, and only the platform administrator manages codes.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { savePlan, setPlanEntitlements, entitlementIn } from "../../src/lib/services/subscriptions";
import { createSubscriptionInvoice, generateRenewalInvoices, previewPromo, type Payer } from "../../src/lib/services/billing";
import { planFor, promoCodes, savePromoCode, setPromoActive, startTrial, trialsAvailable, upgradeStats } from "../../src/lib/services/upgrades";
import { newCompany, newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const code = (p: string) => `${p}${uid().toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

async function person(): Promise<Payer & { id: string }> {
  const id = (await registerSeeker({ name: `Up ${uid()}`, email: `up-${uid()}@example.test`, password: PASSWORD })).userId;
  return { id, userId: id, companyId: null, role: null };
}
async function plan(admin: { id: string }, o: { audience?: "AGENT" | "COMPANY"; price?: string; trialDays?: number } = {}) {
  const p = await savePlan(admin.id, null, { code: `up-${uid()}`, name: `Up plan ${uid()}`, audience: o.audience ?? "AGENT", price: o.price ?? "10,000", billingPeriod: "MONTHLY", trialDays: o.trialDays ?? 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
  await setPlanEntitlements(admin.id, p.id, [{ key: o.audience === "COMPANY" ? "BULK_MESSAGING" : "COLLAB_SEEKER_AGENT", enabled: true, limit: 3 }]);
  return p;
}
const promo = (adminId: string, o: Partial<Parameters<typeof savePromoCode>[1]> = {}) =>
  savePromoCode(adminId, { code: code("UP"), kind: "percent", percentOff: "25", ...o } as never);

test("a percentage code lowers the invoice and is recorded once it is paid", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin);
  const c = await promo(admin.id);
  const buyer = await person();
  const preview = await previewPromo(buyer, c.code.toLowerCase());
  assert.equal(preview.error, null);
  const row = preview.byPlan[p.id];
  assert.ok(row && "pay" in row);
  assert.equal(row.pay, 750_000n);
  const inv = await createSubscriptionInvoice(buyer, p.id, undefined, ` ${c.code.toLowerCase()} `);
  assert.equal(inv.amountKobo, 750_000n);
  assert.equal(inv.listAmountKobo, 1_000_000n);
  assert.equal(inv.discountKobo, 250_000n);
  assert.equal(inv.status, "OPEN");
  // Asking again with the same code returns the same invoice; without the code it is replaced at full price.
  assert.equal((await createSubscriptionInvoice(buyer, p.id, undefined, c.code)).id, inv.id);
  const full = await createSubscriptionInvoice(buyer, p.id);
  assert.notEqual(full.id, inv.id);
  assert.equal(full.amountKobo, 1_000_000n);
});

test("a code that covers the whole price switches the plan on straight away, once per owner, within its limit", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin);
  const c = await promo(admin.id, { percentOff: "100", maxRedemptions: "2" });
  const a = await person();
  const inv = await createSubscriptionInvoice(a, p.id, undefined, c.code);
  assert.equal(inv.status, "PAID");
  assert.equal(inv.amountKobo, 0n);
  const ent = await withUser(a.id, (tx) => entitlementIn(tx, { kind: "USER", userId: a.id }, "COLLAB_SEEKER_AGENT"));
  assert.equal(ent.access, "FULL");
  assert.equal(await sys((tx) => tx.promoRedemption.count({ where: { promoCodeId: c.id } })), 1);
  await assert.rejects(createSubscriptionInvoice(a, p.id, undefined, c.code), /already used that code/);
  await createSubscriptionInvoice(await person(), p.id, undefined, c.code);
  await assert.rejects(createSubscriptionInvoice(await person(), p.id, undefined, c.code), /used up/);
  const listed = (await promoCodes(admin.id)).find((x) => x.id === c.id)!;
  assert.equal(listed.uses, 2);
});

test("codes keep their plan, date, first-plan and on/off rules", async () => {
  const admin = await newPlatformAdmin();
  const p1 = await plan(admin);
  const p2 = await plan(admin);
  const onlyP1 = await promo(admin.id, { planIds: [p1.id] });
  const buyer = await person();
  await assert.rejects(createSubscriptionInvoice(buyer, p2.id, undefined, onlyP1.code), /not for this plan/);
  await assert.rejects(createSubscriptionInvoice(buyer, p1.id, undefined, "NOSUCHCODE1"), /not right/);
  await setPromoActive(admin.id, onlyP1.id, false);
  await assert.rejects(createSubscriptionInvoice(buyer, p1.id, undefined, onlyP1.code), /no longer active/);
  const later = await promo(admin.id, { startsAt: "2099-01-01" });
  await assert.rejects(createSubscriptionInvoice(buyer, p1.id, undefined, later.code), /cannot be used yet/);
  // First plans only: someone who already paid is refused.
  const first = await promo(admin.id, { newCustomersOnly: true });
  const free = await promo(admin.id, { percentOff: "100" });
  await createSubscriptionInvoice(buyer, p1.id, undefined, free.code);
  await assert.rejects(createSubscriptionInvoice(buyer, p2.id, undefined, first.code), /first plans only/);
});

test("only the platform administrator manages codes, and bad codes are refused in plain words", async () => {
  const admin = await newPlatformAdmin();
  const someone = await person();
  await assert.rejects(savePromoCode(someone.id, { code: "HACKME99", kind: "percent", percentOff: "100" } as never), /Only the platform administrator/);
  await assert.rejects(promoCodes(someone.id), /Only the platform administrator/);
  await assert.rejects(upgradeStats(someone.id), /Only the platform administrator/);
  await assert.rejects(promo(admin.id, { code: "AB" }), /at least 4/);
  await assert.rejects(promo(admin.id, { percentOff: "150" }), /1 to 100/);
  await assert.rejects(promo(admin.id, { kind: "amount", amountOff: "0" } as never), /amount the code takes off/);
  await assert.rejects(promo(admin.id, { endsAt: "2020-01-01" }), /already passed/);
  const c = await promo(admin.id);
  await assert.rejects(promo(admin.id, { code: c.code.toLowerCase() }), /already exists/);
  // The database itself refuses a code with both kinds of discount.
  await assert.rejects(sys((tx) => tx.promoCode.create({ data: { code: code("BOTH"), percentOff: 10, amountOffMinor: 100n, createdById: admin.id } })));
});

test("a free trial switches the plan on once per owner and plan, and counts in the numbers", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin, { trialDays: 14 });
  const noTrial = await plan(admin);
  const buyer = await person();
  assert.equal((await trialsAvailable(buyer))[p.id], 14);
  assert.equal((await trialsAvailable(buyer))[noTrial.id], undefined);
  await assert.rejects(startTrial(buyer, noTrial.id), /not available/);
  const t = await startTrial(buyer, p.id);
  assert.equal(t.days, 14);
  const sub = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: buyer.id } }));
  assert.equal(sub.status, "TRIAL");
  assert.ok(Math.abs(sub.periodEnd.getTime() - (Date.now() + 14 * 864e5)) < 60_000);
  const ent = await withUser(buyer.id, (tx) => entitlementIn(tx, { kind: "USER", userId: buyer.id }, "COLLAB_SEEKER_AGENT"));
  assert.equal(ent.access, "FULL");
  await assert.rejects(startTrial(buyer, p.id), /not available/);
  assert.equal((await trialsAvailable(buyer))[p.id], undefined);
  const stats = await upgradeStats(admin.id);
  assert.ok(stats.trials >= 1);
});

test("a company's trial needs the administrator, and the cheapest plan with a feature is offered where it is locked", async () => {
  const admin = await newPlatformAdmin();
  const cheap = await plan(admin, { audience: "COMPANY", price: "2,000", trialDays: 7 });
  await plan(admin, { audience: "COMPANY", price: "90,000" });
  const ctx = await newCompany("Upgrades");
  await assert.rejects(startTrial({ userId: ctx.userId, companyId: ctx.companyId, role: "AGENT" as never }, cheap.id));
  await startTrial({ userId: ctx.userId, companyId: ctx.companyId, role: ctx.role }, cheap.id);
  const found = await planFor("BULK_MESSAGING", "COMPANY");
  assert.ok(found && (found.priceKobo ?? 0n) <= 200_000n);
});

test("people cannot read promo codes, redemptions or trial records directly", async () => {
  const admin = await newPlatformAdmin();
  await promo(admin.id);
  const someone = await person();
  const seen = await withUser(someone.id, async (tx) => [await tx.promoCode.count(), await tx.promoRedemption.count(), await tx.trialUse.count()]);
  assert.deepEqual(seen, [0, 0, 0]);
});

test("a trial is reminded 3 days before it ends, with the invoice to pay, and loses its features (not its records) when it ends unpaid", async () => {
  const admin = await newPlatformAdmin();
  const p = await plan(admin, { trialDays: 14 });
  const buyer = await person();
  await startTrial(buyer, p.id);
  const sub = await sys((tx) => tx.subscription.findFirstOrThrow({ where: { ownerUserId: buyer.id } }));
  const invoices = () => sys((tx) => tx.invoice.findMany({ where: { ownerUserId: buyer.id, purpose: "SUBSCRIPTION" } }));
  const told = () => withUser(buyer.id, (tx) => tx.notification.findMany({ where: { userId: buyer.id, kind: "billing.renewal" }, orderBy: { createdAt: "asc" } }));
  // On the day the trial starts, nothing is asked.
  await generateRenewalInvoices({ now: new Date() });
  assert.equal((await invoices()).length, 0);
  assert.equal((await told()).length, 0);
  // Two days before the end: one invoice for the plan, and a reminder that links straight to it.
  const near = new Date(sub.periodEnd.getTime() - 2 * 864e5 + 60_000);
  await generateRenewalInvoices({ now: near });
  await generateRenewalInvoices({ now: near });
  const inv = await invoices();
  assert.equal(inv.length, 1);
  assert.equal(inv[0].amountKobo, 1_000_000n);
  assert.match(inv[0].description, /after the free trial/);
  const n = await told();
  assert.equal(n.length, 1, "each stage is told once");
  assert.match(n[0].title, /free trial of .* ends in 2 days/);
  assert.equal(n[0].link, `/me/billing/${inv[0].id}`);
  // A day after it ends, unpaid: read-only (no grace for a trial), and the "trial has ended" notice goes once.
  const after = new Date(sub.periodEnd.getTime() + 864e5);
  await generateRenewalInvoices({ now: after });
  assert.match((await told()).at(-1)!.title, /free trial of .* has ended/);
  const ent = await withUser(buyer.id, (tx) => entitlementIn(tx, { kind: "USER", userId: buyer.id }, "COLLAB_SEEKER_AGENT", after));
  assert.equal(ent.access, "READ_ONLY");
});
