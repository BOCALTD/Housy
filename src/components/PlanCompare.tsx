import Link from "next/link";
import { FEATURES, includes, type Audience } from "@/lib/plan-features";
import { PERIOD_MONTHS, yearlyOffered, yearlyPrice, yearlySaving, type Period } from "@/lib/billing-rules";
import { formatKobo } from "@/lib/money";
import { payPlanAction, startTrialAction } from "@/app/billing/actions";
import type { PromoPreview } from "@/lib/services/billing";

type Plan = { id: string; name: string; audience: string; priceKobo: bigint | null; billingPeriod: string; tier: string; entitlements: { key: string; limit: number | null }[]; prices?: { currency: string; amountMinor: bigint }[] };

/** A plan's price for the viewer: in their currency when the plan is priced in it, otherwise the naira price. */
const priceIn = (p: Plan, currency: string) => {
  const local = currency !== "NGN" ? p.prices?.find((x) => x.currency === currency) : undefined;
  return local ? { amount: local.amountMinor, currency } : { amount: p.priceKobo ?? 0n, currency: "NGN" };
};

const per = (p: Plan) => { const m = PERIOD_MONTHS[p.billingPeriod as Period]; return m === 1 ? "a month" : m === 12 ? "a year" : m ? `for ${m} months` : ""; };

/**
 * Every plan side by side, with the same list of features on each: what a plan includes is ticked, what it lacks is struck through.
 * The last plan, the most complete, is marked. With a payer, plans with a price can be chosen; otherwise each links to sign-up.
 */
/**
 * Monthly or yearly: links that switch the plans below between the two, keeping the other settings of the page.
 * Shown only while the administrator offers yearly payment.
 */
export function CycleSwitch({ yearlyMonths, cycle, hrefFor }: { yearlyMonths: number; cycle: "plan" | "yearly"; hrefFor: (c: "plan" | "yearly") => string }) {
  if (!(yearlyMonths >= 1 && yearlyMonths < 12)) return null;
  return (
    <div className="cycle-switch" role="group" aria-label="How often to pay">
      <Link className={`btn${cycle === "plan" ? " primary" : ""}`} aria-current={cycle === "plan" ? "true" : undefined} href={hrefFor("plan")} scroll={false}>Monthly</Link>
      <Link className={`btn${cycle === "yearly" ? " primary" : ""}`} aria-current={cycle === "yearly" ? "true" : undefined} href={hrefFor("yearly")} scroll={false}>Yearly <span className="cycle-save">{yearlySaving(yearlyMonths)}</span></Link>
    </div>
  );
}

