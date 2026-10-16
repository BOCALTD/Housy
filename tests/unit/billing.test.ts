import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReceived, hmacSha512, newPeriodEnd, refundable, renewalDue, reminderStage, sameHex } from "../../src/lib/billing-rules";
import { paystackProvider } from "../../src/lib/payment-providers";
import { categoryOf } from "../../src/lib/notification-rules";

const d = (s: string) => new Date(s);

test("a paid period ends at the close of a day and renews from the end already paid for", () => {
  const now = d("2026-10-16T10:00:00Z");
  const fresh = newPeriodEnd({ now, currentEnd: null, samePlan: true, months: 1 });
  assert.equal(fresh.toISOString(), "2026-11-16T23:59:59.999Z");
  const early = newPeriodEnd({ now, currentEnd: d("2026-10-20T23:59:59.999Z"), samePlan: true, months: 1 });
  assert.equal(early.toISOString(), "2026-11-20T23:59:59.999Z", "time already paid for is kept");
  const lapsed = newPeriodEnd({ now, currentEnd: d("2026-09-01T23:59:59.999Z"), samePlan: true, months: 3 });
  assert.equal(lapsed.toISOString(), "2027-01-16T23:59:59.999Z", "an expired plan restarts today");
  const switched = newPeriodEnd({ now, currentEnd: d("2026-10-20T23:59:59.999Z"), samePlan: false, months: 1 });
  assert.equal(switched.toISOString(), "2026-11-16T23:59:59.999Z", "another plan starts today");
  const clamp = newPeriodEnd({ now: d("2026-01-31T10:00:00Z"), currentEnd: null, samePlan: true, months: 1 });
  assert.equal(clamp.toISOString(), "2026-02-28T23:59:59.999Z");
});

test("renewal is asked for shortly before the end and through the grace period, never when cancelled", () => {
  const end = d("2026-10-20T23:59:59.999Z");
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: d("2026-10-10T00:00:00Z"), cancelled: false }), false);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: d("2026-10-14T00:00:00Z"), cancelled: false }), true);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: d("2026-10-25T00:00:00Z"), cancelled: false }), true);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: d("2026-11-05T00:00:00Z"), cancelled: false }), false);
  assert.equal(renewalDue({ periodEnd: end, graceDays: 7, now: d("2026-10-18T00:00:00Z"), cancelled: true }), false);
  assert.equal(reminderStage(end, d("2026-10-15T00:00:00Z")), "NOTICE");
  assert.equal(reminderStage(end, d("2026-10-20T12:00:00Z")), "LAST_DAY");
  assert.equal(reminderStage(end, d("2026-10-22T00:00:00Z")), "OVERDUE");
});

test("money received must be exactly what was asked, in naira, for an open invoice", () => {
  const base = { expectedKobo: 500_000n, receivedKobo: 500_000n, currency: "NGN", invoiceStatus: "OPEN" as const };
  assert.deepEqual(checkReceived(base), { ok: true });
  assert.deepEqual(checkReceived({ ...base, receivedKobo: 400_000n }), { ok: false, reason: "AMOUNT" });
  assert.deepEqual(checkReceived({ ...base, receivedKobo: 600_000n }), { ok: false, reason: "AMOUNT" });
  assert.deepEqual(checkReceived({ ...base, currency: "USD" }), { ok: false, reason: "CURRENCY" });
  assert.deepEqual(checkReceived({ ...base, invoiceStatus: "PAID" }), { ok: false, reason: "INVOICE_CLOSED" });
  assert.deepEqual(checkReceived({ ...base, invoiceStatus: "VOID" }), { ok: false, reason: "INVOICE_CLOSED" });
  assert.equal(refundable({ receivedKobo: 500_000n, amountKobo: 500_000n, refundedKobo: 120_000n }), 380_000n);
  assert.equal(refundable({ receivedKobo: null, amountKobo: 500_000n, refundedKobo: 0n }), 500_000n);
});

test("billing messages are essential, so they cannot be switched off", () => {
  for (const k of ["billing.failed", "billing.paid", "billing.renewal", "billing.refund", "billing.review"]) assert.equal(categoryOf(k), "ESSENTIAL");
});

const KEY = "sk_test_secret";
const body = JSON.stringify({ event: "charge.success", data: { id: 4099260516, reference: "PAY-ABC12345", amount: 500000, currency: "NGN", status: "success" } });
const sign = (b: string) => hmacSha512(KEY, b);

