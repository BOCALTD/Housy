/**
 * Housy outside Nigeria: a business's country sets its currency; it records bank details the way its country's banks need them;
 * clients pay it through Stripe (outside Paystack's countries) less Housy's commission; Stripe's signed messages settle payments
 * once; plans are invoiced in the workspace's currency when the administrator has priced them in it; and the books keep each
 * currency apart. Stripe is a fake that answers like the real API.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { prisma, withPlatformAdmin, withTenant } from "../../src/lib/db";
import { changeBusinessCountry } from "../../src/lib/services/business-region";
import { forgetPlatformConfig, saveCommission } from "../../src/lib/services/platform-config";
import { connectStripe, paymentForPayer, paymentSettings, requestOtherPayment, saveBankAccount, startOnlinePayment } from "../../src/lib/services/client-payments";
import { createSubscriptionInvoice, receiveProviderEvent, startPayment } from "../../src/lib/services/billing";
import { savePlan, setPlanPrices } from "../../src/lib/services/subscriptions";
import { balances } from "../../src/lib/services/finance";
import { newCompany, newPlatformAdmin } from "./helpers";
import { registerSeeker } from "../../src/lib/services/community";
import { setMyRegion, setWorkspaceTimeZone, companyTimeZone } from "../../src/lib/services/business-region";
import { saveLiveChat, platformConfig } from "../../src/lib/services/platform-config";

const SK = "sk_test_" + "stripeFakeStripeFake1234";
const WH = "whsec_" + "fakeFakeFakeFakeFake1234";
const realFetch = globalThis.fetch;
const sent: { path: string; body: string }[] = [];
let accountReady = false;

before(() => {
  process.env.STRIPE_SECRET_KEY = SK;
  process.env.STRIPE_WEBHOOK_SECRET = WH;
  forgetPlatformConfig();
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.hostname, "api.stripe.com", "only Stripe is called");
    const body = String(init?.body ?? "");
    sent.push({ path: u.pathname, body });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (u.pathname === "/v1/accounts" && init?.method === "POST") return ok({ id: "acct_fake123" });
    if (u.pathname === "/v1/accounts/acct_fake123") return ok({ id: "acct_fake123", charges_enabled: accountReady, payouts_enabled: accountReady });
    if (u.pathname === "/v1/account_links") return ok({ url: "https://connect.stripe.com/setup/e/acct_fake123/abc" });
    if (u.pathname === "/v1/checkout/sessions") return ok({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    return new Response(JSON.stringify({ error: { message: "not faked" } }), { status: 404 });
  }) as typeof fetch;
});
after(async () => { globalThis.fetch = realFetch; delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; forgetPlatformConfig(); await prisma.$disconnect(); });

/** A message as Stripe signs it. */
function stripeEvent(o: { id: string; reference: string; amount: number; currency: string }) {
  const raw = JSON.stringify({ id: `evt_${o.id}`, type: "payment_intent.succeeded", data: { object: { id: `pi_${o.id}`, amount: o.amount, amount_received: o.amount, currency: o.currency, metadata: { reference: o.reference } } } });
  const t = Math.floor(Date.now() / 1000);
  return { raw, sig: `t=${t},v1=${createHmac("sha256", WH).update(`${t}.${raw}`).digest("hex")}` };
}
const token = (link: string) => link.replace("/pay/", "");
const formValue = (body: string, key: string) => new URLSearchParams(body).get(key);

