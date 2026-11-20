"use server";

import { requireMember, requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { baseUrl } from "@/lib/services/delivery";
import { startTrial } from "@/lib/services/upgrades";
import { removeCard, setAutoRenew } from "@/lib/services/auto-renew";
import { setRenewConsent, cancelOwn, createSubscriptionInvoice, startPayment, NO_PROVIDER, type Payer } from "@/lib/services/billing";
import { activePaymentProvider } from "@/lib/services/platform-config";

type From = "me" | "app";
const fromOf = (form: FormData): From => (str(form, "from") === "app" ? "app" : "me");
const home = (f: From) => (f === "app" ? "/app/billing" : "/me/billing");
/** Where to come back to: the upgrades page when the form came from there, otherwise billing. */
const backOf = (form: FormData, f: From) => (str(form, "back") === "upgrades" ? (f === "app" ? "/app/upgrades" : "/me/upgrades") : home(f));

async function payerFor(f: From, manage: boolean): Promise<Payer> {
  if (f === "app") { const m = await requireMember(manage ? "billing.manage" : "billing.view"); return { userId: m.userId, companyId: m.companyId, role: m.role }; }
  const u = await requireUser();
  return { userId: u.id, companyId: null, role: null };
}

/** Raise an invoice for a plan, then send the person to pay for it. Without a payment provider the invoice is kept for a bank transfer. */
export async function payPlanAction(form: FormData) {
  const f = fromOf(form);
  return act(backOf(form, f), async () => {
    const payer = await payerFor(f, true);
    const inv = await createSubscriptionInvoice(payer, str(form, "planId"), undefined, str(form, "promo"), str(form, "cycle") === "yearly" ? "yearly" : "plan", { autoRenew: str(form, "autorenew") === "on" });
    if (inv.status === "PAID") return withNotice(backOf(form, f), "Your code covered the whole price: the plan is on now.");
    return payOrShow(payer, f, inv.id);
  });
}

export async function payInvoiceAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => {
    const payer = await payerFor(f, true);
    if (form.has("renewChoice")) await setRenewConsent(payer, str(form, "invoiceId"), str(form, "autorenew") === "on");
    return payOrShow(payer, f, str(form, "invoiceId"));
  });
}

async function payOrShow(payer: Payer, f: From, invoiceId: string): Promise<string> {
  if (!(await activePaymentProvider())) return withNotice(`${home(f)}/${invoiceId}`, NO_PROVIDER);
  const r = await startPayment(payer, invoiceId, `${baseUrl()}/billing/return`);
  return r.checkoutUrl;
}

export async function cancelPlanAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => {
    await cancelOwn(await payerFor(f, true));
    return withNotice(home(f), "Your plan will not renew. It keeps working until the end of the period you paid for.");
  });
}

/** Start a plan's free trial: once per person or company per plan, with no payment details asked for. */
export async function startTrialAction(form: FormData) {
  const f = fromOf(form);
  return act(backOf(form, f), async () => {
    const t = await startTrial(await payerFor(f, true), str(form, "planId"));
    return withNotice(backOf(form, f), `Your ${t.days}-day ${t.plan} trial has started. Everything in the plan is on now.`);
  });
}

/** Turn automatic renewal with the saved card on or off. */
export async function autoRenewAction(form: FormData) {
  const f = fromOf(form);
  return act(`${home(f)}#card-h`, async () => {
    const on = str(form, "on") === "on";
    await setAutoRenew(await payerFor(f, true), on);
    return `${withNotice(home(f), on ? "Automatic renewal is on. We remind you 3 days before each charge." : "Automatic renewal is off. You will get an invoice to pay before your plan ends.")}#card-h`;
  });
}

/** Remove the saved card, which also turns automatic renewal off. */
export async function removeCardAction(form: FormData) {
  const f = fromOf(form);
  return act(`${home(f)}#card-h`, async () => {
    await removeCard(await payerFor(f, true));
    return `${withNotice(home(f), "Your card has been removed. Your plan will not renew automatically.")}#card-h`;
  });
}