test("the provider's signature proves a message is genuine and unaltered", () => {
  const p = paystackProvider(KEY, (() => { throw new Error("no network"); }) as never);
  assert.equal(p.verifySignature(body, sign(body)), true);
  assert.equal(p.verifySignature(body, sign(body).toUpperCase()), true);
  assert.equal(p.verifySignature(body, null), false);
  assert.equal(p.verifySignature(body, "deadbeef"), false);
  assert.equal(p.verifySignature(body.replace("500000", "100"), sign(body)), false, "an altered amount fails");
  assert.equal(paystackProvider("another-key").verifySignature(body, sign(body)), false, "signed with another key fails");
  assert.equal(sameHex("ab", "abc"), false);
});

test("a message is read the same way every time, so repeats can be recognised", () => {
  const p = paystackProvider(KEY);
  const a = p.parseEvent(body)!, b = p.parseEvent(body)!;
  assert.equal(a.eventId, b.eventId);
  assert.equal(a.kind, "PAYMENT_SUCCEEDED");
  assert.equal(a.reference, "PAY-ABC12345");
  assert.equal(a.amountKobo, 500_000n);
  assert.equal(p.parseEvent("not json"), null);
  assert.equal(p.parseEvent(JSON.stringify({ event: "customeridentification.success", data: {} }))!.kind, "IGNORED");
  const r = p.parseEvent(JSON.stringify({ event: "refund.processed", data: { id: 77, transaction_reference: "PAY-ABC12345", amount: 100000, currency: "NGN" } }))!;
  assert.equal(r.kind, "REFUND_COMPLETED");
  assert.equal(r.reference, "PAY-ABC12345");
  assert.equal(r.amountKobo, 100_000n);
});

test("the provider driver starts, verifies and refunds payments, and says honestly when it could not", async () => {
  const calls: { url: string; body?: string }[] = [];
  const reply = (status: number, json: unknown) => async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body as string | undefined }); return new Response(JSON.stringify(json), { status }); };
  let p = paystackProvider(KEY, reply(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }) as never);
  const started = await p.initialize({ reference: "PAY-1", amountKobo: 500_000n, email: "a@b.test", callbackUrl: "https://x.test/back" });
  assert.deepEqual(started, { ok: true, checkoutUrl: "https://checkout.paystack.com/abc" });
  assert.equal(JSON.parse(calls[0].body!).amount, 500000);
  assert.equal(JSON.parse(calls[0].body!).currency, "NGN");
  p = paystackProvider(KEY, reply(200, { status: true, data: { authorization_url: "http://insecure.test" } }) as never);
  assert.equal((await p.initialize({ reference: "PAY-1", amountKobo: 1n, email: "a@b.test", callbackUrl: "https://x.test" })).ok, false, "a checkout address must be https");
  p = paystackProvider(KEY, reply(401, { status: false, message: "Invalid key" }) as never);
  const bad = await p.initialize({ reference: "PAY-1", amountKobo: 1n, email: "a@b.test", callbackUrl: "https://x.test" });
  assert.equal(bad.ok, false);
  p = paystackProvider(KEY, reply(200, { status: true, data: { status: "success", amount: 500000, currency: "NGN", id: 9 } }) as never);
  assert.deepEqual(await p.verify("PAY-1"), { ok: true, status: "success", amountKobo: 500_000n, currency: "NGN", providerTxId: "9" });
  p = paystackProvider(KEY, reply(200, { status: true, data: { status: "abandoned", amount: 500000, currency: "NGN", id: 9 } }) as never);
  assert.equal(((await p.verify("PAY-1")) as { status: string }).status, "failed");
  p = paystackProvider(KEY, reply(200, { status: true, data: { status: "ongoing", amount: 500000, currency: "NGN", id: 9 } }) as never);
  assert.equal(((await p.verify("PAY-1")) as { status: string }).status, "pending");
  p = paystackProvider(KEY, reply(400, { status: false, message: "Transaction not found" }) as never);
  assert.deepEqual(await p.refund({ reference: "PAY-1", amountKobo: 1n, reason: "test" }), { ok: false, permanent: true, error: "400 Transaction not found" });
  p = paystackProvider(KEY, reply(503, { status: false, message: "down" }) as never);
  assert.equal(((await p.refund({ reference: "PAY-1", amountKobo: 1n, reason: "test" })) as { permanent: boolean }).permanent, false, "a server error may be retried");
  p = paystackProvider(KEY, reply(200, { status: true, data: { id: 5, status: "processed" } }) as never);
  assert.deepEqual(await p.refund({ reference: "PAY-1", amountKobo: 1n, reason: "test" }), { ok: true, providerRef: "5", completed: true });
});