test("a US business takes dollar payments through its Stripe account, less Housy's commission, settled once from Stripe's signed message", async () => {
  const admin = await newPlatformAdmin();
  await saveCommission(admin.id, { RENT: "5", INSPECTION: "10", OTHER: "2.5" });
  const co = await newCompany("intl-us");
  const r = await changeBusinessCountry(co, "US");
  assert.ok("currency" in r && r.currency === "USD");
  assert.deepEqual(await withTenant(co.companyId, co.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: co.companyId }, select: { country: true, currency: true } })), { country: "US", currency: "USD" });

  // Bank details the way US banks need them.
  await assert.rejects(saveBankAccount(co, { bankName: "Chase", accountName: "Ada Homes LLC", routingNumber: "021000022", accountNumber: "123456789" }), /routing number does not check/);
  await saveBankAccount(co, { bankName: "Chase", accountName: "Ada Homes LLC", routingNumber: "021000021", accountNumber: "123456789" });
  let info = await paymentSettings(co);
  assert.equal(info.provider, "STRIPE");
  assert.equal(info.online, false, "card payments wait until Stripe has checked the business");
  assert.ok(info.lines.some((l) => l.label === "Routing number (ABA)" && l.value === "021000021"));

  const setup = await connectStripe(co, "https://housy.test/app/payments");
  assert.ok(setup.startsWith("https://connect.stripe.com/"));
  assert.equal(formValue(sent.find((s) => s.path === "/v1/accounts")!.body, "country"), "US");
  accountReady = true;
  info = await paymentSettings(co);
  assert.equal(info.online, true, "Stripe has checked the business");

  const req = await requestOtherPayment(co, { description: "Security deposit", amount: "$2,000", payerName: "Sam" });
  assert.equal(req.payment.currency, "USD");
  assert.equal(req.payment.amountKobo, 200_000n);
  assert.equal(req.payment.commissionKobo, 5_000n, "2.5% of $2,000 is $50");
  const view = (await paymentForPayer(token(req.link)))!;
  assert.equal(view.currency, "USD");
  assert.equal(view.provider, "STRIPE");
  assert.ok(view.transfer?.lines.some((l) => l.label === "Routing number (ABA)"));

  const url = await startOnlinePayment(token(req.link), { name: "Sam", email: "sam@example.test" }, "https://housy.test");
  assert.ok(url.startsWith("https://checkout.stripe.com/"));
  const checkout = sent.filter((s) => s.path === "/v1/checkout/sessions").pop()!.body;
  assert.equal(formValue(checkout, "payment_intent_data[application_fee_amount]"), "5000", "Housy's commission");
  assert.equal(formValue(checkout, "payment_intent_data[transfer_data][destination]"), "acct_fake123", "the rest goes to the business");
  assert.equal(formValue(checkout, "line_items[0][price_data][currency]"), "usd");
  const reference = formValue(checkout, "metadata[reference]")!;

  // An unsigned or tampered message changes nothing.
  const good = stripeEvent({ id: "1", reference, amount: 200_000, currency: "usd" });
  assert.notEqual((await receiveProviderEvent(good.raw, "t=1,v1=00")).status, 200, "Paystack's door does not take Stripe's messages");
  assert.equal((await receiveProviderEvent(good.raw.replace("200000", "100"), good.sig, undefined, "STRIPE")).status, 401);
  // The wrong currency is never counted as paid.
  const wrong = stripeEvent({ id: "2", reference, amount: 200_000, currency: "gbp" });
  assert.equal((await receiveProviderEvent(wrong.raw, wrong.sig, undefined, "STRIPE")).body.outcome, "AMOUNT_MISMATCH");
  const first = await receiveProviderEvent(good.raw, good.sig, undefined, "STRIPE");
  assert.equal(first.body.outcome, "SETTLED");
  assert.equal((await receiveProviderEvent(good.raw, good.sig, undefined, "STRIPE")).body.duplicate, true, "a repeated message changes nothing");
  const paid = await withTenant(co.companyId, co.userId, (tx) => tx.clientPayment.findUniqueOrThrow({ where: { id: req.payment.id } }));
  assert.equal(paid.status, "PAID");
  assert.equal(paid.provider, "STRIPE");
  const entry = await withPlatformAdmin(admin.id, (tx) => tx.financeEntry.findFirstOrThrow({ where: { entryKey: `cp:${req.payment.id}` } }));
  assert.equal(entry.currency, "USD");
  assert.equal(entry.amountKobo, 5_000n);
  const books = await balances(admin.id);
  const commission = books.find((b) => b.ledger === "COMMISSION")!;
  assert.ok(commission.other.some((o) => o.currency === "USD" && o.accounts.find((a) => a.account === "REVENUE")!.kobo >= 5_000n), "dollars are kept apart from naira");

  // Moving country is refused while a dollar payment link is waiting.
  await requestOtherPayment(co, { description: "Service charge", amount: "150", payerName: "Sam" });
  await assert.rejects(changeBusinessCountry(co, "GB"), /waiting payment link/);
});

test("a workspace pays its plan in its own currency when the plan is priced in it, through the provider for its country", async () => {
  const admin = await newPlatformAdmin();
  const plan = await savePlan(admin.id, null, { code: `intl-${Date.now().toString(36)}`, name: "Pro abroad", audience: "COMPANY", price: "25,000", billingPeriod: "MONTHLY", trialDays: "0", graceDays: "7", readOnlyDays: "30", active: true, sortOrder: "500", tier: "SILVER" } as never);
  await assert.rejects(setPlanPrices(admin.id, plan.id, { USD: "abc" }), /US dollar/);
  await setPlanPrices(admin.id, plan.id, { USD: "49", GBP: "" });
  const us = await newCompany("intl-plan-us");
  await changeBusinessCountry(us, "US");
  const inv = await createSubscriptionInvoice({ userId: us.userId, companyId: us.companyId, role: "COMPANY_SUPER_ADMIN" }, plan.id);
  assert.equal(inv.currency, "USD");
  assert.equal(inv.amountKobo, 4_900n);
  const started = await startPayment({ userId: us.userId, companyId: us.companyId, role: "COMPANY_SUPER_ADMIN" }, inv.id, "https://housy.test/app/billing");
  assert.ok(started.checkoutUrl.startsWith("https://checkout.stripe.com/"));
  const pay = await withPlatformAdmin(admin.id, (tx) => tx.payment.findUniqueOrThrow({ where: { ref: started.paymentRef } }));
  assert.equal(pay.provider, "STRIPE");
  const ev = stripeEvent({ id: `plan-${inv.id.slice(0, 8)}`, reference: pay.providerRef ?? "", amount: 4_900, currency: "usd" });
  assert.equal((await receiveProviderEvent(ev.raw, ev.sig, undefined, "STRIPE")).body.outcome, "APPLIED");
  assert.equal((await withPlatformAdmin(admin.id, (tx) => tx.invoice.findUniqueOrThrow({ where: { id: inv.id } }))).status, "PAID");

  // Without a price in its currency, a workspace pays the naira price.
  const gb = await newCompany("intl-plan-gb");
  await changeBusinessCountry(gb, "GB");
  const gbInv = await createSubscriptionInvoice({ userId: gb.userId, companyId: gb.companyId, role: "COMPANY_SUPER_ADMIN" }, plan.id);
  assert.equal(gbInv.currency, "NGN");
  assert.equal(gbInv.amountKobo, plan.priceKobo);
});

