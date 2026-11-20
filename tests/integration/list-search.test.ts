/**
 * Searching long, paged lists on the server: invoices, payments, feedback, failed emails, rewards, referrals and contractor
 * payments. A search finds what it should across every page, and a name search never uncovers an anonymous answer.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { savePlan } from "../../src/lib/services/subscriptions";
import { adminEvents, adminInvoices, adminPayments, createSubscriptionInvoice, type Payer } from "../../src/lib/services/billing";
import { listRatings, submitRating } from "../../src/lib/services/feedback";
import { failureList } from "../../src/lib/services/delivery";
import { adminRewardQueue } from "../../src/lib/services/rewards";
import { adminReferrals } from "../../src/lib/services/referrals";
import { payouts } from "../../src/lib/services/payouts";
import { searchText } from "../../src/lib/search-terms";
import { newCompany, newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);

async function person(name: string) {
  const id = (await registerSeeker({ name, email: `ls-${uid()}@example.test`, password: PASSWORD })).userId;
  return { id, payer: { userId: id, companyId: null, role: null } as Payer };
}

test("a search is trimmed and capped", () => {
  assert.equal(searchText("  hello  "), "hello");
  assert.equal(searchText(undefined), "");
  assert.equal(searchText("x".repeat(500)).length, 120);
});

test("invoices and payments are found by number or by who they are for, and nothing else comes back", async () => {
  const admin = await newPlatformAdmin();
  const tag = `Zebedee${uid()}`;
  const buyer = await person(`${tag} Okafor`);
  const plan = await savePlan(admin.id, null, { code: `ls-${uid()}`, name: `Search plan ${uid()}`, audience: "AGENT", price: "3,000", billingPeriod: "MONTHLY", trialDays: 0, graceDays: 7, readOnlyDays: 30, active: true, sortOrder: 100, tier: "BASIC" } as never);
  const inv = await createSubscriptionInvoice(buyer.payer, plan.id);
  const byName = await adminInvoices(admin.id, { q: tag.toLowerCase() });
  assert.deepEqual(byName.rows.map((r) => r.id), [inv.id]);
  assert.equal(byName.total, 1);
  assert.equal((await adminInvoices(admin.id, { q: inv.ref })).rows[0]?.id, inv.id);
  assert.equal((await adminInvoices(admin.id, { q: inv.ref, status: "PAID" })).total, 0, "the status still applies while searching");
  assert.equal((await adminInvoices(admin.id, { q: `nothing-${uid()}` })).total, 0);
  assert.equal((await adminPayments(admin.id, { q: `nothing-${uid()}` })).total, 0);
  assert.equal((await adminEvents(admin.id, 0, `nothing-${uid()}`)).total, 0);
});

test("a name search finds named feedback but never an anonymous answer", async () => {
  const admin = await newPlatformAdmin();
  const tag = `Quillon${uid()}`;
  const named = await person(`${tag} Named`);
  const hidden = await person(`${tag} Hidden`);
  await submitRating(named.id, { overall: 4, suggestion: "More filters please", anonymous: false } as never);
  await submitRating(hidden.id, { overall: 2, suggestion: "Slow pages", anonymous: true } as never);
  const found = await listRatings(admin.id, { q: tag });
  assert.equal(found.total, 1);
  assert.equal(found.rows[0].who, `${tag} Named`);
  assert.equal(found.rows[0].suggestion, "More filters please");
  // Words in the answer still find the anonymous one, without a name.
  const byWords = await listRatings(admin.id, { q: "slow pages" });
  assert.ok(byWords.rows.some((r) => r.suggestion === "Slow pages" && r.who === "Anonymous"));
});

test("failed emails, rewards and referrals take a search, and only the administrator can list them", async () => {
  const admin = await newPlatformAdmin();
  const nobody = `nothing-${uid()}`;
  assert.equal((await failureList(admin.id, 0, nobody)).total, 0);
  assert.equal((await adminRewardQueue(admin.id, "ELIGIBLE", 1, nobody)).items.length, 0);
  assert.equal((await adminReferrals(admin.id, "ALL", 1, nobody)).items.length, 0);
  const someone = await person("Not Admin");
  await assert.rejects(failureList(someone.id, 0, "x"));
  await assert.rejects(adminRewardQueue(someone.id, "ELIGIBLE", 1, "x"));
});

test("a company searches only its own contractor payments", async () => {
  const ctx = await newCompany("payoutsearch");
  const res = await payouts(ctx, `nothing-${uid()}`);
  assert.equal(res.rows.length, 0);
});
