import { HouseIcon } from "@/components/ui";
import { formatKobo } from "@/lib/money";
import type { SponsoredItem } from "@/lib/services/ads";

/**
 * Paid placements. Every one carries the word "Sponsored" in plain sight, sits apart from the ordinary results, and never changes how
 * ordinary results are ordered. A plain link (not a prefetching one) is used so only a person's click is counted.
 */
export function SponsoredStrip({ items, where }: { items: SponsoredItem[]; where: "home" | "search" }) {
  if (items.length === 0) return null;
  return (
    <section className="stack" aria-label="Sponsored properties">
      <div className="row between"><h2>Sponsored</h2><span className="small muted">Paid placement. These are not ranked results.</span></div>
      <div className="grid">
        {items.map((a) => (
          <a key={a.ref} href={`/ads/click/${a.ref}`} rel="sponsored nofollow" className="prop" data-sponsored={where}>
            <div className="prop-img"><HouseIcon /></div>
            <div className="prop-body">
              <span className="promo-tags"><span className="pill disc">Sponsored</span><span className="pill brand">{a.listing.purpose === "SALE" ? "For sale" : `For ${a.listing.purpose.toLowerCase()}`}</span></span>
              <strong>{a.headline || a.listing.title}</strong>
              {a.headline ? <span className="small muted">{a.listing.title}</span> : null}
              <span className="price">{formatKobo(a.listing.priceKobo)}{a.listing.purpose !== "SALE" ? " / year" : ""}</span>
              <span className="small muted">{[a.listing.bedrooms != null ? `${a.listing.bedrooms} bed` : null, a.listing.bathrooms != null ? `${a.listing.bathrooms} bath` : null, `${a.listing.city}, ${a.listing.state}`].filter(Boolean).join(" · ")}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
