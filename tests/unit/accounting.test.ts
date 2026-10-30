import { test } from "node:test";
import assert from "node:assert/strict";
import { balanced, buildJournal, cleanCodes, entryFor, journalRows, type AccountingEvent } from "../../src/lib/accounting-rules";

const ev = (o: Partial<AccountingEvent> & { kind: AccountingEvent["kind"] }) => ({ date: "2026-10-01", ref: "LSE-00001", property: "AST-1 Block A", memo: "", amount: 100_000_00n, owned: true, ...o }) as AccountingEvent;

test("rent on an owned property is income; on a managed one it is the owner's money", () => {
  assert.deepEqual(entryFor(ev({ kind: "CHARGE" }))!.lines.map((l) => l.account), ["TENANT_RECEIVABLE", "RENT_INCOME"]);
  assert.deepEqual(entryFor(ev({ kind: "CHARGE", owned: false }))!.lines.map((l) => l.account), ["TENANT_RECEIVABLE", "OWNER_RENT"]);
});

test("adjustments go the right way and late fees are other income", () => {
  const late = entryFor(ev({ kind: "ADJUSTMENT", adjustment: "LATE_FEE", amount: 5_000_00n } as never))!;
  assert.deepEqual(late.lines, [{ account: "TENANT_RECEIVABLE", debit: 5_000_00n, credit: 0n }, { account: "OTHER_INCOME", debit: 0n, credit: 5_000_00n }]);
  const waiver = entryFor(ev({ kind: "ADJUSTMENT", adjustment: "WAIVER", amount: -2_000_00n } as never))!;
  assert.deepEqual(waiver.lines, [{ account: "TENANT_RECEIVABLE", debit: 0n, credit: 2_000_00n }, { account: "RENT_INCOME", debit: 2_000_00n, credit: 0n }]);
});

test("a receipt larger than what was billed holds the rest as a payment in advance; a reversal undoes it", () => {
  const r = entryFor(ev({ kind: "RECEIPT", amount: 150_000_00n, allocated: 100_000_00n } as never))!;
  assert.deepEqual(r.lines.map((l) => [l.account, l.debit, l.credit]), [["BANK", 150_000_00n, 0n], ["TENANT_RECEIVABLE", 0n, 100_000_00n], ["TENANT_CREDIT", 0n, 50_000_00n]]);
  const back = entryFor(ev({ kind: "RECEIPT", amount: 150_000_00n, allocated: 100_000_00n, reversed: true } as never))!;
  assert.equal(back.lines[0].credit, 150_000_00n);
  assert.ok(balanced(r) && balanced(back));
});

test("service charge moves the tenants' fund, never income", () => {
  for (const kind of ["SERVICE_ASSESSMENT", "SERVICE_COLLECTION", "SERVICE_EXPENSE"] as const) {
    const e = entryFor(ev({ kind }))!;
    assert.ok(balanced(e));
    assert.ok(!e.lines.some((l) => l.account === "RENT_INCOME" || l.account === "OTHER_INCOME"));
  }
});

test("the journal is numbered in date order, balanced, and exports in both layouts with the company's codes", () => {
  const j = buildJournal([ev({ kind: "RECEIPT", date: "2026-10-05", allocated: 100_000_00n } as never), ev({ kind: "CHARGE", date: "2026-10-01" }), ev({ kind: "DEPOSIT", entry: "RECEIVED", date: "2026-10-01" } as never)]);
  assert.deepEqual(j.entries.map((e) => [e.no, e.source]), [["HSY-00001", "Deposit received"], ["HSY-00002", "Rent billed"], ["HSY-00003", "Rent received"]]);
  assert.deepEqual(j.unbalanced, []);
  assert.equal(j.totals.get("TENANT_RECEIVABLE")!.debit, j.totals.get("TENANT_RECEIVABLE")!.credit);
  const dc = journalRows(j, { BANK: "1200-01" }, "debit-credit");
  assert.deepEqual(dc.rows[0].slice(0, 6), ["2026-10-01", "HSY-00001", "1200-01", "Bank", "100000.00", ""]);
  const signed = journalRows(j, {}, "signed");
  assert.equal(signed.rows.reduce((s, r) => s + Number(r[4]), 0), 0, "signed amounts sum to zero");
});

test("account codes are checked", () => {
  assert.deepEqual(cleanCodes({ BANK: " 1200 ", RENT_INCOME: "1200" }).problems.length, 1);
  assert.equal(cleanCodes({ BANK: "=cmd()" }).problems.length, 1, "nothing that a spreadsheet would run");
  assert.deepEqual(cleanCodes({ BANK: "1200", RENT_INCOME: "" }).codes, { BANK: "1200" });
});

import { toCsvWithAmounts } from "../../src/lib/csv";
test("negative amounts stay numbers in the CSV, while text is still guarded", () => {
  const out = toCsvWithAmounts(["Amount", "Description"], [["-1500.00", "-1500.00"], ["=SUM(A1)", "=cmd"]], ["Amount"]);
  assert.equal(out, "Amount,Description\r\n-1500.00,'-1500.00\r\n'=SUM(A1),'=cmd\r\n");
});
