/**
 * Client payments: a company's bank account and inspection fee, payment links for rent and other amounts, online payments split
 * by Paystack (Housy's commission to Housy, the rest to the company), direct transfers confirmed by the company, and Housy's
 * monthly commission invoice on those. Paystack is a fake that answers like the real API.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withTenant, withUser } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { createLease, recordPayment } from "../../src/lib/services/leases";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { registerSeeker } from "../../src/lib/services/community";
import { confirmBooking, requestInspection, cancelByRequester } from "../../src/lib/services/inspection-bookings";
import { processEvent } from "../../src/lib/services/billing";
import { forgetPlatformConfig, saveCommission } from "../../src/lib/services/platform-config";
import {
  cancelPaymentRequest, checkOnlinePayment, clientPayments, confirmTransfer, invoiceCommissions, myInspectionPayments, myPaymentLink, paymentForPayer,
  paymentSettings, requestOtherPayment, requestRentPayment, saveBankAccount, saveInspectionFee, startOnlinePayment,
} from "../../src/lib/services/client-payments";
import { addMember, newCompany, newPlatformAdmin, relativeDate, withRole } from "./helpers";

const SK = "sk_test_" + "fakeFakeFakeFakeFake1234";
const realFetch = globalThis.fetch;
const sent: { path: string; body: Record<string, unknown> }[] = [];
const verified = new Map<string, { status: string; amount: number }>();

before(() => {
  process.env.PAYSTACK_SECRET_KEY = SK;
  forgetPlatformConfig();
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.hostname, "api.paystack.co", "nothing else is called");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    sent.push({ path: u.pathname, body });
    const ok = (data: unknown) => new Response(JSON.stringify({ status: true, message: "ok", data }), { status: 200 });
    if (u.pathname === "/bank") return ok([{ name: "Test Bank", code: "999" }, { name: "Other Bank", code: "058" }]);
    if (u.pathname === "/bank/resolve") return u.searchParams.get("account_number") === "0000000000" ? new Response(JSON.stringify({ status: false, message: "Could not resolve" }), { status: 422 }) : ok({ account_name: "ACME HOMES LTD" });
    if (u.pathname === "/subaccount") return ok({ subaccount_code: "ACCT_fake123" });
    if (u.pathname.startsWith("/subaccount/")) return ok({});
    if (u.pathname === "/transaction/initialize") return ok({ authorization_url: `https://checkout.paystack.com/${body.reference}` });
    if (u.pathname.startsWith("/transaction/verify/")) {
      const v = verified.get(decodeURIComponent(u.pathname.split("/").pop()!));
      return v ? ok({ status: v.status, amount: v.amount, currency: "NGN", id: 777 }) : new Response(JSON.stringify({ status: false, message: "Transaction reference not found" }), { status: 400 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
after(async () => { globalThis.fetch = realFetch; delete process.env.PAYSTACK_SECRET_KEY; forgetPlatformConfig(); await prisma.$disconnect(); });

const token = (link: string) => link.replace("/pay/", "");

test("a company sets its bank (confirmed by the bank) and fee; rent paid online is split, receipted once, and its commission booked", async () => {
  const admin = await newPlatformAdmin();
  await saveCommission(admin.id, { RENT: "5", INSPECTION: "10", OTHER: "2.5" });
  const co = await newCompany("cp-rent");
  const manager = await addMember(co, "MANAGER", "cpm");
  await assert.rejects(saveBankAccount(manager, { bankCode: "999", accountNumber: "0123456789" }), /permission/);
  await assert.rejects(saveBankAccount(co, { bankCode: "999", accountNumber: "12345" }), /10-digit/);
  await assert.rejects(saveBankAccount(co, { bankCode: "999", accountNumber: "0000000000" }), /did not confirm/);
  const saved = await saveBankAccount(co, { bankCode: "999", accountNumber: "0123456789" });
  assert.deepEqual(saved, { accountName: "ACME HOMES LTD", online: true });
  const split = sent.find((s) => s.path === "/subaccount")!;
  assert.equal(split.body.percentage_charge, 0, "Housy's share is set on each payment, not on the account");
  const info = await paymentSettings(co);
  assert.equal(info.online, true);
  assert.equal(info.commissionBps.RENT, 500);

  const asset = await createAsset(co, { name: "Flat 1", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "MANAGER" } as never);
  const lease = await createLease(co, asset.id, { occupantName: "Tolu Tenant", startDate: relativeDate(-10), endDate: relativeDate(355), rent: "1,000,000", frequency: "YEARLY", graceDays: "0" } as never);
  const charge = await withTenant(co.companyId, co.userId, (tx) => tx.rentCharge.findFirstOrThrow({ where: { leaseId: lease.id } }));
  await assert.rejects(requestRentPayment(withRole(co, "VIEWER"), charge.id, { name: "", email: "" }), /permission/);
  const req = await requestRentPayment(co, charge.id, { name: "Tolu Tenant", email: "tolu@example.test" });
  assert.equal(req.payment.commissionKobo, 5_000_000n, "5% of ₦1,000,000");
  await assert.rejects(requestRentPayment(co, charge.id, { name: "", email: "" }), /already waiting/);

  // The payer sees only what they need.
  const view = (await paymentForPayer(token(req.link)))!;
  assert.equal(view.amountKobo, 100_000_000n);
  assert.equal(view.online, true);
  assert.equal(view.transfer?.accountName, "ACME HOMES LTD");
  assert.equal(await paymentForPayer("not-a-real-token-at-all-xx"), null);

  const url = await startOnlinePayment(token(req.link), { name: "Tolu Tenant", email: "tolu@example.test" }, "https://housy.test");
  const init = sent.filter((s) => s.path === "/transaction/initialize").pop()!;
  assert.ok(url.startsWith("https://checkout.paystack.com/"));
  assert.equal(init.body.subaccount, "ACCT_fake123");
  assert.equal(init.body.transaction_charge, 5_000_000, "Housy's commission goes to Housy");
  assert.equal(init.body.bearer, "subaccount");
  const reference = String(init.body.reference);

  // The wrong amount never counts as paid.
  const wrong = await processEvent({ eventId: `charge.success:w-${reference}`, kind: "PAYMENT_SUCCEEDED", rawKind: "charge.success", reference, amountKobo: 1_000n, currency: "NGN", providerTxId: "1" }, "h1");
  assert.equal(wrong.outcome, "AMOUNT_MISMATCH");
  // Back from checkout: Housy asks Paystack, then Paystack's message arrives too. Settled once.
  verified.set(reference, { status: "success", amount: 100_000_000 });
  assert.equal(await checkOnlinePayment(token(req.link)), "PAID");
  const again = await processEvent({ eventId: `charge.success:${reference}`, kind: "PAYMENT_SUCCEEDED", rawKind: "charge.success", reference, amountKobo: 100_000_000n, currency: "NGN", providerTxId: "777" }, "h2");
  assert.equal(again.outcome, "ALREADY");
  const after1 = await withTenant(co.companyId, co.userId, async (tx) => ({
    charge: await tx.rentCharge.findUniqueOrThrow({ where: { id: charge.id } }),
    receipts: await tx.receipt.count({ where: { leaseId: lease.id } }),
    payment: await tx.clientPayment.findUniqueOrThrow({ where: { id: req.payment.id } }),
  }));
  assert.equal(after1.charge.paidKobo, 100_000_000n, "the rent is cleared");
  assert.equal(after1.receipts, 1, "one receipt");
  assert.equal(after1.payment.method, "ONLINE");
  assert.ok(after1.payment.receiptId);
  assert.equal(after1.payment.tokenHash, null, "the link closes once paid");
  const revenue = await withPlatformAdmin(admin.id, (tx) => tx.financeEntry.findMany({ where: { entryKey: `cp:${req.payment.id}` } }));
  assert.equal(revenue.length, 1);
  assert.equal(revenue[0].amountKobo, 5_000_000n);
  assert.equal(revenue[0].ledger, "COMMISSION");
  // Online payments are never invoiced again: their commission was taken at payment.
  assert.equal(await invoiceCommissions(new Date(Date.now() + 40 * 864e5)), 0);
});

test("other payments by transfer and rent recorded directly are invoiced monthly; links can be renewed and cancelled", async () => {
  const admin = await newPlatformAdmin();
  await saveCommission(admin.id, { RENT: "5", INSPECTION: "10", OTHER: "2.5" });
  const co = await newCompany("cp-transfer");
  const other = await newCompany("cp-intruder");
  await saveBankAccount(co, { bankCode: "058", accountNumber: "0123456780" });
  const r = await requestOtherPayment(co, { description: "Service charge 2027", amount: "200,000", payerName: "Bayo" });
  assert.equal(r.payment.commissionKobo, 500_000n, "2.5% of ₦200,000");
  await assert.rejects(confirmTransfer(other, r.payment.ref, "TRF-1"), /still waiting/, "another company cannot touch it");
  await assert.rejects(confirmTransfer(co, r.payment.ref, ""), /evidence/);
  await confirmTransfer(co, r.payment.ref, "GTB TRF 99812");
  await assert.rejects(confirmTransfer(co, r.payment.ref, "GTB TRF 99812"), /still waiting/, "once only");
  assert.equal(await paymentForPayer(token(r.link)), null, "the paid link closes");

  const c2 = await requestOtherPayment(co, { description: "Legal fee", amount: "50,000", payerName: "Bayo" });
  const renewed = await (await import("../../src/lib/services/client-payments")).newPaymentLink(co, c2.payment.ref);
  assert.equal(await paymentForPayer(token(c2.link)), null, "the old link stops working");
  assert.ok(await paymentForPayer(token(renewed)));
  await cancelPaymentRequest(co, c2.payment.ref, "Agreed to waive it");
  assert.equal(await paymentForPayer(token(renewed)), null);

  // Rent recorded on a lease as received directly owes the rent commission.
  const asset = await createAsset(co, { name: "Flat 2", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "MANAGER" } as never);
  const lease = await createLease(co, asset.id, { occupantName: "Chi", startDate: relativeDate(-10), endDate: relativeDate(355), rent: "600,000", frequency: "YEARLY", graceDays: "0" } as never);
  const charge = await withTenant(co.companyId, co.userId, (tx) => tx.rentCharge.findFirstOrThrow({ where: { leaseId: lease.id } }));
  const waiting = await requestRentPayment(co, charge.id, { name: "Chi", email: "" });
  await recordPayment(co, charge.id, { amount: "600,000", paidOn: relativeDate(0), evidence: "ZENITH 55120", method: "Bank transfer", payerName: "Chi" });
  assert.equal(await paymentForPayer(token(waiting.link)), null, "the waiting rent link closes when the rent is recorded as paid");

  const rows = await clientPayments(co, { status: "PAID" });
  assert.equal(rows.length, 2);
  // Next month: one invoice for ₦5,000 (service charge) + ₦30,000 (rent), each payment invoiced once.
  const nextMonth = new Date(Date.now() + 32 * 864e5);
  assert.ok((await invoiceCommissions(nextMonth)) >= 1);
  const inv = await withPlatformAdmin(admin.id, (tx) => tx.invoice.findFirstOrThrow({ where: { ownerCompanyId: co.companyId, purpose: "COMMISSION" } }));
  assert.equal(inv.amountKobo, 3_500_000n);
  assert.equal(await withPlatformAdmin(admin.id, (tx) => tx.invoice.count({ where: { ownerCompanyId: co.companyId, purpose: "COMMISSION" } })), 1);
  await invoiceCommissions(nextMonth);
  assert.equal(await withPlatformAdmin(admin.id, (tx) => tx.invoice.count({ where: { ownerCompanyId: co.companyId, purpose: "COMMISSION" } })), 1, "running again invoices nothing twice");
});

test("an inspection fee is asked for when the time is confirmed, paid only through Housy, and cancelled with the inspection", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("cp-insp");
  await assert.rejects(saveInspectionFee(co, "100"), /at least ₦500/);
  await saveInspectionFee(co, "5,000");
  await saveBankAccount(co, { bankCode: "999", accountNumber: "0123456781" });
  const agent = await addMember(co, "AGENT", "cpagent");
  const asset = await createAsset(co, { name: "House", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
  await saveListingDraft(co, asset.id, { title: "House to view", purpose: "RENT", price: "2,000,000", city: "Yaba", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, l.id, "approve", "ok");
  const seeker = await registerSeeker({ name: "Seeker Fee", email: `fee-${Date.now()}@example.test`, password: "integration-test-pw" });
  const local = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
  const ref = await requestInspection(seeker.userId, l.publicRef, { name: "Ada", preferredAt: local(new Date(Date.now() + 30 * 3_600_000)) });
  const b = await withTenant(co.companyId, co.userId, (tx) => tx.inspectionBooking.findFirstOrThrow({ where: { ref } }));
  assert.equal((await myInspectionPayments(seeker.userId, [b.id])).length, 0, "nothing is asked before the time is confirmed");
  await confirmBooking(co, b.id, { scheduledAt: local(new Date(Date.now() + 30 * 3_600_000)), durationMinutes: "60", assignedUserId: agent.userId });
  const mine = await myInspectionPayments(seeker.userId, [b.id]);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].amountKobo, 500_000n);
  assert.equal(mine[0].status, "PENDING");
  // Only the person it is addressed to can get a link for it; someone else cannot read it.
  const stranger = await registerSeeker({ name: "Stranger", email: `str-${Date.now()}@example.test`, password: "integration-test-pw" });
  await assert.rejects(myPaymentLink(stranger.userId, mine[0].ref), /not found/);
  assert.equal(await withUser(stranger.userId, (tx) => tx.clientPayment.count({ where: { ref: mine[0].ref } })), 0);
  const link = await myPaymentLink(seeker.userId, mine[0].ref);
  assert.equal((await paymentForPayer(token(link)))!.kind, "INSPECTION");
  // Confirming a new time does not ask twice.
  await confirmBooking(co, b.id, { scheduledAt: local(new Date(Date.now() + 40 * 3_600_000)), durationMinutes: "60", assignedUserId: agent.userId });
  assert.equal((await myInspectionPayments(seeker.userId, [b.id])).length, 1);
  await cancelByRequester(seeker.userId, ref, "Found another place");
  assert.equal((await myInspectionPayments(seeker.userId, [b.id]))[0].status, "CANCELLED", "an unpaid fee is cancelled with the inspection");
  assert.equal(await paymentForPayer(token(link)), null);
});