test("a person outside Nigeria pays their own plan in their currency, and cannot switch country with an invoice unpaid", async () => {
  const admin = await newPlatformAdmin();
  const plan = await savePlan(admin.id, null, { code: `seek-${Date.now().toString(36)}`, name: "Pro seeker abroad", audience: "SEEKER", price: "5,000", billingPeriod: "MONTHLY", trialDays: "0", graceDays: "7", readOnlyDays: "30", active: true, sortOrder: "510", tier: "SILVER" } as never);
  await setPlanPrices(admin.id, plan.id, { GBP: "4.99" });
  const uk = await registerSeeker({ name: "Ada in London", email: `ada-uk-${Date.now()}@example.test`, password: "integration-test-pw", country: "GB" });
  const payer = { userId: uk.userId, companyId: null, role: null };
  const inv = await createSubscriptionInvoice(payer, plan.id);
  assert.deepEqual([inv.currency, inv.amountKobo], ["GBP", 499n]);
  await assert.rejects(setMyRegion(uk.userId, { country: "NG", timeZone: "" }), /unpaid invoice/);
  await setMyRegion(uk.userId, { country: "GB", timeZone: "Europe/London" });
  await assert.rejects(setMyRegion(uk.userId, { country: "GB", timeZone: "Mars/Olympus" }), /time zone/);
  const started = await startPayment(payer, inv.id, "https://housy.test/me/billing");
  assert.ok(started.checkoutUrl.startsWith("https://checkout.stripe.com/"), "the UK is served by Stripe");
  const checkout = sent.filter((x) => x.path === "/v1/checkout/sessions").pop()!.body;
  assert.equal(formValue(checkout, "line_items[0][price_data][currency]"), "gbp");
  const ng = await registerSeeker({ name: "Ada in Lagos", email: `ada-ng-${Date.now()}@example.test`, password: "integration-test-pw" });
  const ngInv = await createSubscriptionInvoice({ userId: ng.userId, companyId: null, role: null }, plan.id);
  assert.deepEqual([ngInv.currency, ngInv.amountKobo], ["NGN", 500_000n]);
});

test("a workspace keeps its own time zone, and the live chat is configured by the administrator with a real widget ID", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("intl-tz");
  await changeBusinessCountry(co, "US");
  assert.equal(await companyTimeZone(co.companyId), "America/New_York", "the country's usual time zone");
  await assert.rejects(setWorkspaceTimeZone(co, "Nowhere/Land"), /time zone/);
  await setWorkspaceTimeZone(co, "America/Los_Angeles");
  assert.equal(await companyTimeZone(co.companyId), "America/Los_Angeles");

  await assert.rejects(saveLiveChat(admin.id, { provider: "crisp", id: "not-an-id", places: ["public"] }), /Crisp widget ID/);
  await assert.rejects(saveLiveChat(admin.id, { provider: "crisp", id: "1a2b3c4d-1234-5678-9abc-1234567890ab", places: [] }), /at least one place/);
  await assert.rejects(saveLiveChat(co.userId, { provider: "crisp", id: "1a2b3c4d-1234-5678-9abc-1234567890ab", places: ["public"] }), /platform administrator/);
  await saveLiveChat(admin.id, { provider: "crisp", id: "1A2B3C4D-1234-5678-9ABC-1234567890AB", places: ["public", "me"] });
  assert.deepEqual((await platformConfig()).liveChat, { provider: "crisp", id: "1a2b3c4d-1234-5678-9abc-1234567890ab", places: ["public", "me"] });
  await saveLiveChat(admin.id, { provider: "none", id: "", places: [] });
  assert.equal((await platformConfig()).liveChat.provider, "none");
});
