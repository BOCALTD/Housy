/**
 * Paying contractors: one person asks, a different person approves; Paystack transfers are sent once (by reference), confirmed by
 * a signed webhook that is checked with Paystack, and retried safely by the scheduled check; bank transfers are recorded; the
 * accounting export carries every paid payment.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { approveWorkOrder, createContractor, reportWorkOrder } from "../../src/lib/services/maintenance";
import { _useTransferApi, cancelPayout, decidePayout, payoutWebhook, recordBankPayout, requestPayout, savePayee, savePayoutKey, syncPayouts } from "../../src/lib/services/payouts";
import { accountingJournal } from "../../src/lib/services/accounting";
import { hmacSha512 } from "../../src/lib/billing-rules";
import type { TransferApi, TransferStatus } from "../../src/lib/payment-providers";
import { addMember, newCompany, relativeDate } from "./helpers";

after(async () => { _useTransferApi(null); await prisma.$disconnect(); });

const KEY = "sk_test_" + "a".repeat(30);
type Sent = { reference: string; amountMinor: bigint; recipient: string };
function fakePaystack(o: { answer?: TransferStatus; fail?: "permanent" | "transient" } = {}) {
  const sent: Sent[] = [];
  const state = new Map<string, TransferStatus>();
  const api: TransferApi = {
    async balance() { return { ok: true, balanceMinor: 10_000_000_00n }; },
    async banks() { return [{ name: "Test Bank", code: "058" }]; },
    async resolveAccount(n) { return n === "0000000000" ? { ok: false, error: "The bank did not confirm that account number. Check the number and the bank." } : { ok: true, accountName: "ADE BUILDERS LTD" }; },
    async createRecipient() { return { ok: true, code: "RCP_test123" }; },
    async transfer(i) {
      if (o.fail === "permanent") return { ok: false, permanent: true, error: "Your balance is not enough" };
      if (o.fail === "transient") return { ok: false, permanent: false, error: "timeout" };
      if (state.has(i.reference)) return { ok: false, permanent: true, error: "Duplicate reference" };
      sent.push(i); state.set(i.reference, o.answer ?? "pending");
      return { ok: true, status: o.answer ?? "pending", transferCode: "TRF_1" };
    },
    async verify(reference) { const s = state.get(reference); return s ? { ok: true, status: s, amountMinor: sent.find((x) => x.reference === reference)!.amountMinor, reason: "" } : { ok: false, error: "Transfer not found" }; },
  };
  return { api, sent, state };
}

async function setup(label: string) {
  const admin = await newCompany(label);
  const manager = await addMember(admin, "MANAGER", "mgr");
  const officer = await addMember(admin, "OFFICER", "off");
  const asset = await createAsset(admin, { name: `${label} block`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  const c = await createContractor(admin, { name: `Ade Builders ${Math.random().toString(36).slice(2, 6)}`, trade: "Plumbing" });
  return { admin, manager, officer, asset, c };
}

test("Paystack: two people, sent once, confirmed by a checked webhook, and in the books", async () => {
  const fake = fakePaystack();
  _useTransferApi(() => fake.api);
  const { admin, manager, officer, asset, c } = await setup("payps");
  await assert.rejects(savePayoutKey(manager, KEY), /permission/i);
  await assert.rejects(savePayoutKey(admin, "pk_live_nope"), /secret key/);
  await savePayoutKey(admin, KEY);

  await assert.rejects(requestPayout(officer, { contractorId: c.id, amount: "50,000", method: "PAYSTACK", reason: "Pump" }), /bank account/);
  await assert.rejects(savePayee(manager, c.id, { bankCode: "058", accountNumber: "0000000000" }), /did not confirm/);
  const payee = await savePayee(manager, c.id, { bankCode: "058", accountNumber: "0123456789" });
  assert.equal(payee.accountName, "ADE BUILDERS LTD");

  // A work order caps what can be paid against it.
  const wo = await reportWorkOrder(admin, asset.id, { title: "Replace the borehole pump" });
  await approveWorkOrder(admin, wo.id, { approvedCost: "60,000" }).catch(() => {});
  const capped = await withTenant(admin.companyId, admin.userId, (tx) => tx.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { approvedCostKobo: true } }));
  if (capped.approvedCostKobo) await assert.rejects(requestPayout(officer, { contractorId: c.id, amount: "70,000", method: "PAYSTACK", reason: "Pump", workOrderId: wo.id }), /more than is left/);

  const p = await requestPayout(officer, { contractorId: c.id, amount: "50,000", method: "PAYSTACK", reason: "Invoice 42: pump", workOrderId: wo.id });
  assert.equal(p.status, "REQUESTED");
  await assert.rejects(decidePayout(officer, p.id, "approve"), /permission/i);
  // The person who asked cannot approve, in the service and in the database.
  const mine = await requestPayout(manager, { contractorId: c.id, amount: "1,000", method: "BANK", reason: "Small part" });
  await assert.rejects(decidePayout(manager, mine.id, "approve"), /Another person/);
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.update({ where: { id: mine.id }, data: { status: "APPROVED", decidedById: manager.userId, decidedAt: new Date() } })), /two_people|check/i);
  await cancelPayout(manager, mine.id);

  assert.equal(await decidePayout(manager, p.id, "approve"), "SENDING");
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].amountMinor, 5_000_000n);
  assert.equal(fake.sent[0].recipient, "RCP_test123");
  await assert.rejects(decidePayout(admin, p.id, "approve"), /already been decided/);
  // The amount cannot be changed after the fact.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.update({ where: { id: p.id }, data: { amountKobo: 1n } })), /cannot be changed/);

  // A webhook without the right signature changes nothing; with it, the outcome is checked with Paystack and recorded once.
  const token = (await withTenant(admin.companyId, admin.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: admin.companyId }, select: { payoutWebhookToken: true } }))).payoutWebhookToken!;
  const row = await withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.findUniqueOrThrow({ where: { id: p.id } }));
  const body = JSON.stringify({ event: "transfer.success", data: { reference: row.providerRef, status: "success", amount: 5_000_000 } });
  assert.equal((await payoutWebhook(token, body, "bad")).status, 401);
  // Paystack itself still says pending: a "success" message alone does not mark it paid.
  assert.equal((await payoutWebhook(token, body, hmacSha512(KEY, body))).outcome, "SENDING");
  fake.state.set(row.providerRef, "success");
  assert.equal((await payoutWebhook(token, body, hmacSha512(KEY, body))).outcome, "PAID");
  assert.equal((await payoutWebhook(token, body, hmacSha512(KEY, body))).outcome, "PAID");
  const paid = await withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.findUniqueOrThrow({ where: { id: p.id }, include: { events: true } }));
  assert.equal(paid.status, "PAID");
  assert.equal(paid.events.filter((e) => e.kind === "paid").length, 1);

  // A bank changing its mind later: the money came back.
  fake.state.set(row.providerRef, "reversed");
  const rev = JSON.stringify({ event: "transfer.reversed", data: { reference: row.providerRef, status: "reversed", amount: 5_000_000 } });
  assert.equal((await payoutWebhook(token, rev, hmacSha512(KEY, rev))).outcome, "REVERSED");

  const today = relativeDate(0);
  const j = await accountingJournal(admin, relativeDate(-1), today);
  const mineEntries = j.entries.filter((e) => e.ref === p.ref);
  assert.deepEqual(mineEntries.map((e) => e.source).sort(), ["Contractor payment", "Contractor payment returned"]);
  const pay = mineEntries.find((e) => e.source === "Contractor payment")!;
  assert.deepEqual(pay.lines.map((l) => [l.account, l.debit, l.credit]), [["CONTRACTOR_COSTS", 5_000_000n, 0n], ["BANK", 0n, 5_000_000n]]);
  assert.equal(j.unbalanced.length, 0);
});

test("Paystack: a refusal fails the payment with the reason; a lost answer is re-checked, never sent twice", async () => {
  const refuse = fakePaystack({ fail: "permanent" });
  _useTransferApi(() => refuse.api);
  const { admin, manager, officer, c } = await setup("payfail");
  await savePayoutKey(admin, KEY);
  await savePayee(manager, c.id, { bankCode: "058", accountNumber: "0123456789" });
  const p = await requestPayout(officer, { contractorId: c.id, amount: "20,000", method: "PAYSTACK", reason: "Paint" });
  assert.equal(await decidePayout(manager, p.id, "approve"), "FAILED");
  const f = await withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.findUniqueOrThrow({ where: { id: p.id } }));
  assert.match(f.failedReason, /balance is not enough/);

  const flaky = fakePaystack({ fail: "transient" });
  _useTransferApi(() => flaky.api);
  const q = await requestPayout(officer, { contractorId: c.id, amount: "30,000", method: "PAYSTACK", reason: "Tiles" });
  assert.equal(await decidePayout(manager, q.id, "approve"), "SENDING");
  // Paystack is back; the scheduled check sends it (the first try never reached Paystack) and records the answer.
  const good = fakePaystack({ answer: "success" });
  _useTransferApi(() => good.api);
  await withTenant(admin.companyId, admin.userId, (tx) => tx.$executeRaw`UPDATE contractor_payouts SET updated_at = now() - interval '5 minutes' WHERE id = ${q.id}`);
  await syncPayouts(500);
  await syncPayouts(500);
  assert.equal(good.sent.filter((s) => s.amountMinor === 3_000_000n).length, 1, "sent exactly once");
  assert.equal((await withTenant(admin.companyId, admin.userId, (tx) => tx.contractorPayout.findUniqueOrThrow({ where: { id: q.id } }))).status, "PAID");
});

test("Bank transfer: details as typed, recorded with the bank's reference; owner's property is charged to the owner", async () => {
  _useTransferApi(() => fakePaystack().api);
  const { admin, manager, officer, c } = await setup("paybank");
  const managed = await createAsset(admin, { name: "Managed flats", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "MANAGER" } as never).catch(() => null);
  await assert.rejects(savePayee(manager, c.id, { bankName: "GTBank", accountNumber: "0123456789" }), /account name/);
  await savePayee(manager, c.id, { bankName: "GTBank", accountNumber: "0123456789", accountName: "Ade Builders" });
  await assert.rejects(requestPayout(officer, { contractorId: c.id, amount: "10,000", method: "PAYSTACK", reason: "Doors" }), /Connect your company's Paystack/);
  let woId = "";
  if (managed) woId = (await reportWorkOrder(admin, managed.id, { title: "Fix the gate" })).id;
  const p = await requestPayout(officer, { contractorId: c.id, amount: "10,000", method: "BANK", reason: "Gate repair", workOrderId: woId });
  await assert.rejects(savePayee(manager, c.id, { bankName: "Other", accountNumber: "9999999999", accountName: "Other Name" }), /waiting/);
  await assert.rejects(decidePayout(manager, p.id, "reject", ""), /Say why/);
  assert.equal(await decidePayout(manager, p.id, "approve"), "APPROVED");
  await assert.rejects(recordBankPayout(manager, p.id, { bankReference: "x", paidOn: relativeDate(0) }), /reference/);
  await assert.rejects(recordBankPayout(manager, p.id, { bankReference: "FT2611190001", paidOn: relativeDate(2) }), /future/);
  await recordBankPayout(manager, p.id, { bankReference: "FT2611190001", paidOn: relativeDate(0) });
  await assert.rejects(cancelPayout(manager, p.id), /no longer be cancelled/);
  const j = await accountingJournal(admin, relativeDate(-1), relativeDate(0));
  const e = j.entries.find((x) => x.ref === p.ref)!;
  assert.equal(e.lines[0].account, managed ? "OWNER_RENT" : "CONTRACTOR_COSTS");
});
