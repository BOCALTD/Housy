/**
 * Online payments against the real Paystack and Stripe services, in their TEST modes. Run by .github/workflows/real-world.yml when the
 * owner has added test keys as GitHub secrets (never live keys, and never pasted anywhere else):
 *   PAYSTACK_TEST_SECRET_KEY   sk_test_... from Paystack, Settings, API Keys & Webhooks (test mode)
 *   STRIPE_TEST_SECRET_KEY     sk_test_... from Stripe, Developers, API keys (test mode)
 * It drives the same provider code the app uses: start a checkout, ask what happened to a payment, take a test card payment,
 * refund part of it, and (Stripe) open a Connect account set-up link and (Paystack) list banks for payouts. Without a key, that
 * provider is reported as not checked. Live keys are refused.
 * Writes device-report/payments/report.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { paystackProvider, paystackSplitApi, stripeConnectApi, stripeProvider } from "../src/lib/payment-providers";

type Row = { provider: string; step: string; ok: boolean | null; note: string };
const rows: Row[] = [];
const add = (provider: string, step: string, ok: boolean | null, note: string) => { rows.push({ provider, step, ok, note }); console.log(`${ok === null ? "--" : ok ? "ok" : "FAIL"}  ${provider}: ${step}: ${note}`); };
const ref = (p: string) => `${p}-CHECK-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const OUT = "device-report/payments";

async function paystack(key: string) {
  const P = "Paystack";
  const p = paystackProvider(key);
  const r1 = ref("PAY");
  const init = await p.initialize({ reference: r1, amountKobo: 50_000n, email: "payments-check@example.com", callbackUrl: "https://example.com/return", metadata: { check: "real-world" }, currency: "NGN", description: "Housy payments check" });
  add(P, "start a checkout", init.ok && init.checkoutUrl.startsWith("https://checkout.paystack.com"), init.ok ? init.checkoutUrl.replace(/[^/]+$/, "…") : init.error);
  const v1 = await p.verify(r1);
  add(P, "ask about an unpaid checkout", v1.ok && v1.status !== "success", v1.ok ? `the provider says ${v1.status} for ${v1.amountKobo} kobo (the app treats an unpaid checkout as not paid)` : v1.error);

  // A test card payment through Paystack's charge API (test mode only), then the app's own verify and refund.
  const r2 = ref("PAY");
  const charge = await fetch("https://api.paystack.co/charge", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "payments-check@example.com", amount: 50_000, reference: r2, card: { number: "4084084084084081", cvv: "408", expiry_month: "12", expiry_year: String(new Date().getFullYear() + 3) } }),
  }).then((r) => r.json()).catch((e) => ({ status: false, message: String(e) })) as { status?: boolean; message?: string; data?: { status?: string } };
  const charged = charge.status === true && charge.data?.status === "success";
  add(P, "take a test card payment", charged, charged ? "test card 4084 0840 8408 4081 charged ₦500" : `${charge.message ?? ""} ${charge.data?.status ?? ""}`.trim() || "no answer");
  if (charged) {
    const v2 = await p.verify(r2);
    add(P, "confirm the payment with the provider", v2.ok && v2.status === "success" && v2.amountKobo === 50_000n, v2.ok ? `${v2.status}, ${v2.amountKobo} kobo ${v2.currency}` : v2.error);
    const rf = await p.refund({ reference: r2, amountKobo: 20_000n, reason: "Housy payments check: part refund" });
    add(P, "refund part of it", rf.ok, rf.ok ? `refund ${rf.providerRef} ${rf.completed ? "processed" : "accepted, processing"}` : rf.error);
  }
  const banks = await paystackSplitApi(key).banks("nigeria", "NGN").catch(() => null);
  add(P, "list banks for company payouts", !!banks && banks.length > 10, banks ? `${banks.length} banks` : "no answer");
}

async function stripe(key: string) {
  const S = "Stripe";
  const s = stripeProvider(key, "whsec_not_used_here");
  const r1 = ref("PAY");
  const init = await s.initialize({ reference: r1, amountKobo: 1000n, email: "payments-check@example.com", callbackUrl: "https://example.com/return", currency: "USD", description: "Housy payments check" });
  add(S, "start a checkout", init.ok && init.checkoutUrl.startsWith("https://checkout.stripe.com"), init.ok ? "checkout.stripe.com page made" : init.error);
  const v1 = await s.verify(r1);
  add(S, "ask about an unpaid checkout", v1.ok && v1.status === "pending", v1.ok ? `the provider says ${v1.status}` : v1.error);

  // A test card payment carrying a Housy reference, as a finished checkout leaves it, then verify and refund through the app's code.
  const r2 = ref("PAY");
  const body = new URLSearchParams({ amount: "1500", currency: "usd", confirm: "true", payment_method: "pm_card_visa", "payment_method_types[]": "card", "metadata[reference]": r2, description: "Housy payments check" });
  const pi = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, body })
    .then((r) => r.json()).catch((e) => ({ error: { message: String(e) } })) as { status?: string; error?: { message?: string } };
  const charged = pi.status === "succeeded";
  add(S, "take a test card payment", charged, charged ? "test Visa card charged $15.00" : pi.error?.message ?? pi.status ?? "no answer");
  if (charged) {
    // Stripe's search can take a few seconds to see a new payment.
    let v2 = await s.verify(r2);
    for (let i = 0; i < 10 && !(v2.ok && v2.status === "success"); i++) { await new Promise((r) => setTimeout(r, 3000)); v2 = await s.verify(r2); }
    add(S, "confirm the payment with the provider", v2.ok && v2.status === "success" && v2.amountKobo === 1500n, v2.ok ? `${v2.status}, ${v2.amountKobo} cents ${v2.currency}` : v2.error);
    const rf = await s.refund({ reference: r2, amountKobo: 500n, reason: "Housy payments check: part refund" });
    add(S, "refund part of it", rf.ok, rf.ok ? `refund ${rf.providerRef} ${rf.completed ? "succeeded" : "pending"}` : rf.error);
  }
  // Companies abroad are paid through Stripe Connect. Needs Connect switched on in the Stripe account; reported, not required.
  const c = stripeConnectApi(key);
  const acct = await c.createAccount({ country: "GB", email: "connect-check@example.com", businessName: "Housy Check Ltd" });
  if (acct.ok) {
    const link = await c.onboardingLink(acct.id, "https://example.com/return");
    add(S, "Connect: company set-up link", link.ok, link.ok ? "connect.stripe.com set-up page made" : link.error);
    await fetch(`https://api.stripe.com/v1/accounts/${acct.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${key}` } }).catch(() => undefined);
  } else add(S, "Connect: company set-up link", null, `not checked: ${acct.error} (switch on Connect in the Stripe test account to check payouts abroad)`);
}

async function main() {
  const pk = (process.env.PAYSTACK_TEST_SECRET_KEY ?? "").trim();
  const sk = (process.env.STRIPE_TEST_SECRET_KEY ?? "").trim();
  for (const [name, k] of [["Paystack", pk], ["Stripe", sk]] as const) {
    if (k && !k.startsWith("sk_test_")) { add(name, "key", false, "this is not a test key; only test keys (sk_test_...) may be used here"); }
  }
  if (pk.startsWith("sk_test_")) await paystack(pk); else if (!pk) add("Paystack", "all steps", null, "not checked: add PAYSTACK_TEST_SECRET_KEY as a GitHub secret");
  if (sk.startsWith("sk_test_")) await stripe(sk); else if (!sk) add("Stripe", "all steps", null, "not checked: add STRIPE_TEST_SECRET_KEY as a GitHub secret");
  mkdirSync(OUT, { recursive: true });
  const fails = rows.filter((r) => r.ok === false).length;
  const md = [
    "# Online payments against the real providers (test mode)", "",
    `Run ${new Date().toISOString()}. ${fails ? `**${fails} failed.**` : "Nothing failed."} Steps marked "not checked" need a test key or a provider setting.`, "",
    "| Provider | Step | Result | Detail |", "|---|---|---|---|",
    ...rows.map((r) => `| ${r.provider} | ${r.step} | ${r.ok === null ? "not checked" : r.ok ? "ok" : "**failed**"} | ${r.note.replace(/\|/g, "/")} |`),
    "", "Webhooks (the provider telling Housy a payment went through) need the live server's address; they are checked with signed sample messages in the tests, and on the server from Admin, Payments, Events.",
  ].join("\n");
  writeFileSync(`${OUT}/report.md`, md + "\n");
  process.exit(fails ? 1 : 0);
}

void main();
