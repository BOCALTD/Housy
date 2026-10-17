import Link from "next/link";
import { PromoSlides } from "@/components/PromoSlides";
import { HeroRotator } from "@/components/HeroRotator";
import { Carousel } from "@/components/Carousel";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PURPOSES } from "@/lib/services/listings";
import { searchListingsRanked } from "@/lib/services/promotions";
import { homeSections, KIND_LABEL, type Kind } from "@/lib/services/completed";
import { DoneCard } from "@/components/Done";
import { GoldBadge, PremiumTag, PriceBlock, PromoRibbon } from "@/components/Promo";
import { humanize } from "@/lib/labels";
import { PropPhoto, sp, type SP } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { saveSearchAction } from "@/app/me/saved/actions";
import { headers } from "next/headers";
import { sponsoredFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { ModeSwitch } from "@/components/ModeSwitch";
import { SponsoredStrip } from "@/components/Sponsored";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams?: SP }) {
  const filters = {
    q: sp(searchParams, "q"), purpose: sp(searchParams, "purpose"), city: sp(searchParams, "city"),
    maxPrice: sp(searchParams, "maxPrice"), minBeds: sp(searchParams, "minBeds"),
  };
  const searching = Object.values(filters).some(Boolean);
  const bot = isBot(headers().get("user-agent"));
  const [listings, done, sponsored] = await Promise.all([searchListingsRanked(filters), homeSections(), sponsoredFor(searching ? "SEARCH_TOP" : "HOME_FEATURED", { filters, bot }).catch(() => [])]);
  const session = searching ? await getSession() : null;
  const promoted = searching ? [] : listings.filter((l) => l.promo);
  const gridListings = searching ? listings : listings.filter((l) => !l.promo);

  return (
    <div className="stack-lg">
      <ModeSwitch active="listings" />
      <section className="hero">
        <span className="hero-orb a" aria-hidden="true" /><span className="hero-orb b" aria-hidden="true" /><span className="hero-orb c" aria-hidden="true" />
        <HeroRotator />
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
        <p className="small" style={{ margin: 0 }}><Link href="/find" style={{ color: "inherit", textDecoration: "underline" }}>Describe what you want in a sentence</Link> · <Link href="/map" style={{ color: "inherit", textDecoration: "underline" }}>See properties on a map</Link></p>
      </section>

      {promoted.length > 0 ? <PromoSlides slides={promoted.slice(0, 8).map((l) => ({
        href: `/properties/${l.publicRef}`, title: l.title, place: `${l.city}, ${l.state}`, purpose: l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`,
        name: l.promo!.campaignName, tagline: l.promo!.tagline, pct: l.promo!.pct, was: formatKobo(l.promo!.originalKobo) + (l.purpose !== "SALE" ? " / year" : ""),
        now: formatKobo(l.promo!.promoKobo) + (l.purpose !== "SALE" ? " / year" : ""), save: formatKobo(l.promo!.originalKobo - l.promo!.promoKobo), ends: formatDate(l.promo!.endsOn), theme: l.promo!.theme, photo: l.coverPhotoId ? `/photos/${l.coverPhotoId}` : null,
      }))} /> : null}
      <SponsoredStrip items={sponsored} where={searching ? "search" : "home"} />

      <section className="stack">
        <div className="row between">
          <h2>{searching ? `${listings.length} ${listings.length === 1 ? "property" : "properties"} found` : "Latest listings"}</h2>
          {searching ? <Link href="/" className="small">Clear search</Link> : null}
        </div>
        {searching && session ? (
          <details className="inline"><summary>Save this search and get alerts</summary>
            <form action={saveSearchAction} className="stack">
              <input type="hidden" name="back" value="/" />
              {(["city", "purpose", "q", "maxPrice", "minBeds"] as const).map((k) => filters[k] ? <input key={k} type="hidden" name={k} value={filters[k]} /> : null)}
              <label className="field">Name this search<input name="name" required maxLength={80} defaultValue={[filters.city, filters.purpose === "SALE" ? "Buy" : filters.purpose ? humanize(filters.purpose) : ""].filter(Boolean).join(" ") || "My search"} /></label>
              <button className="btn" type="submit">Save search</button>
            </form></details>
        ) : searching ? <p className="small muted"><Link href="/login">Sign in</Link> to save this search and be told about new matches.</p> : null}
        {listings.length === 0 ? (
          <div className="card"><p className="muted">{searching ? "No published properties match that search. Try a wider area or a higher price." : "No properties have been published yet."}</p></div>
        ) : (
          searching ? (
            <div className="grid">
            {gridListings.map((l) => (
              <Link key={l.id} href={`/properties/${l.publicRef}`} className={`prop${l.promo ? " has-promo" : ""}`}>
                <div className="prop-img"><PropPhoto id={l.coverPhotoId} /></div>
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
          ) : (
            <Carousel label="Latest listings" few={gridListings.length <= 3}>
            {gridListings.map((l) => (
              <Link key={l.id} href={`/properties/${l.publicRef}`} className={`prop${l.promo ? " has-promo" : ""}`}>
                <div className="prop-img"><PropPhoto id={l.coverPhotoId} /></div>
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
            </Carousel>
          )
        )}
      </section>
      {(Object.keys(KIND_LABEL) as Kind[]).some((k) => done[k].length) ? (
        <section className="stack">
          <div className="row between"><h2>Recently completed</h2><Link href="/completed" className="small">See all</Link></div>
          {(Object.keys(KIND_LABEL) as Kind[]).filter((k) => done[k].length).map((k) => (
            <div key={k} className="stack"><h3>{KIND_LABEL[k]}</h3><div className="grid">{done[k].map((c) => <DoneCard key={c.id} c={c} />)}</div><Link href={`/completed?kind=${k}`} className="small">More {KIND_LABEL[k].toLowerCase()}</Link></div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
