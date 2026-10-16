"use server";

import { requireMember, requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { baseUrl } from "@/lib/services/delivery";
import { cancelOwn, createSubscriptionInvoice, startPayment, NO_PROVIDER, type Payer } from "@/lib/services/billing";
import { configuredProvider } from "@/lib/payment-providers";

type From = "me" | "app";
const fromOf = (form: FormData): From => (str(form, "from") === "app" ? "app" : "me");
const home = (f: From) => (f === "app" ? "/app/billing" : "/me/billing");

async function payerFor(f: From, manage: boolean): Promise<Payer> {
  if (f === "app") { const m = await requireMember(manage ? "billing.manage" : "billing.view"); return { userId: m.userId, companyId: m.companyId, role: m.role }; }
  const u = await requireUser();
  return { userId: u.id, companyId: null, role: null };
}

/** Raise an invoice for a plan, then send the person to pay for it. Without a payment provider the invoice is kept for a bank transfer. */
export async function payPlanAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => {
    const payer = await payerFor(f, true);
    const inv = await createSubscriptionInvoice(payer, str(form, "planId"));
    return payOrShow(payer, f, inv.id);
  });
}

export async function payInvoiceAction(form: FormData) {
  const f = fromOf(form);
  return act(home(f), async () => {
    const payer = await payerFor(f, true);
    return payOrShow(payer, f, str(form, "invoiceId"));
  });
}

async function payOrShow(payer: Payer, f: From, invoiceId: string): Promise<string> {
  if (!configuredProvider()) return withNotice(`${home(f)}/${invoiceId}`, NO_PROVIDER);
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
