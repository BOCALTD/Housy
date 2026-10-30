/**
 * Phase 17s: the accounting export. Rent on an owned property is income, on a managed one it is held for the owner; receipts
 * reduce what tenants owe; every journal balances; codes are the company's own; only finance roles export.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, recordLeasePayment } from "../../src/lib/services/leases";
import { accountingJournal, saveAccountingCodes } from "../../src/lib/services/accounting";
import { journalRows } from "../../src/lib/accounting-rules";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

test("a period's records become balanced journals in the company's own accounts", async () => {
  const co = await newCompany("books");
  const own = await createAsset(co, { name: "Own Court", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" } as never);
  const managed = await createAsset(co, { name: "Client Court", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "MANAGER" } as never);
  const start = relativeDate(-20);
  const l1 = await createLease(co, own.id, { occupantName: "Tenant Own", startDate: start, endDate: relativeDate(340), rent: "1,200,000", frequency: "YEARLY" });
  await createLease(co, managed.id, { occupantName: "Tenant Managed", startDate: start, endDate: relativeDate(340), rent: "800,000", frequency: "YEARLY" });
  await recordLeasePayment(co, l1.id, { amount: "1,000,000", paidOn: relativeDate(-19), evidence: `BANK-${randomUUID().slice(0, 8)}`, method: "Bank transfer", payerName: "Tenant Own" });

  const j = await accountingJournal(co, relativeDate(-30), relativeDate(0));
  assert.deepEqual(j.unbalanced, []);
  const t = (k: string) => j.totals.get(k as never) ?? { debit: 0n, credit: 0n };
  assert.equal(t("RENT_INCOME").credit, 120_000_000n, "owned rent is income");
  assert.equal(t("OWNER_RENT").credit, 80_000_000n, "managed rent is held for the owner");
  assert.equal(t("BANK").debit, 100_000_000n);
  assert.equal(t("TENANT_CREDIT").credit, 0n, "the receipt was all applied to rent billed");
  assert.equal(t("TENANT_RECEIVABLE").debit - t("TENANT_RECEIVABLE").credit, 100_000_000n, "200,000 still owed on the owned flat and 800,000 on the managed one");

  await assert.rejects(saveAccountingCodes(co, { BANK: "1200", RENT_INCOME: "1200" }), /cannot share/);
  await saveAccountingCodes(co, { BANK: "1200-GTB", RENT_INCOME: "4100" });
  const j2 = await accountingJournal(co, relativeDate(-30), relativeDate(0));
  const { rows } = journalRows(j2, j2.codes, "debit-credit");
  assert.ok(rows.some((r) => r[2] === "1200-GTB" && r[3] === "Bank"));
  assert.ok(rows.some((r) => r[2] === "2100" && r[3] === "Rent held for property owners"), "unset codes keep the default");

  const agent = await addMember(co, "AGENT", "bkag");
  await assert.rejects(accountingJournal(agent, relativeDate(-30), relativeDate(0)), /permission/i);
  const manager = await addMember(co, "MANAGER", "bkmg");
  await assert.rejects(saveAccountingCodes(manager, { BANK: "1" }), /permission/i, "only the administrator changes the codes");
  await assert.rejects(accountingJournal(co, relativeDate(0), relativeDate(-5)), /before its start/);
});
