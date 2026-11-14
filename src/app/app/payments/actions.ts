"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { cancelPaymentRequest, confirmTransfer, newPaymentLink, requestOtherPayment, requestRentPayment, saveBankAccount, saveInspectionFee } from "@/lib/services/client-payments";

const BACK = "/app/payments";
const withLink = (link: string, notice: string) => `${BACK}?link=${encodeURIComponent(link)}&notice=${encodeURIComponent(notice)}`;

export async function saveBankAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("billing.manage");
    const r = await saveBankAccount(m, { bankCode: str(form, "bankCode"), bankName: str(form, "bankName"), accountNumber: str(form, "accountNumber"), accountName: str(form, "accountName") });
    return withNotice(BACK, r.online ? `Saved. Online payments now settle to ${r.accountName}.` : "Saved. Clients see this account for bank transfers.");
  });
}

export async function saveFeeAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("billing.manage");
    await saveInspectionFee(m, str(form, "fee"));
    return withNotice(BACK, "Inspection fee saved. It applies to inspections you confirm from now on.");
  });
}

export async function requestOtherAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payment.record");
    const r = await requestOtherPayment(m, { description: str(form, "description"), amount: str(form, "amount"), payerName: str(form, "payerName"), payerEmail: str(form, "payerEmail") });
    return withLink(r.link, "Payment link made. Copy it and send it to the payer.");
  });
}

export async function requestRentAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(`/app/leases/${leaseId}`, async () => {
    const m = await requireMember("payment.record");
    const r = await requestRentPayment(m, str(form, "chargeId"), { name: str(form, "payerName"), email: str(form, "payerEmail") });
    return withLink(r.link, "Rent payment link made. Copy it and send it to the tenant.");
  });
}

export async function newLinkAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payment.record");
    const link = await newPaymentLink(m, str(form, "ref"));
    return withLink(link, "New link made. The old link no longer works.");
  });
}

export async function confirmTransferAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payment.record");
    await confirmTransfer(m, str(form, "ref"), str(form, "evidence"));
    return withNotice(BACK, "Marked as paid by transfer.");
  });
}

export async function cancelRequestAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payment.record");
    await cancelPaymentRequest(m, str(form, "ref"), str(form, "reason"));
    return withNotice(BACK, "Payment request cancelled. Its link no longer works.");
  });
}
