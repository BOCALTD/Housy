"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { recordLeasePayment, recordPayment } from "@/lib/services/leases";
import {
  decideAdjustment, reconcileReceipt, recordDepositReceived, requestAdjustment, reverseReceipt, settleDeposit,
} from "@/lib/services/ledger";
import { closeLease, decideRenewal, proposeRenewal, recordHandover, recordNotice } from "@/lib/services/lifecycle";

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

export async function proposeRenewalAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("lease.manage");
    await proposeRenewal(member, id, {
      startDate: str(form, "startDate"), endDate: str(form, "endDate"), rent: str(form, "rent"), note: str(form, "note"),
    });
    return withNotice(leasePath(id), "Renewal proposed. It takes effect when someone else approves it.");
  });
}

export async function approveRenewalAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("renewal.approve");
    const created = await decideRenewal(member, str(form, "renewalId"), "approve", str(form, "note"));
    return withNotice(created ? `/app/leases/${encodeURIComponent(created.id)}` : leasePath(id), "Renewal approved. The new lease and its rent schedule are ready.");
  });
}

export async function rejectRenewalAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("lease.manage");
    await decideRenewal(member, str(form, "renewalId"), "reject", str(form, "note"));
    return withNotice(leasePath(id), "Renewal rejected.");
  });
}

export async function recordNoticeAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("lease.manage");
    const { adequacy } = await recordNotice(member, id, {
      givenBy: str(form, "givenBy") as never, givenOn: str(form, "givenOn"), effectiveOn: str(form, "effectiveOn"), reason: str(form, "reason"),
    });
    return withNotice(leasePath(id), adequacy.short
      ? `Notice recorded. It gives ${adequacy.days} days, shorter than the ${adequacy.requiredDays}-day notice period in the lease.`
      : "Notice recorded.");
  });
}

export async function recordHandoverAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("handover.record");
    await recordHandover(member, id, {
      kind: str(form, "kind") as never, handoverOn: str(form, "handoverOn"), keysCount: str(form, "keysCount"),
      meterReadings: str(form, "meterReadings"), conditionNotes: str(form, "conditionNotes"), issues: str(form, "issues"),
      acknowledgedBy: str(form, "acknowledgedBy"),
    });
    return withNotice(leasePath(id), "Handover recorded.");
  });
}

export async function closeLeaseAction(form: FormData) {
  const id = str(form, "leaseId");
  return act(leasePath(id), async () => {
    const member = await requireMember("lease.close");
    const r = await closeLease(member, id, { outcome: str(form, "outcome") as never, closedOn: str(form, "closedOn"), reason: str(form, "reason") });
    return withNotice(leasePath(id), `Lease closed. ${r.removedCharges} future rent charge${r.removedCharges === 1 ? "" : "s"} removed.`);
  });
}
