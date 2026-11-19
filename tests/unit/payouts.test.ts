import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor, balanced } from "../../src/lib/accounting-rules";
import { paystackTransferApi, parseTransferEvent, recipientTypeFor } from "../../src/lib/payment-providers";

test("a contractor payment leaves the bank as a cost, or as the owner's cost on a managed property", () => {
  const own = entryFor({ kind: "PAYOUT", date: "2026-11-19", ref: "PO-2026-AAAA0000", property: "P1", owned: true, amount: 500n, memo: "" })!;
  assert.deepEqual(own.lines.map((l) => [l.account, l.debit, l.credit]), [["CONTRACTOR_COSTS", 500n, 0n], ["BANK", 0n, 500n]]);
  const managed = entryFor({ kind: "PAYOUT", date: "2026-11-19", ref: "x", property: "P2", owned: false, amount: 500n, memo: "" })!;
  assert.equal(managed.lines[0].account, "OWNER_RENT");
  const back = entryFor({ kind: "PAYOUT", date: "2026-11-19", ref: "x", property: "", owned: true, amount: 500n, memo: "", reversed: true })!;
  assert.deepEqual(back.lines.map((l) => [l.account, l.debit, l.credit]), [["CONTRACTOR_COSTS", 0n, 500n], ["BANK", 500n, 0n]]);
  for (const e of [own, managed, back]) assert.ok(balanced(e));
});

test("Paystack transfers: what is sent, how answers are read, and the recipient type by currency", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const reply = (status: number, json: unknown) => (async (url: string, init?: RequestInit) => { seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response(JSON.stringify(json), { status }); }) as unknown as typeof fetch;
  const ok = await paystackTransferApi("sk", reply(200, { status: true, data: { status: "pending", transfer_code: "TRF_9" } })).transfer({ amountMinor: 12345n, recipient: "RCP_1", reference: "housy-po-1", reason: "x", currency: "NGN" });
  assert.deepEqual(ok, { ok: true, status: "pending", transferCode: "TRF_9" });
  assert.deepEqual(seen[0].body, { source: "balance", amount: 12345, recipient: "RCP_1", reference: "housy-po-1", reason: "x", currency: "NGN" });
  const refused = await paystackTransferApi("sk", reply(400, { status: false, message: "Insufficient balance" })).transfer({ amountMinor: 1n, recipient: "r", reference: "x", reason: "", currency: "NGN" });
  assert.equal(!refused.ok && refused.permanent, true);
  const down = await paystackTransferApi("sk", reply(502, {})).transfer({ amountMinor: 1n, recipient: "r", reference: "x", reason: "", currency: "NGN" });
  assert.equal(!down.ok && down.permanent, false);
  const otp = await paystackTransferApi("sk", reply(200, { status: true, data: { status: "otp" } })).transfer({ amountMinor: 1n, recipient: "r", reference: "x", reason: "", currency: "NGN" });
  assert.equal(otp.ok && otp.status, "otp");
  assert.equal(recipientTypeFor("NGN"), "nuban");
  assert.equal(recipientTypeFor("GHS"), "ghipss");
  assert.equal(recipientTypeFor("ZAR"), "basa");
});

test("transfer messages are read; anything else is ignored", () => {
  const e = parseTransferEvent(JSON.stringify({ event: "transfer.failed", data: { reference: "housy-po-1", status: "failed", amount: 500 } }))!;
  assert.deepEqual([e.reference, e.status, e.amountMinor], ["housy-po-1", "failed", 500n]);
  assert.equal(parseTransferEvent(JSON.stringify({ event: "charge.success", data: {} })), null);
  assert.equal(parseTransferEvent("not json"), null);
});
