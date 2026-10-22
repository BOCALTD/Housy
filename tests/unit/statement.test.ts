import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNairaPayment, paymentLabel, statementPeriod, statementTotals } from "../../src/lib/portal-rules";
import { PdfDoc, pdfSafe, textWidth, wrapText } from "../../src/lib/pdf";
import { renderStatement } from "../../src/lib/statement-pdf";

const today = new Date("2026-10-22T10:00:00Z");

test("statement period: last full month by default, checked when chosen", () => {
  assert.deepEqual(statementPeriod(null, null, today), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(statementPeriod(null, null, new Date("2026-01-15T00:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(statementPeriod("2026-01-01", "2026-06-30", today), { from: "2026-01-01", to: "2026-06-30" });
  assert.deepEqual(statementPeriod("2026-10-01", "", today), { from: "2026-10-01", to: "2026-10-22" });
  assert.throws(() => statementPeriod("2026-06-30", "2026-01-01", today), /start date/);
  assert.throws(() => statementPeriod("2025-01-01", "2026-06-30", today), /one year/);
  assert.throws(() => statementPeriod("yesterday", "2026-06-30", today), /Choose/);
});

test("statement totals: net is rent received less maintenance", () => {
  const t = statementTotals([{ chargedKobo: 100n, receivedKobo: 80n, outstandingKobo: 20n }, { chargedKobo: 50n, receivedKobo: 50n, outstandingKobo: 0n }], [{ costKobo: 30n }, { costKobo: null }]);
  assert.deepEqual(t, { charged: 150n, received: 130n, outstanding: 20n, maintenance: 30n, net: 100n });
});

test("recording an invoice payment", () => {
  assert.equal(parseNairaPayment("2026-10-22", "", 500n, today).amountKobo, 500n);
  assert.equal(parseNairaPayment("2026-10-20", "3", 500n, today).amountKobo, 300n);
  assert.throws(() => parseNairaPayment("2026-10-30", "", 500n, today), /future/);
  assert.throws(() => parseNairaPayment("2026-10-20", "6", 500n, today), /more than/);
  assert.throws(() => parseNairaPayment("", "", 500n, today), /date/);
  const base = { kind: "INVOICE", status: "ACCEPTED", amountKobo: 500n, paidOn: null, paidAmountKobo: null };
  assert.equal(paymentLabel(base), "Accepted, not yet paid");
  assert.equal(paymentLabel({ ...base, paidOn: today, paidAmountKobo: 300n }), "Part paid");
  assert.equal(paymentLabel({ ...base, paidOn: today, paidAmountKobo: 500n }), "Paid");
  assert.equal(paymentLabel({ ...base, kind: "QUOTE" }), null);
  assert.equal(paymentLabel({ ...base, status: "SUBMITTED" }), null);
});

test("PDF text: naira and dashes become safe characters, and long text wraps", () => {
  assert.equal(pdfSafe("₦1,000 — ok"), "NGN 1,000 - ok");
  assert.equal(pdfSafe("日本"), "??");
  assert.ok(textWidth("WWW", 10) > textWidth("iii", 10));
  const lines = wrapText("word ".repeat(80), 10, 200);
  assert.ok(lines.length > 3);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 200);
  assert.ok(wrapText("x".repeat(300), 10, 100).every((l) => textWidth(l, 10) <= 100), "a very long word is cut");
});

function checkXref(bytes: Uint8Array) {
  const s = Buffer.from(bytes).toString("latin1");
  const start = Number(/startxref\n(\d+)/.exec(s)![1]);
  const rows = s.slice(start).split("\n");
  const n = Number(rows[1].split(" ")[1]);
  for (let i = 1; i < n; i++) assert.ok(s.startsWith(`${i} 0 obj`, Number(rows[2 + i].slice(0, 10))), `object ${i} offset`);
  return s;
}

test("the PDF is well formed: every object is where the index says, and pages break", () => {
  const doc = new PdfDoc("footer (with brackets) \\ and a backslash");
  for (let i = 0; i < 200; i++) doc.para(`Line ${i} ₦`);
  const s = checkXref(doc.bytes({ title: "Test" }));
  assert.match(s, /\/Count [3-9]/);
  assert.match(s, /Page 1 of/);
  assert.match(s, /\\\(with brackets\\\)/);
});

test("a statement renders with its figures", () => {
  const s = checkXref(renderStatement({
    companyName: "Alpha", ownerName: "Mrs Owner", from: "2026-09-01", to: "2026-09-30", generatedAt: today,
    properties: [{ name: "House", ref: "AST-1", address: "Lekki", leases: [{ ref: "LSE-1", occupant: "Tenant", unit: "", chargedKobo: 50000000n, receivedKobo: 30000000n, outstandingKobo: 20000000n, receipts: [{ no: "R-1", paidOn: "2026-09-02", amountKobo: 30000000n }] }], jobs: [{ ref: "WO-1", title: "Gate", completedOn: "2026-09-10", costKobo: 2750000n }] }],
    totals: { charged: 50000000n, received: 30000000n, outstanding: 20000000n, maintenance: 2750000n, net: 27250000n },
  }));
  assert.match(s, /NGN 500,000/);
  assert.match(s, /NGN 272,500/);
  assert.match(s, /Mrs Owner/);
});
