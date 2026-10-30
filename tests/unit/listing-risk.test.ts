import { test } from "node:test";
import assert from "node:assert/strict";
import { contactInText, descriptionKey, moneyBeforeViewing, priceFlag, textFlags } from "../../src/lib/listing-risk-rules";

test("contact details and off-platform invitations are found", () => {
  assert.ok(contactInText("Call 0803 123 4567 today"));
  assert.ok(contactInText("+234 803 123 4567"));
  assert.ok(contactInText("08031234567"));
  assert.ok(contactInText("email ada@example.com"));
  assert.ok(contactInText("Chat on WhatsApp for details"));
  assert.ok(!contactInText("3 bedroom flat, 24 hour power, 2 parking spaces, built 2019"));
  assert.ok(!contactInText("Plot of 600 m² with C of O"));
});

test("money before an inspection is flagged, ordinary fee notes are not", () => {
  assert.ok(moneyBeforeViewing("Pay before inspection to secure your slot"));
  assert.ok(moneyBeforeViewing("Inspection fee of N10,000 applies"));
  assert.ok(moneyBeforeViewing("Kindly send the deposit to reserve it"));
  assert.ok(moneyBeforeViewing("Payment by USDT accepted"));
  assert.ok(!moneyBeforeViewing("Agency fee 10%, legal fee 10%, caution deposit one month"));
  assert.ok(!moneyBeforeViewing("Service charge covers security and cleaning"));
});

test("prices far from similar homes are flagged with the reason", () => {
  const s = { n: 12, companies: 4, median: 100_000_000, low: 80_000_000, high: 130_000_000 };
  assert.equal(priceFlag(30_000_000, s, "3-bedroom homes for sale in Lekki")?.code, "PRICE_LOW");
  assert.match(priceFlag(30_000_000, s, "x")!.text, /30% of the typical/);
  assert.equal(priceFlag(400_000_000, s, "x")?.code, "PRICE_HIGH");
  assert.equal(priceFlag(90_000_000, s, "x"), null);
  assert.equal(priceFlag(1, null, "x"), null);
});

test("text flags combine, and short descriptions are not compared", () => {
  assert.deepEqual(textFlags({ title: "Lovely flat", description: "Pay before inspection. WhatsApp 0803 123 4567", feesNote: "" }).map((f) => f.code), ["MONEY_FIRST", "CONTACT"]);
  assert.equal(descriptionKey("Nice flat"), null);
  assert.equal(descriptionKey("A  ".repeat(50))?.includes("  "), false);
});
