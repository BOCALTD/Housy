import { test } from "node:test";
import assert from "node:assert/strict";
import { abaValid, bankLines, checkBankDetails, currencyOf, formatMoney, ibanValid, moneyInput, parseMoney, providerCanServe } from "../../src/lib/regions";

test("money is formatted and read in each currency, in whole minor units", () => {
  assert.equal(formatMoney(18_500_000_000n, "NGN"), "₦185,000,000");
  assert.equal(formatMoney(125_050n, "USD"), "$1,250.50");
  assert.equal(formatMoney(90_000n, "GBP"), "£900");
  assert.equal(formatMoney(-500n, "EUR"), "-€5");
  assert.equal(parseMoney("$1,250.50", "USD"), 125_050n);
  assert.equal(parseMoney("GBP 900", "GBP"), 90_000n);
  assert.equal(parseMoney("C$2,000", "CAD"), 200_000n);
  assert.equal(parseMoney("GH₵ 75.5", "GHS"), 7_550n);
  assert.throws(() => parseMoney("12.345", "USD"), /amount in us dollars/);
  assert.equal(moneyInput(125_050n), "1250.50");
  assert.equal(currencyOf("GB"), "GBP");
  assert.equal(currencyOf("XX"), "NGN");
});

test("each country's bank details are checked the way its banks do", () => {
  assert.ok(ibanValid("GB82 WEST 1234 5698 7654 32"));
  assert.equal(ibanValid("GB82WEST12345698765433"), false);
  assert.ok(abaValid("021000021"));
  assert.equal(abaValid("021000022"), false);
  const uk = checkBankDetails("GB", { bankName: "Barclays", accountName: "Ada Homes Ltd", sortCode: "20-00-00", accountNumber: "12345678" });
  assert.deepEqual(uk, { ok: true, details: { bankName: "Barclays", accountName: "Ada Homes Ltd", sortCode: "200000", accountNumber: "12345678" } });
  assert.match((checkBankDetails("US", { bankName: "Chase", accountName: "A", routingNumber: "021000021", accountNumber: "1234" }) as { problem: string }).problem, /account name/);
  assert.match((checkBankDetails("US", { bankName: "Chase", accountName: "Ada LLC", routingNumber: "021000022", accountNumber: "1234" }) as { problem: string }).problem, /routing number does not check/);
  assert.ok(checkBankDetails("DE", { bankName: "Sparkasse", accountName: "Ada GmbH", iban: "DE89 3704 0044 0532 0130 00", bic: "" }).ok);
  assert.ok(checkBankDetails("NG", { bankName: "GTBank", accountName: "Ada Ltd", accountNumber: "0123456789" }).ok);
  assert.deepEqual(bankLines("GB", { bankName: "Barclays", accountName: "Ada", sortCode: "200000", accountNumber: "12345678" }).map((l) => l.value), ["Barclays", "Ada", "20-00-00", "12345678"]);
});

test("Paystack serves the African countries it covers; Stripe the others", () => {
  assert.ok(providerCanServe("PAYSTACK", "GH"));
  assert.equal(providerCanServe("PAYSTACK", "US"), false);
  assert.ok(providerCanServe("STRIPE", "CA"));
  assert.equal(providerCanServe("STRIPE", "NG"), false);
});

test("amounts typed with any supported symbol are read, and formatted in the record's currency", async () => {
  const { formatKobo, parseNairaToKobo, moneySymbol } = await import("../../src/lib/money");
  assert.equal(parseNairaToKobo("$1,250.50"), 125_050n);
  assert.equal(parseNairaToKobo("£900"), 90_000n);
  assert.equal(parseNairaToKobo("GBP 900"), 90_000n);
  assert.equal(parseNairaToKobo("₦2,000"), 200_000n);
  assert.throws(() => parseNairaToKobo("12.345"), /Enter an amount/);
  assert.equal(formatKobo(125_050n, "USD"), "$1,250.50");
  assert.equal(formatKobo(18_500_000_000n), "₦185,000,000", "naira outside a workspace");
  assert.equal(moneySymbol("EUR"), "€");
});

test("Stripe messages are accepted only with a fresh, valid signature; form fields nest the way Stripe reads them", async () => {
  const { createHmac } = await import("node:crypto");
  const { stripeSignatureValid, stripeForm } = await import("../../src/lib/payment-providers");
  const secret = "whsec_testtesttesttesttesttest", body = '{"id":"evt_1"}', t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.ok(stripeSignatureValid(secret, body, `t=${t},v1=${sig}`, t + 10));
  assert.equal(stripeSignatureValid(secret, body, `t=${t},v1=${sig}`, t + 301), false, "older than five minutes");
  assert.equal(stripeSignatureValid(secret, body + " ", `t=${t},v1=${sig}`, t + 10), false, "altered body");
  assert.equal(stripeSignatureValid(secret, body, null, t), false);
  assert.deepEqual(stripeForm({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "usd" } }], skip: "" }),
    ["mode=payment", "line_items%5B0%5D%5Bquantity%5D=1", "line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd"]);
});