export function PlanCompare({ audience, plans, buy, currentPlanId, currency = "NGN", trials = {}, promo = null, ask = false, cycle = "plan", yearlyMonths = 0, autoRenewOffer = false }: {
  audience: Audience; plans: Plan[]; buy?: { from: "me" | "app"; back?: "upgrades" }; currentPlanId?: string | null; currency?: string;
  /** Plans this payer can still try free, with the number of days. */ trials?: Record<string, number>;
  /** A code the person typed, already checked against each plan. */ promo?: PromoPreview | null;
  /** Signed in but not allowed to buy (a company member who is not the administrator). */ ask?: boolean;
  /** Offer "renew automatically with this card" on plan forms (an online card provider is connected). */ autoRenewOffer?: boolean;
  /** Show yearly prices for monthly plans (while the administrator offers them: a year costs `yearlyMonths` months). */ cycle?: "plan" | "yearly"; yearlyMonths?: number;
}) {
  const features = FEATURES[audience];
  const top = plans[plans.length - 1]?.id;
  return (
    // One row of plans: side by side on wide screens, swiped through on narrow ones, never one plan stranded on a row of its own.
    <div className="plans" style={{ "--n": plans.length } as React.CSSProperties} role="list" aria-label="Plans">
      {plans.map((p) => {
        const free = p.priceKobo === 0n || p.billingPeriod === "NONE";
        const priced = !!p.priceKobo && p.priceKobo > 0n && p.billingPeriod !== "NONE";
        const deal = promo && !promo.error ? promo.byPlan[p.id] : undefined;
        const cut = deal && "pay" in deal ? deal : null;
        const trialDays = buy ? trials[p.id] : undefined;
        const yearly = cycle === "yearly" && priced && yearlyOffered(p.billingPeriod, yearlyMonths);
        const shown = priceIn(p, currency);
        const yearAmount = yearly ? yearlyPrice(shown.amount, yearlyMonths) : 0n;
        return (
          <article role="listitem" key={p.id} className={`plan${p.id === top && plans.length > 1 ? " plan-top" : ""}${p.id === currentPlanId ? " plan-current" : ""}`} aria-labelledby={`plan-${p.id}`}>
            {p.id === top && plans.length > 1 ? <span className="plan-flag">Everything included</span> : null}
            {p.id === currentPlanId ? <span className="plan-flag plan-flag-current">Your plan</span> : null}
            <h3 id={`plan-${p.id}`}>{p.name}</h3>
            <p className="plan-price">{free ? <><strong>Free</strong> <span>always</span></> : priced ? (cut ? <><s className="muted">{formatKobo(cut.list, cut.currency)}</s> <strong>{formatKobo(cut.pay, cut.currency)}</strong> <span>{cut.pay === 0n ? "first period free" : `${yearly ? "a year" : per(p)}, first period`}</span></> : yearly ? <><strong>{formatKobo(yearAmount, shown.currency)}</strong> <span>a year</span><span className="plan-sub">{formatKobo(yearAmount / 12n, shown.currency)} a month · {yearlySaving(yearlyMonths)}</span></> : <><strong>{formatKobo(shown.amount, shown.currency)}</strong> <span>{per(p)}</span></>) : <strong className="plan-ask">Price on request</strong>}</p>
            {deal && "problem" in deal ? <p className="small muted">Code {promo!.code}: {deal.problem.replace(/^That code /, "")}.</p> : null}
            {trialDays ? <p className="small"><strong>Try it free for {trialDays} days.</strong> No payment needed to start.</p> : null}
            <ul className="plan-features">
              {features.map((f) => {
                const has = includes(p, f);
                return (
                  <li key={f.id} className={has.yes ? "yes" : "no"}>
                    <span className="plan-mark" aria-hidden="true">{has.yes ? "✓" : "✕"}</span>
                    {has.yes ? <span>{f.label}{has.limit != null ? ` (up to ${has.limit})` : ""}</span> : <s><span className="visually-hidden">Not included: </span>{f.label}</s>}
                  </li>
                );
              })}
            </ul>
            <div className="plan-cta">
              {buy ? (
                priced ? (
                  <div className="stack" style={{ gap: 8 }}>
                    {trialDays ? (
                      <form action={startTrialAction}><input type="hidden" name="from" value={buy.from} /><input type="hidden" name="planId" value={p.id} />{buy.back ? <input type="hidden" name="back" value={buy.back} /> : null}
                        <button className="btn primary" type="submit" data-confirm={`Start your ${trialDays}-day ${p.name} trial?`} data-confirm-body={`Everything in ${p.name} switches on now for ${trialDays} days. You can try each plan once. Nothing is charged; choose the plan before the trial ends to keep it.`} data-confirm-ok="Start free trial" data-confirm-tone="default">Start {trialDays}-day free trial</button></form>
                    ) : null}
                    <form action={payPlanAction}><input type="hidden" name="from" value={buy.from} /><input type="hidden" name="planId" value={p.id} />{buy.back ? <input type="hidden" name="back" value={buy.back} /> : null}{cut ? <input type="hidden" name="promo" value={promo!.code} /> : null}{yearly ? <input type="hidden" name="cycle" value="yearly" /> : null}
                      {autoRenewOffer && !(cut && cut.pay === 0n) ? <label className="check plan-autorenew"><input type="checkbox" name="autorenew" defaultChecked /> <span>Renew automatically with this card. We remind you 3 days before each charge; turn it off at any time in Billing.</span></label> : null}
                      <button className={`btn${p.id === top && !trialDays ? " primary" : ""}`} type="submit"{...(cut && cut.pay === 0n ? { "data-confirm": `Use code ${promo!.code} for ${p.name}?`, "data-confirm-body": "The code covers the whole first period, so the plan starts straight away.", "data-confirm-ok": "Use code", "data-confirm-tone": "default" } : {})}>{currentPlanId === p.id ? "Renew" : "Choose"} {p.name}{cut ? ` for ${formatKobo(cut.pay, cut.currency)}` : yearly ? " yearly" : ""}</button></form>
                  </div>
                ) : free ? <span className="small muted">{currentPlanId ? "" : "What you have now"}</span> : <Link className="btn" href="/support">Ask about {p.name}</Link>
              ) : ask ? <span className="small muted">{p.id === currentPlanId ? "Your company's plan" : "Ask your administrator"}</span> : (
                <Link className={`btn${p.id === top ? " primary" : ""}`} href={audience === "COMPANY" ? "/join?as=company" : "/join?as=agent"}>{free ? "Start free" : `Get ${p.name}`}</Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
