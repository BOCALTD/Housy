import Link from "next/link";
import { allPlans, payerRegion, previewPromo, type Payer } from "@/lib/services/billing";
import { companySubscription, mySubscription } from "@/lib/services/subscriptions";
import { planFor, trialsAvailable } from "@/lib/services/upgrades";
import { PlanCompare } from "@/components/PlanCompare";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { PERIOD_MONTHS, type Period } from "@/lib/billing-rules";
import type { EntitlementKey } from "@/lib/subscription-rules";
import { Pill } from "@/components/ui";

const tone = (s: string) => (s === "ACTIVE" || s === "TRIAL" ? "ACTIVE" : s === "GRACE" || s === "READ_ONLY" ? "PENDING" : "SUSPENDED");
const perOf = (period: string) => { const m = PERIOD_MONTHS[period as Period]; return m === 1 ? "a month" : m === 12 ? "a year" : m ? `for ${m} months` : ""; };

type AddOn = { title: string; body: string; href: string; cta: string };

/**
 * Everything that grows a business on Housy in one place: the plan you have, free trials you can still start, a promo code box,
 * plans side by side, and the add-ons paid for separately (promoting listings, advertising, a verified badge).
 * People in a company who cannot buy see the same page with "ask your administrator" in place of the buttons.
 */
