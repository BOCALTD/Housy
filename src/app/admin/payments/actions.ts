"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { recordOfflinePayment, saveBankInstructions, voidInvoice } from "@/lib/services/billing";
import { acceptReviewedPayment, cancelRefund, confirmRefund, requestRefund } from "@/lib/services/refunds";

const back = (v: string) => `/admin/payments?view=${["review", "invoices", "payments", "events"].includes(v) ? v : "review"}`;

export async function recordOfflineAction(form: FormData) {
  return act(back("invoices"), async () => {
    const a = await requirePlatformAdmin();
    await recordOfflinePayment(a.id, str(form, "invoiceId"), { amount: str(form, "amount"), reference: str(form, "reference"), note: str(form, "note") });
    return withNotice(back("invoices"), "Payment recorded and the invoice is paid.");
  });
}
export async function voidInvoiceAction(form: FormData) {
  return act(back("invoices"), async () => { const a = await requirePlatformAdmin(); await voidInvoice(a.id, str(form, "invoiceId"), str(form, "reason")); return withNotice(back("invoices"), "Invoice cancelled."); });
}
export async function refundAction(form: FormData) {
  const to = back(str(form, "view"));
  return act(to, async () => {
    const a = await requirePlatformAdmin();
    const r = await requestRefund(a.id, str(form, "paymentId"), { amount: str(form, "amount"), reason: str(form, "reason") });
    return withNotice(to, r.note);
  });
}
export async function confirmRefundAction(form: FormData) {
  return act(back("payments"), async () => { const a = await requirePlatformAdmin(); await confirmRefund(a.id, str(form, "refundId")); return withNotice(back("payments"), "Refund confirmed and entered in the books."); });
}
export async function cancelRefundAction(form: FormData) {
  return act(back("payments"), async () => { const a = await requirePlatformAdmin(); await cancelRefund(a.id, str(form, "refundId")); return withNotice(back("payments"), "Refund cancelled. The amount can be refunded again."); });
}
export async function acceptReviewAction(form: FormData) {
  return act(back("review"), async () => { const a = await requirePlatformAdmin(); await acceptReviewedPayment(a.id, str(form, "paymentId"), str(form, "note")); return withNotice(back("review"), "Payment accepted and the invoice is paid."); });
}
export async function bankAction(form: FormData) {
  return act(back("invoices"), async () => { const a = await requirePlatformAdmin(); await saveBankInstructions(a.id, str(form, "text")); return withNotice(back("invoices"), "Bank details saved."); });
}
