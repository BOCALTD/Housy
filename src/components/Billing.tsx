import Link from "next/link";
import { QuickFilter } from "@/components/QuickFilter";
import { allPlans, buyablePlans, myInvoices, payerRegion, readBankInstructions, type Payer } from "@/lib/services/billing";
import { CycleSwitch, PlanCompare } from "@/components/PlanCompare";
import { readYearlyMonths } from "@/lib/services/platform-settings";
import { companySubscription, mySubscription } from "@/lib/services/subscriptions";
import { onlineProviderFor } from "@/lib/services/platform-config";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Pill, ShowMore } from "@/components/ui";
import { autoRenewAction, cancelPlanAction, payInvoiceAction, removeCardAction, useRewardsAction } from "@/app/billing/actions";
import { autoRenewStatus } from "@/lib/services/auto-renew";
import { rewardCredit } from "@/lib/services/reward-credit";

const stateTone = (s: string) => (s === "ACTIVE" || s === "TRIAL" ? "ACTIVE" : s === "GRACE" || s === "READ_ONLY" ? "PENDING" : "SUSPENDED");
const invTone = (s: string) => (s === "PAID" ? "ACTIVE" : s === "OPEN" ? "PENDING" : "SUSPENDED");

/** The plan a person or company holds, what they can buy, and what they have been billed. Shared by the personal and company pages. */
export async function BillingPanel({ payer, from, cycle = "plan" }: { payer: Payer; from: "me" | "app"; cycle?: "plan" | "yearly" }) {
  const [plan, plans, invoices, all] = await Promise.all([
    payer.companyId ? companySubscription(payer.companyId, payer.userId) : mySubscription(payer.userId),
    buyablePlans(payer),
    myInvoices(payer),
    allPlans(payer.companyId ? ["COMPANY"] : ["SEEKER", "AGENT"]),
  ]);
  const [region, yearlyMonths, renew] = await Promise.all([payerRegion(payer), readYearlyMonths(), autoRenewStatus(payer)]);
  const online = !!(await onlineProviderFor(region.country));
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
                  <button className="btn" type="submit" data-confirm="Stop renewing your plan?" data-confirm-body="It stays active until the end of the period you paid for." data-confirm-ok="Stop renewing" data-confirm-tone="default">Stop renewing</button></form></details>
            ) : null}
          </>
        ) : (<><h2>No paid plan</h2><p>{plan.explanation}</p></>)}
      </section>

      {renew.card || (online && plan.sub && plan.sub.plan.priceKobo) ? (
        <section className="card stack" aria-labelledby="card-h">
          <h2 id="card-h">Automatic renewal</h2>
          {renew.card ? (
            <>
              <div className="row between" style={{ flexWrap: "wrap" }}>
                <div><strong>{renew.card.label}</strong> <span className="small muted">expires {String(renew.card.expMonth).padStart(2, "0")}/{String(renew.card.expYear).slice(-2)}</span>{renew.card.expired ? <div className="small" style={{ color: "var(--bad)" }}>This card has expired. Pay your next invoice with a new card and tick &ldquo;renew automatically&rdquo;.</div> : null}</div>
                <Pill status={renew.on ? "ACTIVE" : "PENDING"} label={renew.on ? "On" : "Off"} />
              </div>
              <p className="small muted">{renew.on ? `Your plan renews by charging this card on the renewal date. We remind you 3 days before, with the amount.` : "Your plan does not renew by itself. You get an invoice to pay before it ends."}</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {renew.on ? (
                  <form action={autoRenewAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="on" value="" />
                    <button className="btn" type="submit" data-confirm="Turn off automatic renewal?" data-confirm-body="Your card will not be charged. You will get an invoice to pay before your plan ends." data-confirm-ok="Turn off" data-confirm-tone="default">Turn off</button></form>
                ) : !renew.card.expired && plan.sub && plan.sub.status !== "CANCELLED" ? (
                  <form action={autoRenewAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="on" value="on" />
                    <button className="btn primary" type="submit" data-confirm="Renew automatically with this card?" data-confirm-body={`We will charge your ${renew.card.label} on each renewal date, after reminding you 3 days before.`} data-confirm-ok="Turn on" data-confirm-tone="default">Turn on</button></form>
                ) : null}
                <form action={removeCardAction}><input type="hidden" name="from" value={from} />
                  <button className="btn" type="submit" data-confirm="Remove this card?" data-confirm-body="The card is forgotten here and your plan will not renew automatically." data-confirm-ok="Remove card" data-confirm-tone="danger">Remove card</button></form>
              </div>
            </>
          ) : <p className="small muted">No card is saved. When you next pay for your plan by card, tick &ldquo;renew automatically&rdquo; and it renews by itself, with a reminder 3 days before each charge.</p>}
        </section>
      ) : null}

      {open.length > 0 ? (
        <section className="card stack">
          <h2>Waiting for payment</h2>
          {open.map((i) => (
            <div key={i.id} className="row between">
              <div><strong>{i.description}</strong><div className="small muted">{i.ref} · {formatKobo(i.amountKobo, i.currency)}{i.dueOn ? ` · due ${formatDate(i.dueOn)}` : ""}</div></div>
              <div className="row">
                <Link className="btn" href={`${base}/${i.id}`}>Open</Link>
                {online ? <form action={payInvoiceAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="invoiceId" value={i.id} /><button className="btn primary" type="submit">Pay now</button></form> : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="stack">
        <div className="row between" style={{ flexWrap: "wrap" }}><h2>Plans</h2><div className="row" style={{ flexWrap: "wrap" }}><CycleSwitch yearlyMonths={yearlyMonths} cycle={cycle} hrefFor={(c) => `${base}${c === "yearly" ? "?cycle=yearly" : ""}`} /><Link className="btn" href={from === "app" ? "/app/upgrades" : "/me/upgrades"}>Free trials and promo codes</Link></div></div>
        {!online ? <div className="card"><p className="small muted">Online payment is not connected yet. Choose a plan to get an invoice, then pay by bank transfer and the platform administrator will confirm it.{bank ? "" : " Ask the platform administrator for the account details."}</p></div> : null}
        {payer.companyId ? <PlanCompare audience="COMPANY" plans={all.filter((x) => x.audience === "COMPANY")} buy={{ from }} currentPlanId={plan.sub?.planId ?? null} currency={region.currency} cycle={cycle} yearlyMonths={yearlyMonths} autoRenewOffer={online} /> : (
          <>
            <h3>For people looking for property</h3>
            <PlanCompare audience="SEEKER" plans={all.filter((x) => x.audience === "SEEKER")} buy={{ from }} currentPlanId={plan.sub?.planId ?? null} currency={region.currency} cycle={cycle} yearlyMonths={yearlyMonths} autoRenewOffer={online} />
            <h3>For agents</h3>
            <PlanCompare audience="AGENT" plans={all.filter((x) => x.audience === "AGENT")} buy={{ from }} currentPlanId={plan.sub?.planId ?? null} currency={region.currency} cycle={cycle} yearlyMonths={yearlyMonths} autoRenewOffer={online} />
          </>
        )}
        {plan.sub && plans.some((x) => x.id !== plan.sub!.planId) ? <p className="small muted">Choosing a different plan starts a new period today. Time left on your current plan is not carried over.</p> : null}
      </section>

      <section className="stack">
        <h2>Invoices</h2>
        {invoices.length === 0 ? <p className="muted">Nothing has been billed yet.</p> : (
<QuickFilter label="Search invoices" placeholder="Invoice number, plan or status"><ShowMore limit={5} noun="older invoices" items={invoices.map((i) => (
            <li key={i.id}><div className="row between"><div><Link href={`${base}/${i.id}`}><strong>{i.ref}</strong></Link> <span className="small muted">{i.description} · {formatKobo(i.amountKobo, i.currency)} · {formatDate(i.createdAt)}</span></div><Pill status={invTone(i.status)} label={humanize(i.status)} /></div></li>
          ))} /></QuickFilter>
        )}
      </section>
    </div>
  );
}

export async function InvoicePanel({ payer, from, invoice }: { payer: Payer; from: "me" | "app"; invoice: NonNullable<Awaited<ReturnType<typeof import("@/lib/services/billing").invoiceFor>>> }) {
  const online = !!(await onlineProviderFor((await payerRegion(payer)).country));
  const bank = invoice.status === "OPEN" && !online ? await readBankInstructions() : "";
  const credit = invoice.status === "OPEN" && invoice.purpose === "SUBSCRIPTION" ? await rewardCredit(payer.userId) : null;
  const base = from === "app" ? "/app/billing" : "/me/billing";
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row between"><h2>{invoice.ref}</h2><Pill status={invTone(invoice.status)} label={humanize(invoice.status)} /></div>
        <p>{invoice.description}</p>
        {(invoice.discountKobo > 0n || invoice.creditKobo > 0n) && invoice.listAmountKobo != null ? (
          <p><s className="muted">{formatKobo(invoice.listAmountKobo, invoice.currency)}</s> <strong>{formatKobo(invoice.amountKobo, invoice.currency)}</strong> <span className="small muted">({[invoice.discountKobo > 0n ? `${formatKobo(invoice.discountKobo, invoice.currency)} off with a promo code` : "", invoice.creditKobo > 0n ? `${formatKobo(invoice.creditKobo, invoice.currency)} paid with your rewards` : ""].filter(Boolean).join(", ")})</span></p>
        ) : <p><strong>{formatKobo(invoice.amountKobo, invoice.currency)}</strong></p>}
        {credit && credit.availableKobo > 0n && invoice.status === "OPEN" && invoice.purpose === "SUBSCRIPTION" && invoice.currency === "NGN" ? (
          <div className="flash notice stack" style={{ gap: 8 }}>
            <span>You have <strong>{formatKobo(credit.availableKobo)}</strong> in rewards ready to use. {credit.availableKobo >= invoice.amountKobo ? "They can cover this invoice." : "They can go toward this invoice."}</span>
            <form action={useRewardsAction}><input type="hidden" name="from" value={from} /><input type="hidden" name="invoiceId" value={invoice.id} />
              <button className="btn" type="submit" data-confirm="Use your rewards toward this invoice?" data-confirm-body="Rewards that fit within what is left to pay are used, oldest first, and taken off the amount. They cannot be paid out in cash afterwards." data-confirm-ok="Use rewards" data-confirm-tone="default">Use my rewards</button></form>
          </div>
        ) : null}
        <p className="small muted">Raised {formatDate(invoice.createdAt)}{invoice.dueOn ? ` · due ${formatDate(invoice.dueOn)}` : ""}{invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ""}{invoice.voidReason ? ` · cancelled: ${invoice.voidReason}` : ""}</p>
        {invoice.status === "OPEN" && online ? (
          <form action={payInvoiceAction} className="stack" style={{ gap: 8 }}><input type="hidden" name="from" value={from} /><input type="hidden" name="invoiceId" value={invoice.id} />
            {invoice.purpose === "SUBSCRIPTION" ? <><input type="hidden" name="renewChoice" value="1" /><label className="check"><input type="checkbox" name="autorenew" defaultChecked={invoice.autoRenewConsent || !invoice.renewal} /> <span className="small">Renew automatically with this card. We remind you 3 days before each charge; turn it off at any time in Billing.</span></label></> : null}
            <div><button className="btn primary" type="submit">Pay {formatKobo(invoice.amountKobo, invoice.currency)} now</button></div></form>
        ) : null}
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
            <li key={p.id}><div className="row between"><div><strong>{p.ref}</strong> <span className="small muted">{formatKobo(p.amountKobo, invoice.currency)} · {formatDate(p.createdAt)}{p.failureReason ? ` · ${p.failureReason}` : ""}{p.refundedKobo > 0n ? ` · ${formatKobo(p.refundedKobo)} refunded` : ""}</span></div><Pill status={p.status === "SUCCEEDED" ? "ACTIVE" : p.status === "FAILED" ? "SUSPENDED" : "PENDING"} label={p.status === "REVIEW" ? "Being checked" : humanize(p.status)} /></div></li>
          ))} />
        )}
      </section>
      <p><Link href={base}>Back to billing</Link></p>
    </div>
  );
}
