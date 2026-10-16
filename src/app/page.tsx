import Link from "next/link";
import { PURPOSES } from "@/lib/services/listings";
import { searchListingsRanked } from "@/lib/services/promotions";
import { GoldBadge, PremiumTag, PriceBlock, PromoRibbon } from "@/components/Promo";
import { humanize } from "@/lib/labels";
import { HouseIcon, sp, type SP } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams?: SP }) {
  const filters = {
    q: sp(searchParams, "q"), purpose: sp(searchParams, "purpose"), city: sp(searchParams, "city"),
    maxPrice: sp(searchParams, "maxPrice"), minBeds: sp(searchParams, "minBeds"),
  };
  const listings = await searchListingsRanked(filters);
  const searching = Object.values(filters).some(Boolean);

  return (
    <div className="stack-lg">
      <section className="hero">
        <p className="eyebrow" style={{ color: "inherit", opacity: .8 }}>Property in Nigeria</p>
        <h1>Find property, then verify it before you buy.</h1>
        <p>Every listing here is submitted by a registered company and reviewed before it is published.</p>
        <form className="search" role="search" aria-label="Search properties">
          <input name="city" defaultValue={filters.city ?? ""} placeholder="City, area or state" aria-label="Location" />
          <select name="purpose" defaultValue={filters.purpose ?? ""} aria-label="Purpose">
            <option value="">Buy, rent or lease</option>
            {PURPOSES.map((p) => <option key={p} value={p}>{p === "SALE" ? "Buy" : humanize(p)}</option>)}
          </select>
          <input name="maxPrice" defaultValue={filters.maxPrice ?? ""} placeholder="Max price (₦)" inputMode="decimal" aria-label="Maximum price" />
          <input name="minBeds" defaultValue={filters.minBeds ?? ""} placeholder="Min bedrooms" inputMode="numeric" aria-label="Minimum bedrooms" />
          <button className="btn primary" type="submit">Search</button>
        </form>
      </section>

      <section className="stack">
        <div className="row between">
          <h2>{searching ? `${listings.length} ${listings.length === 1 ? "property" : "properties"} found` : "Latest listings"}</h2>
          {searching ? <Link href="/" className="small">Clear search</Link> : null}
        </div>
        {listings.length === 0 ? (
          <div className="card"><p className="muted">{searching ? "No published properties match that search. Try a wider area or a higher price." : "No properties have been published yet."}</p></div>
        ) : (
          <div className="grid">
            {listings.map((l) => (
              <Link key={l.id} href={`/properties/${l.publicRef}`} className="prop">
                <div className="prop-img"><HouseIcon /></div>
                <div className="prop-body">
                  {l.promo ? <PromoRibbon name={l.promo.campaignName} pct={l.promo.pct} theme={l.promo.theme} /> : null}
                  <span className="promo-tags">
                    <span className="pill brand">{l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`}</span>
                    <PremiumTag tier={l.tier} /><GoldBadge tier={l.tier} />
                  </span>
                  <strong>{l.title}</strong>
                  <PriceBlock priceKobo={l.priceKobo} promo={l.promo} suffix={l.purpose !== "SALE" ? " / year" : ""} />
                  <span className="small muted">
                    {[l.bedrooms != null ? `${l.bedrooms} bed` : null, l.bathrooms != null ? `${l.bathrooms} bath` : null, `${l.city}, ${l.state}`].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
