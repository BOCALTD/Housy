"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { recordLeasePayment, recordPayment } from "@/lib/services/leases";
import {
  decideAdjustment, reconcileReceipt, recordDepositReceived, requestAdjustment, reverseReceipt, settleDeposit,
} from "@/lib/services/ledger";

const leasePath = (id: string) => `/app/leases/${encodeURIComponent(id)}`;

export async function recordLeasePaymentAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("payment.record");
    const input = {
      amount: str(form, "amount"), paidOn: str(form, "paidOn"), evidence: str(form, "evidence"),
      method: str(form, "method"), payerName: str(form, "payerName"),
    };
    const chargeId = optStr(form, "chargeId");
    const receipt = chargeId ? await recordPayment(member, chargeId, input) : await recordLeasePayment(member, id, input);
    return withNotice(leasePath(id), `Receipt ${receipt.no} issued.`);
  });
}

export async function reverseReceiptAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("payment.reverse");
    await reverseReceipt(member, str(form, "receiptId"), str(form, "reason"));
    return withNotice(leasePath(id), "Receipt reversed. The charges it paid are unpaid again.");
  });
}

export async function reconcileReceiptAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("payment.reconcile");
    await reconcileReceipt(member, str(form, "receiptId"), { statementRef: str(form, "statementRef"), note: str(form, "note") });
    return withNotice(leasePath(id), "Receipt reconciled.");
  });
}

export async function requestAdjustmentAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("adjustment.request");
    await requestAdjustment(member, str(form, "chargeId"), {
      kind: str(form, "kind") as never, direction: optStr(form, "direction") as never,
      amount: str(form, "amount"), reason: str(form, "reason"),
    });
    return withNotice(leasePath(id), "Adjustment requested. It takes effect when someone else approves it.");
  });
}

export async function approveAdjustmentAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("adjustment.approve");
    await decideAdjustment(member, str(form, "adjustmentId"), "approve", str(form, "note"));
    return withNotice(leasePath(id), "Adjustment approved.");
  });
}

export async function rejectAdjustmentAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("adjustment.approve");
    await decideAdjustment(member, str(form, "adjustmentId"), "reject", str(form, "note"));
    return withNotice(leasePath(id), "Adjustment rejected.");
  });
}

export async function depositReceivedAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("deposit.manage");
    await recordDepositReceived(member, id, {
      amount: str(form, "amount"), receivedOn: str(form, "receivedOn"), evidence: str(form, "evidence"),
    });
    return withNotice(leasePath(id), "Deposit recorded.");
  });
}

export async function settleDepositAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("deposit.settle");
    await settleDeposit(member, id, {
      kind: str(form, "kind") as never, amount: str(form, "amount"), reason: str(form, "reason"), evidence: str(form, "evidence"),
    });
    return withNotice(leasePath(id), "Deposit settlement recorded.");
  });
}
