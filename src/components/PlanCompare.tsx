import Link from "next/link";
import { FEATURES, includes, type Audience } from "@/lib/plan-features";
import { PERIOD_MONTHS, type Period } from "@/lib/billing-rules";
import { formatKobo } from "@/lib/money";
import { payPlanAction } from "@/app/billing/actions";

type Plan = { id: string; name: string; audience: string; priceKobo: bigint | null; billingPeriod: string; tier: string; entitlements: { key: string; limit: number | null }[] };

const per = (p: Plan) => { const m = PERIOD_MONTHS[p.billingPeriod as Period]; return m === 1 ? "a month" : m === 12 ? "a year" : m ? `for ${m} months` : ""; };

/**
 * Every plan side by side, with the same list of features on each: what a plan includes is ticked, what it lacks is struck through.
 * The last plan, the most complete, is marked. With a payer, plans with a price can be chosen; otherwise each links to sign-up.
 */
export function PlanCompare({ audience, plans, buy, currentPlanId }: { audience: Audience; plans: Plan[]; buy?: { from: "me" | "app" }; currentPlanId?: string | null }) {
  const features = FEATURES[audience];
  const top = plans[plans.length - 1]?.id;
  return (
    // One row of plans: side by side on wide screens, swiped through on narrow ones, never one plan stranded on a row of its own.
    <div className="plans" style={{ "--n": plans.length } as React.CSSProperties} role="list" aria-label="Plans">
      {plans.map((p) => {
        const free = p.priceKobo === 0n || p.billingPeriod === "NONE";
        const priced = !!p.priceKobo && p.priceKobo > 0n && p.billingPeriod !== "NONE";
        return (
          <article role="listitem" key={p.id} className={`plan${p.id === top && plans.length > 1 ? " plan-top" : ""}${p.id === currentPlanId ? " plan-current" : ""}`} aria-labelledby={`plan-${p.id}`}>
            {p.id === top && plans.length > 1 ? <span className="plan-flag">Everything included</span> : null}
            {p.id === currentPlanId ? <span className="plan-flag plan-flag-current">Your plan</span> : null}
            <h3 id={`plan-${p.id}`}>{p.name}</h3>
            <p className="plan-price">{free ? <><strong>₦0</strong> <span>always free</span></> : priced ? <><strong>{formatKobo(p.priceKobo!)}</strong> <span>{per(p)}</span></> : <strong className="plan-ask">Price on request</strong>}</p>
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
                  <form action={payPlanAction}><input type="hidden" name="from" value={buy.from} /><input type="hidden" name="planId" value={p.id} />
                    <button className={`btn${p.id === top ? " primary" : ""}`} type="submit">{currentPlanId === p.id ? "Renew" : "Choose"} {p.name}</button></form>
                ) : free ? <span className="small muted">{currentPlanId ? "" : "What you have now"}</span> : <Link className="btn" href="/support">Ask about {p.name}</Link>
              ) : (
                <Link className={`btn${p.id === top ? " primary" : ""}`} href={audience === "COMPANY" ? "/signup" : "/join"}>{free ? "Start free" : `Get ${p.name}`}</Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
