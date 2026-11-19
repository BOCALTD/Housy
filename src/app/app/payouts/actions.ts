"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { cancelPayout, decidePayout, recordBankPayout, refreshStripePayee, requestPayout, savePayee, savePayoutKey, stripePayeeLink } from "@/lib/services/payouts";

const BACK = "/app/payouts";

export async function savePayoutKeyAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("settings.manage");
    const key = str(form, "key");
    const disconnect = str(form, "intent") === "disconnect";
    if (!disconnect && !key) throw new Error("Paste the secret key from Paystack");
    await savePayoutKey(m, disconnect ? "" : key);
    return withNotice(BACK, disconnect ? "Paystack disconnected. Payments can still be recorded as bank transfers." : "Paystack connected. Add the payout address to your Paystack dashboard (shown below).");
  });
}

export async function savePayeeAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.approve");
    const d = await savePayee(m, str(form, "contractorId"), { bankCode: str(form, "bankCode"), bankName: str(form, "bankName"), accountNumber: str(form, "accountNumber"), accountName: str(form, "accountName") });
    return withNotice(BACK, `Saved: ${d.accountName}, ${d.bankName} ending ${d.accountNumber.slice(-4)}.`);
  });
}

export async function stripePayeeAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.approve");
    const url = await stripePayeeLink(m, str(form, "contractorId"), str(form, "email"), await siteOrigin());
    return `${BACK}?notice=${encodeURIComponent("Send this Stripe set-up link to the contractor. It works once and expires; make a new one if needed.")}&link=${encodeURIComponent(url)}`;
  });
}

export async function refreshStripeAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.request");
    const ready = await refreshStripePayee(m, str(form, "contractorId"));
    return withNotice(BACK, ready ? "Stripe has finished checking the contractor. They can be paid through Stripe." : "Stripe has not finished checking the contractor yet.");
  });
}

export async function requestPayoutAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.request");
    const p = await requestPayout(m, { contractorId: str(form, "contractorId"), amount: str(form, "amount"), method: str(form, "method") as "PAYSTACK", reason: str(form, "reason"), workOrderId: str(form, "workOrderId") });
    return withNotice(BACK, `Payment ${p.ref} is waiting for another person to approve it.`);
  });
}

export async function decidePayoutAction(form: FormData) {
  const r = await act(BACK, async () => {
    const m = await requireMember("payout.approve");
    const decision = str(form, "decision") === "reject" ? "reject" : "approve";
    const status = await decidePayout(m, str(form, "id"), decision, str(form, "note"), await siteOrigin());
    const msg = decision === "reject" ? "Payment rejected." : status === "PAID" ? "Approved and paid." : status === "SENDING" ? "Approved. Paystack is sending the money; this page updates when it confirms." : status === "FAILED" ? "Approved, but the payment did not go through. See the reason below." : "Approved. Finish paying below.";
    return status === "FAILED" ? `${BACK}?warning=${encodeURIComponent(msg)}` : withNotice(BACK, msg);
  });
  return r;
}

export async function recordBankPayoutAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.approve");
    await recordBankPayout(m, str(form, "id"), { bankReference: str(form, "bankReference"), paidOn: str(form, "paidOn") });
    return withNotice(BACK, "Recorded as paid.");
  });
}

export async function cancelPayoutAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("payout.request");
    await cancelPayout(m, str(form, "id"));
    return withNotice(BACK, "Payment cancelled.");
  });
}

export async function goPayAction(form: FormData) {
  const url = str(form, "url");
  if (url.startsWith("https://checkout.stripe.com/")) redirect(url);
  redirect(BACK);
}
