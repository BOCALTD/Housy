import Link from "next/link";
import { buyablePlans, myInvoices, readBankInstructions, type Payer } from "@/lib/services/billing";
import { companySubscription, mySubscription } from "@/lib/services/subscriptions";
import { configuredProvider } from "@/lib/payment-providers";
import { ENTITLEMENT_LABELS } from "@/lib/subscription-rules";
import { PERIOD_MONTHS, type Period } from "@/lib/billing-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Pill, ShowMore } from "@/components/ui";
import { cancelPlanAction, payInvoiceAction, payPlanAction } from "@/app/billing/actions";

const stateTone = (s: string) => (s === "ACTIVE" || s === "TRIAL" ? "ACTIVE" : s === "GRACE" || s === "READ_ONLY" ? "PENDING" : "SUSPENDED");
const invTone = (s: string) => (s === "PAID" ? "ACTIVE" : s === "OPEN" ? "PENDING" : "SUSPENDED");

/** The plan a person or company holds, what they can buy, and what they have been billed. Shared by the personal and company pages. */
export async function BillingPanel({ payer, from }: { payer: Payer; from: "me" | "app" }) {
  const [plan, plans, invoices] = await Promise.all([
    payer.companyId ? companySubscription(payer.companyId, payer.userId) : mySubscription(payer.userId),
    buyablePlans(payer),
    myInvoices(payer),
  ]);
  const online = !!configuredProvider();
  const bank = online ? "" : await readBankInstructions();
  const base = from === "app" ? "/app/billing" : "/me/billing";
  const open = invoices.filter((i) => i.status === "OPEN");
  return (
    <div className="stack-lg">
      <section className="card stack">
        {plan.sub ? (
          <>
            <div className="row between"><h2>{plan.sub.plan.name}</h2><Pill status={stateTone(plan.state)} label={humanize(plan.state)} /></div>
            <p>{plan.explanation}</p>
            <p className="small muted">{plan.sub.status === "CANCELLED" ? "Will not renew. " : ""}Runs until {formatDate(plan.sub.periodEnd)}.{plan.next ? ` On ${formatDate(plan.next.on)} it becomes ${humanize(plan.next.becomes).toLowerCase()}.` : ""}</p>
            {plan.sub.status !== "CANCELLED" && plan.sub.plan.priceKobo ? (
              <details className="inline"><summary>Stop renewing</summary>
                <form action={cancelPlanAction} className="stack"><input type="hidden" name="from" value={from} />
                  <p className="small muted">Everything you paid for keeps working until {formatDate(plan.sub.periodEnd)}. You can buy again at any time.</p>
                  <button className="btn" type="submit">Stop renewing</button></form></details>
            ) : null}
          </>
        ) : (<><h2>No paid plan</h2><p>{plan.explanation}</p></>)}
      </section>

      {open.length > 0 ? (
        <section className="card stack">
          <h2>Waiting for payment</h2>
          {open.map((i) => (
            <div key={i.id} className="row between">
              <div><strong>{i.description}</strong><div className="small muted">{i.ref} · {formatKobo(i.amountKobo)}{i.dueOn ? ` · due ${formatDate(i.dueOn)}` : ""}</div></div>
              <div className="row">
                <Link className="btn" href={`${base}/${i.id}`}>Open</Link>
                {online ? <form action={payInvoiceAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="invoiceId" value={i.id} /><button className="btn primary" type="submit">Pay now</button></form> : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="stack">
        <h2>Plans</h2>
        {!online ? <div className="card"><p className="small muted">Online payment is not connected yet. Choose a plan to get an invoice, then pay by bank transfer and the platform administrator will confirm it.{bank ? "" : " Ask the platform administrator for the account details."}</p></div> : null}
        {plans.length === 0 ? <div className="card"><p className="muted">No plans are open for purchase right now.</p></div> : (
          <div className="grid">
            {plans.map((p) => (
              <div key={p.id} className="card stack">
                <h3>{p.name}</h3>
                <p><strong>{formatKobo(p.priceKobo!)}</strong> <span className="small muted">for {PERIOD_MONTHS[p.billingPeriod as Period]} {PERIOD_MONTHS[p.billingPeriod as Period] === 1 ? "month" : "months"}</span></p>
                {p.entitlements.length ? <ul className="small">{p.entitlements.map((e) => <li key={e.id}>{(ENTITLEMENT_LABELS as Record<string, string>)[e.key] ?? humanize(e.key)}{e.limit !== null ? ` (up to ${e.limit})` : ""}</li>)}</ul> : null}
                {plan.sub && plan.sub.planId !== p.id ? <p className="small muted">Choosing this plan starts a new period today. Time left on your current plan is not carried over.</p> : null}
                <form action={payPlanAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="planId" value={p.id} />
                  <button className="btn primary" type="submit">{plan.sub?.planId === p.id ? "Renew" : "Choose"} this plan</button></form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Invoices</h2>
        {invoices.length === 0 ? <p className="muted">Nothing has been billed yet.</p> : (
          <ShowMore limit={5} noun="older invoices" items={invoices.map((i) => (
            <li key={i.id}><div className="row between"><div><Link href={`${base}/${i.id}`}><strong>{i.ref}</strong></Link> <span className="small muted">{i.description} · {formatKobo(i.amountKobo)} · {formatDate(i.createdAt)}</span></div><Pill status={invTone(i.status)} label={humanize(i.status)} /></div></li>
          ))} />
        )}
      </section>
    </div>
  );
}

export async function InvoicePanel({ payer, from, invoice }: { payer: Payer; from: "me" | "app"; invoice: NonNullable<Awaited<ReturnType<typeof import("@/lib/services/billing").invoiceFor>>> }) {
  const online = !!configuredProvider();
  const bank = invoice.status === "OPEN" && !online ? await readBankInstructions() : "";
  const base = from === "app" ? "/app/billing" : "/me/billing";
  void payer;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row between"><h2>{invoice.ref}</h2><Pill status={invTone(invoice.status)} label={humanize(invoice.status)} /></div>
        <p>{invoice.description}</p>
        <p><strong>{formatKobo(invoice.amountKobo)}</strong></p>
        <p className="small muted">Raised {formatDate(invoice.createdAt)}{invoice.dueOn ? ` · due ${formatDate(invoice.dueOn)}` : ""}{invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ""}{invoice.voidReason ? ` · cancelled: ${invoice.voidReason}` : ""}</p>
        {invoice.status === "OPEN" && online ? <form action={payInvoiceAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="invoiceId" value={invoice.id} /><button className="btn primary" type="submit">Pay {formatKobo(invoice.amountKobo)} now</button></form> : null}
        {invoice.status === "OPEN" && !online ? (
          <div className="stack"><h3>Pay by bank transfer</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{bank || "Ask the platform administrator for the account details."}</p>
            <p className="small muted">Use {invoice.ref} as the payment reference. Your plan starts when the administrator confirms the transfer.</p></div>
        ) : null}
      </section>
      <section className="card stack">
        <h3>Payments</h3>
        {invoice.payments.length === 0 ? <p className="muted">No payment has been made yet.</p> : (
          <ShowMore limit={5} noun="more payments" items={invoice.payments.map((p) => (
            <li key={p.id}><div className="row between"><div><strong>{p.ref}</strong> <span className="small muted">{formatKobo(p.amountKobo)} · {formatDate(p.createdAt)}{p.failureReason ? ` · ${p.failureReason}` : ""}{p.refundedKobo > 0n ? ` · ${formatKobo(p.refundedKobo)} refunded` : ""}</span></div><Pill status={p.status === "SUCCEEDED" ? "ACTIVE" : p.status === "FAILED" ? "SUSPENDED" : "PENDING"} label={p.status === "REVIEW" ? "Being checked" : humanize(p.status)} /></div></li>
          ))} />
        )}
      </section>
      <p><Link href={base}>Back to billing</Link></p>
    </div>
  );
}
