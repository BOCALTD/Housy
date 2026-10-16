import { requireMember } from "@/lib/auth";
import { eligibleListings, myPromoEntries, openCampaigns, readPaymentInstructions } from "@/lib/services/promotions";
import { tierOf } from "@/lib/services/tiers";
import { promoFee, tierPerks } from "@/lib/tier-rules";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { GoldBadge, PromoRibbon } from "@/components/Promo";
import { requestPromoAction, withdrawPromoAction } from "./actions";

export const metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

export default async function PromotionsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("listing.manage");
  const [tier, campaigns, entries, instructions] = await Promise.all([tierOf(member.companyId), openCampaigns(), myPromoEntries(member), readPaymentInstructions()]);
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
        <p className="muted">{perks.summary} {perks.freePromos ? "" : "Silver and Gold plans join promotions for free."}</p>
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
                        <Field label="Reviewed price (₦)" hint="Must be lower than the listed price."><input name="promoPrice" inputMode="decimal" required /></Field>
                      </div>
                      {fee > 0n ? <p className="small">After the platform receives {formatKobo(fee)}, it confirms the payment and approves the request.</p> : null}
                      <button className="btn primary" type="submit">Send to the platform</button>
                    </form>
                  </details>
                )}
              </div></li>
            );
          })} />
        )}
        {instructions && !perks.freePromos ? <details className="inline"><summary>How to pay</summary><p style={{ whiteSpace: "pre-line" }}>{instructions}</p></details> : null}
      </section>

      <section className="card stack">
        <h2>Your requests ({entries.length})</h2>
        {entries.length === 0 ? <p className="muted">You have not asked for any property to join a campaign.</p> : (
          <ShowMore noun="more requests" limit={5} items={entries.map((e) => (
            <li key={e.id}><div style={{ width: "100%" }}>
              <div className="row between"><div><strong>{e.listing?.title ?? "Property"}</strong> <span className="small muted">{e.campaign.name} · {formatKobo(e.originalPriceKobo)} to {formatKobo(e.promoPriceKobo)}</span></div><Pill status={e.status === "APPROVED" ? "ACTIVE" : e.status === "REQUESTED" ? "PENDING" : "SUSPENDED"} label={humanize(e.status)} /></div>
              <div className="small muted">Payment: {e.payment ? (e.payment.status === "NOT_REQUIRED" ? "none due" : `${humanize(e.payment.status)} · ${formatKobo(e.payment.feeKobo)}`) : "none"}{e.reviewNote ? ` · ${e.reviewNote}` : ""}</div>
              {e.listing && e.status === "APPROVED" && e.listing.priceKobo !== e.originalPriceKobo ? <p className="small">The listed price changed, so this promotion is paused. Ask again at the new price.</p> : null}
              {e.status === "REQUESTED" ? <form action={withdrawPromoAction}><input type="hidden" name="entryId" value={e.id} /><button className="btn small" type="submit">Withdraw</button></form> : null}
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
