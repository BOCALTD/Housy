import { test } from "node:test";
import assert from "node:assert/strict";
import { paystackProvider, stripeProvider } from "../../src/lib/payment-providers";
import { cardLabel, cardValidOn } from "../../src/lib/services/auto-renew";
import { renewalMessage } from "../../src/lib/billing-rules";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("cards are named plainly and work to the end of their expiry month", () => {
  assert.equal(cardLabel({ brand: "visa", last4: "4242" }), "Visa ending 4242");
  assert.equal(cardLabel({ brand: "", last4: "0001" }), "Card ending 0001");
  assert.equal(cardValidOn({ expMonth: 12, expYear: 2026 }, new Date("2026-12-31T20:00:00Z")), true);
  assert.equal(cardValidOn({ expMonth: 11, expYear: 2026 }, new Date("2026-12-01T00:00:00Z")), false);
});

test("renewal reminders name the card and the amount when the plan renews by itself", () => {
  assert.deepEqual(renewalMessage({ planName: "Pro", stage: "NOTICE", trial: false, days: 3, amount: "₦8,000", card: "Visa ending 4242" }),
    { title: "Your Pro plan renews in 3 days", body: "We will charge ₦8,000 to your Visa ending 4242. To change this, turn off automatic renewal in Billing before then." });
  assert.equal(renewalMessage({ planName: "Pro", stage: "LAST_DAY", trial: false, days: 1, amount: "x", card: "Visa ending 4242" }).title, "Your Pro plan renews today");
  assert.match(renewalMessage({ planName: "Pro", stage: "NOTICE", trial: false, days: 3, amount: "₦8,000", expiredCard: true }).body, /saved card will have expired/);
  // A trial never mentions a card; an overdue plan asks to pay.
  assert.match(renewalMessage({ planName: "Pro", stage: "NOTICE", trial: true, days: 3, amount: "x", card: "Visa ending 4242" }).title, /free trial/);
  assert.match(renewalMessage({ planName: "Pro", stage: "OVERDUE", trial: false, days: 0, amount: "₦8,000", card: "Visa ending 4242" }).body, /Pay ₦8,000 now/);
});

test("Paystack: a reusable card is kept after a card payment, and charging it uses the authorisation", async () => {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).includes("/transaction/verify/")) return json({ status: true, data: { status: "success", amount: 800000, currency: "NGN", authorization: { authorization_code: "AUTH_x1", reusable: true, channel: "card", last4: "4081", exp_month: "12", exp_year: "2030", brand: "visa" }, customer: { email: "a@b.test", customer_code: "CUS_1" } } });
    if (String(url).endsWith("/transaction/charge_authorization")) return json({ status: true, data: { status: "success", amount: 800000, currency: "NGN", id: 99, gateway_response: "Approved" } });
    return json({ status: false }, 404);
  }) as typeof fetch;
  const p = paystackProvider("sk_test", fetchImpl);
  const card = await p.cardFor!("PAY-1");
  assert.deepEqual(card, { token: "AUTH_x1", customer: "CUS_1", last4: "4081", brand: "visa", expMonth: 12, expYear: 2030, email: "a@b.test" });
  const r = await p.chargeCard!({ reference: "PAY-2", amountKobo: 800000n, currency: "NGN", card: { token: "AUTH_x1", customer: "CUS_1", email: "a@b.test" }, description: "Pro renewal" });
  assert.deepEqual(r, { ok: true, status: "success", amountKobo: 800000n, currency: "NGN", providerTxId: "99", message: "Approved" });
  const charge = calls.find((c) => c.url.endsWith("/charge_authorization"))!.body!;
  assert.equal(charge.authorization_code, "AUTH_x1");
  assert.equal(charge.reference, "PAY-2");
  assert.equal(charge.amount, 800000);
});

test("Paystack: a bank transfer or a card that cannot be reused is not kept; a declined charge is a failure", async () => {
  const notReusable = (async () => json({ status: true, data: { status: "success", amount: 100, authorization: { authorization_code: "AUTH_t", reusable: false, channel: "bank_transfer" }, customer: {} } })) as typeof fetch;
  assert.equal(await paystackProvider("sk", notReusable).cardFor!("PAY-1"), null);
  const declined = (async () => json({ status: true, data: { status: "failed", amount: 800000, currency: "NGN", id: 5, gateway_response: "Insufficient Funds" } })) as typeof fetch;
  const r = await paystackProvider("sk", declined).chargeCard!({ reference: "PAY-3", amountKobo: 800000n, currency: "NGN", card: { token: "t", customer: "", email: "a@b.test" }, description: "x" });
  assert.ok(r.ok && r.status === "failed" && r.message === "Insufficient Funds");
  const invalid = (async () => json({ status: false, message: "Invalid authorization code" }, 400)) as typeof fetch;
  const bad = await paystackProvider("sk", invalid).chargeCard!({ reference: "PAY-4", amountKobo: 1n, currency: "NGN", card: { token: "t", customer: "", email: "a@b.test" }, description: "x" });
  assert.ok(!bad.ok && bad.permanent);
});

test("Stripe: checkout asks to keep the card only when asked, and an off-session charge that is declined is a failure", async () => {
  const bodies: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); if (init?.body) bodies.push(String(init.body));
    if (u.endsWith("/checkout/sessions")) return json({ url: "https://checkout.stripe.test/s" });
    if (u.includes("/payment_intents/search")) return json({ data: [{ id: "pi_1", status: "succeeded", customer: "cus_9", payment_method: "pm_9", setup_future_usage: "off_session", amount_received: 5000, currency: "usd" }] });
    if (u.includes("/payment_methods/pm_9")) return json({ id: "pm_9", card: { brand: "mastercard", last4: "4444", exp_month: 3, exp_year: 2031 }, billing_details: { email: "c@d.test" } });
    if (u.endsWith("/payment_intents")) return json({ error: { message: "Your card was declined.", code: "card_declined", decline_code: "insufficient_funds", payment_intent: { id: "pi_2" } } }, 402);
    return json({}, 404);
  }) as typeof fetch;
  const p = stripeProvider("sk_test", "whsec", fetchImpl);
  await p.initialize({ reference: "PAY-A", amountKobo: 5000n, email: "c@d.test", callbackUrl: "https://app.test/r", currency: "USD", saveCard: true });
  assert.match(decodeURIComponent(bodies[0]), /payment_intent_data\[setup_future_usage\]=off_session/);
  assert.match(decodeURIComponent(bodies[0]), /customer_creation=always/);
  await p.initialize({ reference: "PAY-B", amountKobo: 5000n, email: "c@d.test", callbackUrl: "https://app.test/r", currency: "USD" });
  assert.doesNotMatch(decodeURIComponent(bodies[1]), /setup_future_usage|customer_creation/);
  assert.deepEqual(await p.cardFor!("PAY-A"), { token: "pm_9", customer: "cus_9", last4: "4444", brand: "mastercard", expMonth: 3, expYear: 2031, email: "c@d.test" });
  const r = await p.chargeCard!({ reference: "PAY-C", amountKobo: 5000n, currency: "USD", card: { token: "pm_9", customer: "cus_9", email: "c@d.test" }, description: "Pro renewal" });
  assert.ok(r.ok && r.status === "failed" && r.message === "insufficient_funds");
  assert.match(decodeURIComponent(bodies.at(-1)!), /off_session=true/);
  assert.match(decodeURIComponent(bodies.at(-1)!), /metadata\[reference\]=PAY-C/);
});
