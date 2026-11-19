import { requireMember } from "@/lib/auth";
import { eligibleListings, myPromoEntries, openCampaigns, readPaymentInstructions } from "@/lib/services/promotions";
import { tierOf } from "@/lib/services/tiers";
import { promoFee, tierPerks } from "@/lib/tier-rules";
import { formatKobo, moneySymbol } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { GoldBadge, PromoRibbon } from "@/components/Promo";
import Link from "next/link";
import { cancelBoostAction, requestBoostAction, requestPromoAction, withdrawPromoAction } from "./actions";
import { BOOST_DAYS, myBoosts } from "@/lib/services/boosts";

export const metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

export default async function PromotionsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("listing.manage");
  const [tier, campaigns, entries, instructions, boosts] = await Promise.all([tierOf(member.companyId), openCampaigns(), myPromoEntries(member), readPaymentInstructions(), myBoosts(member)]);
  const now = new Date();
  const boostState = (b: (typeof boosts.boosts)[number]) =>
    b.status === "CANCELLED" ? { pill: "SUSPENDED", label: "Cancelled" }
    : b.status === "AWAITING_PAYMENT" ? { pill: "PENDING", label: "Waiting for payment" }
    : b.endsAt && b.endsAt <= now ? { pill: "DONE", label: "Ended" }
    : b.startsAt && b.startsAt > now ? { pill: "PENDING", label: `Starts ${formatDate(b.startsAt)}` }
    : { pill: "ACTIVE", label: `Boosted until ${b.endsAt ? formatDate(b.endsAt) : "—"}` };
  const perks = tierPerks(tier);
  const options = await Promise.all(campaigns.map(async (c) => ({ c, listings: await eligibleListings(member, c.id) })));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Promotions</h1>
        <p className="muted">Put your published properties into a platform sale. Each one is checked by the platform before the tag and the reviewed price appear. The price you list now stays the “was” price.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <div className="row between"><h2>Your plan level: {perks.label} <GoldBadge tier={tier} /></h2></div>
        <p className="muted">{perks.summary} {perks.freePromos ? "" : "Pro and Elite plans join promotions for free."}</p>
      </section>

      <section className="card stack">
        <h2>Open campaigns ({options.length})</h2>
        {options.length === 0 ? <p className="muted">No campaign is open right now.</p> : (
          <ShowMore noun="more campaigns" limit={3} items={options.map(({ c, listings }) => {
            const fee = promoFee(tier, c.feeKobo, 1);
            return (
              <li key={c.id}><div className="stack" style={{ width: "100%" }}>
                <div className="promo-tags"><PromoRibbon name={c.name} pct={c.maxDiscountPct} theme={c.theme} /><span className="small muted">{formatDate(c.startsOn)} to {formatDate(c.endsOn)}</span></div>
                {c.tagline ? <p className="small">{c.tagline}</p> : null}
                <p className="small muted">Up to {c.maxDiscountPct}% off. Fee per property: {fee === 0n ? "free for you" : formatKobo(fee)}.</p>
                {listings.length === 0 ? <p className="small muted">You have no published property left to add.</p> : (
                  <details className="inline"><summary>Add a property</summary>
                    <form action={requestPromoAction} className="stack">
                      <input type="hidden" name="campaignId" value={c.id} />
                      <div className="fields">
                        <Field label="Property"><select name="listingId" required>{listings.map((l) => <option key={l.id} value={l.id}>{l.title} ({formatKobo(l.priceKobo)})</option>)}</select></Field>
                        <Field label={`Reviewed price (${moneySymbol()})`} hint="Must be lower than the listed price."><input name="promoPrice" inputMode="decimal" required /></Field>
                      </div>
                      {fee > 0n ? <p className="small">You get an invoice for {formatKobo(fee)} to pay online or by bank transfer. The platform reviews the request once it is paid; if it is turned down after payment, the fee is refunded.</p> : null}
                      <button className="btn primary" type="submit">Send to the platform</button>
                    </form>
                  </details>
                )}
              </div></li>
            );
          })} />
        )}
        {instructions && !perks.freePromos ? <details className="inline"><summary>Paying by bank transfer</summary><p style={{ whiteSpace: "pre-line" }}>{instructions}</p><p className="small muted">Use the invoice number as the reference. Paying online confirms at once.</p></details> : null}
      </section>

      <section className="card stack" aria-labelledby="boost-h">
        <h2 id="boost-h">Boost a property</h2>
        <p className="muted">A boosted property shows in a &ldquo;Boosted&rdquo; row above search results it matches, and first among the newest, for the days you pay for. It is always labelled &ldquo;Boosted&rdquo; so seekers know.{perks.autoBoost ? " Your Elite plan already lifts your properties; a boost puts one at the very top." : ""}</p>
        {boosts.perDay <= 0n ? <p className="small muted">Boosts are not on sale at the moment.</p> : boosts.listings.length === 0 ? <p className="small muted">Publish a property to boost it.</p> : (
          <details className="inline"><summary>Boost a property from {formatKobo(boosts.perDay)} a day</summary>
            <form action={requestBoostAction} className="stack">
              <div className="fields">
                <Field label="Property"><select name="listingId" required>{boosts.listings.map((l) => <option key={l.id} value={l.id}>{l.title} ({l.publicRef})</option>)}</select></Field>
                <Field label="How long"><select name="days" defaultValue="7">{BOOST_DAYS.map((d) => <option key={d} value={d}>{d} days · {formatKobo(boosts.perDay * BigInt(d))}</option>)}</select></Field>
              </div>
              <p className="small muted">The boost starts when the invoice is paid (online, or by bank transfer once the platform records it). If the property is already boosted, the new days follow on. Days keep running if you unpublish the property.</p>
              <button className="btn primary" type="submit">Continue to payment</button>
            </form>
          </details>
        )}
        {boosts.boosts.length ? (
          <ShowMore noun="more boosts" limit={4} items={boosts.boosts.map((b) => {
            const st = boostState(b);
            return (
              <li key={b.id}><div className="stack" style={{ width: "100%", gap: 6 }}>
                <div className="row between" style={{ flexWrap: "wrap", gap: 6 }}><div><strong>{b.listing.title}</strong> <span className="small muted">{b.days} days · {formatKobo(b.priceKobo, b.currency)} · <span className="mono">{b.ref}</span></span></div><Pill status={st.pill} label={st.label} /></div>
                {b.status === "AWAITING_PAYMENT" ? (
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {b.invoice?.status === "OPEN" ? <Link className="btn small primary" href={`/app/billing/${b.invoice.id}`}>Pay invoice {b.invoice.ref}</Link> : null}
                    <form action={cancelBoostAction}><input type="hidden" name="boostId" value={b.id} /><button className="btn small" type="submit" data-confirm="Cancel this boost?" data-confirm-body="Its unpaid invoice is cancelled too." data-confirm-ok="Cancel boost">Cancel</button></form>
                  </div>
                ) : null}
              </div></li>
            );
          })} />
        ) : null}
      </section>

      <section className="card stack">
        <h2>Your requests ({entries.length})</h2>
        {entries.length === 0 ? <p className="muted">You have not asked for any property to join a campaign.</p> : (
          <ShowMore noun="more requests" limit={5} items={entries.map((e) => (
            <li key={e.id}><div style={{ width: "100%" }}>
              <div className="row between"><div><strong>{e.listing?.title ?? "Property"}</strong> <span className="small muted">{e.campaign.name} · {formatKobo(e.originalPriceKobo)} to {formatKobo(e.promoPriceKobo)}</span></div><Pill status={e.status === "APPROVED" ? "ACTIVE" : e.status === "REQUESTED" ? "PENDING" : "SUSPENDED"} label={humanize(e.status)} /></div>
              <div className="small muted">Fee: {e.payment ? (e.payment.status === "NOT_REQUIRED" ? "none due" : e.payment.status === "VERIFIED" ? `${formatKobo(e.payment.feeKobo)} paid` : `${formatKobo(e.payment.feeKobo)} to pay`) : "none"}{e.reviewNote ? ` · ${e.reviewNote}` : ""}</div>
              {e.payment?.status === "PENDING" && e.invoice?.status === "OPEN" && e.status === "REQUESTED" ? <Link className="btn small primary" href={`/app/billing/${e.invoice.id}`}>Pay invoice {e.invoice.ref}</Link> : null}
              {e.listing && e.status === "APPROVED" && e.listing.priceKobo !== e.originalPriceKobo ? <p className="small">The listed price changed, so this promotion is paused. Ask again at the new price.</p> : null}
              {e.status === "REQUESTED" ? <form action={withdrawPromoAction}><input type="hidden" name="entryId" value={e.id} /><button className="btn small" type="submit" data-confirm="Withdraw this promotion request?" data-confirm-ok="Withdraw" data-confirm-tone="default">Withdraw</button></form> : null}
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