export async function UpgradesHub({ payer, from, mayBuy, code }: { payer: Payer; from: "me" | "app"; mayBuy: boolean; code: string }) {
  const [plan, plans, trials, region] = await Promise.all([
    payer.companyId ? companySubscription(payer.companyId, payer.userId) : mySubscription(payer.userId),
    allPlans(payer.companyId ? ["COMPANY"] : ["SEEKER", "AGENT"]),
    mayBuy ? trialsAvailable(payer) : Promise.resolve({} as Record<string, number>),
    payerRegion(payer),
  ]);
  const promo = mayBuy && code.trim() ? await previewPromo(payer, code) : null;
  const buy = mayBuy ? { from, back: "upgrades" as const } : undefined;
  const current = plan.sub?.planId ?? null;
  const base = from === "app" ? "/app" : "/me";
  const addOns: AddOn[] = from === "app"
    ? [
        { title: "Promote a listing", body: "Put a property at the top of search results and on the home page for a set number of days.", href: "/app/promotions", cta: "Promote a listing" },
        { title: "Advertise", body: "Run campaigns that show your properties to people searching in the areas you choose.", href: "/app/ads", cta: "Start a campaign" },
        { title: "Get verified", body: "A checked company earns the verified badge, and people contact verified companies first.", href: "/app/verification", cta: "Get verified" },
        { title: "Bulk messages", body: "Email all your clients or tenants at once, each separately, with a link to stop messages.", href: "/app/bulk-messages", cta: "Open bulk messages" },
      ]
    : [
        { title: "Advertise", body: "Show your properties to people searching in the areas you choose.", href: "/me/ads", cta: "Start a campaign" },
        { title: "Get verified", body: "A checked identity earns the verified badge, so agents and owners reply to you sooner.", href: "/me/verification", cta: "Get verified" },
        { title: "Refer and earn", body: "Invite people to Housy and earn rewards when they join and pay for a plan.", href: "/referrals", cta: "Invite people" },
      ];

  return (
    <div className="stack-lg">
      <section className="card stack" aria-labelledby="up-now">
        <div className="row between"><h2 id="up-now">{plan.sub ? plan.sub.plan.name : "Free"}</h2>{plan.sub ? <Pill status={tone(plan.state)} label={plan.state === "TRIAL" ? "Free trial" : humanize(plan.state)} /> : null}</div>
        <p>{plan.explanation}</p>
        {plan.sub ? <p className="small muted">{plan.state === "TRIAL" ? "Trial ends" : "Runs until"} {formatDate(plan.sub.periodEnd)}.{plan.state === "TRIAL" ? " Choose the plan before then to keep everything on." : ""}</p> : null}
        <p className="small"><Link href={`${base}/billing`}>Invoices and payments</Link></p>
      </section>

      {!mayBuy ? <p className="flash" role="status">Only the company administrator can choose a plan or start a trial. Ask them if you need a feature below.</p> : null}

      {mayBuy ? (
        <section className="card stack" aria-labelledby="up-code">
          <h2 id="up-code">Have a promo code?</h2>
          <form method="get" className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 200px" }}>Code<input name="code" defaultValue={promo?.code ?? ""} maxLength={40} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="For example WELCOME25" /></label>
            <button className="btn" type="submit">Apply code</button>
            {promo ? <Link className="btn" href={`${base}/upgrades`}>Remove code</Link> : null}
          </form>
          {promo?.error ? <p className="flash error" role="alert">{promo.error}</p> : promo ? <p className="flash notice" role="status">Code {promo.code} applied. The new prices are shown on the plans it works for.</p> : null}
        </section>
      ) : null}

      <section className="stack" aria-labelledby="up-plans">
        <h2 id="up-plans">Plans</h2>
        {payer.companyId ? <PlanCompare audience="COMPANY" plans={plans.filter((x) => x.audience === "COMPANY")} buy={buy} ask={!mayBuy} currentPlanId={current} currency={region.currency} trials={trials} promo={promo} /> : (
          <>
            <h3>For people looking for property</h3>
            <PlanCompare audience="SEEKER" plans={plans.filter((x) => x.audience === "SEEKER")} buy={buy} currentPlanId={current} currency={region.currency} trials={trials} promo={promo} />
            <h3>For agents</h3>
            <PlanCompare audience="AGENT" plans={plans.filter((x) => x.audience === "AGENT")} buy={buy} currentPlanId={current} currency={region.currency} trials={trials} promo={promo} />
          </>
        )}
        {plan.sub && mayBuy ? <p className="small muted">Choosing a different plan starts a new period today. Time left on your current plan is not carried over.</p> : null}
      </section>

      <section className="stack" aria-labelledby="up-addons">
        <h2 id="up-addons">Add-ons</h2>
        <p className="muted">Paid for when you use them, on top of any plan.</p>
        <ul className="addon-grid" role="list">
          {addOns.map((a) => (
            <li key={a.href} className="card stack">
              <h3>{a.title}</h3>
              <p className="small">{a.body}</p>
              <div style={{ marginTop: "auto" }}><Link className="btn" href={a.href}>{a.cta}</Link></div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * Shown where a feature is locked: which plan unlocks it, from what price, and whether it can be tried free first.
 * Links to the upgrades page; never claims a plan exists when the administrator has not set one up.
 */
export async function UpgradeNudge({ feature, audience, from, what, planName }: { feature: EntitlementKey; audience: "COMPANY" | "SEEKER" | "AGENT"; from: "me" | "app"; what: string; planName?: string | null }) {
  const p = await planFor(feature, audience);
  const href = from === "app" ? "/app/upgrades" : "/me/upgrades";
  return (
    <section className="card stack upgrade-nudge" aria-labelledby={`nudge-${feature}`}>
      <h2 id={`nudge-${feature}`}>Not on your plan</h2>
      <p>{planName ? `The ${planName} plan does not include this.` : "This comes with a paid plan."} {p ? <>The <strong>{p.name}</strong> plan lets you {what}, from {formatKobo(p.priceKobo ?? 0n)} {perOf(p.billingPeriod)}.</> : <>Upgrade to {what}.</>}</p>
      {p && p.trialDays > 0 ? <p className="small">You can try it free for {p.trialDays} days if you have not tried it before.</p> : null}
      <div><Link className="btn primary" href={href}>{p && p.trialDays > 0 ? "See plans and free trials" : "See plans"}</Link></div>
    </section>
  );
}
