import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HomeHero } from "@/components/HomeHero";
import { Carousel } from "@/components/Carousel";
import { CountUp } from "@/components/CountUp";
import { ListingCard } from "@/components/ListingCard";
import { TrustBadge } from "@/components/TrustBadge";
import { Icon } from "@/components/Icons";
import { SponsoredStrip } from "@/components/Sponsored";
import { ModeSwitch } from "@/components/ModeSwitch";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PLATFORM_NAME } from "@/lib/labels";
import { countryName, visitorCountry } from "@/lib/countries";
import { searchListingsRanked } from "@/lib/services/promotions";
import { cityCounts, latestReviews, publicPartners, siteCounts } from "@/lib/services/home";
import { directory } from "@/lib/services/community";
import { trustMany } from "@/lib/services/kyc";
import { sponsoredFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { sp, type SP } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { suggestedListings } from "@/lib/services/signals";
import { publicListingsByRefs } from "@/lib/services/listings";
import { decorateListings } from "@/lib/services/promotions";

export const dynamic = "force-dynamic";

const HERO = [
  { src: "/stock/hero-1.jpg", alt: "A modern two-storey house at dusk" },
  { src: "/stock/hero-2.jpg", alt: "A white house with a swimming pool and palm trees" },
  { src: "/stock/hero-3.jpg", alt: "A contemporary villa with a pool" },
];
const COUNT_ICONS = [Icon.building, Icon.person, Icon.home, Icon.handshake, Icon.pin];
const initials = (s: string) => s.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function SectionHead({ kicker, title, text, link }: { kicker: string; title: string; text?: string; link?: { href: string; label: string } }) {
  return (
    <div className="sec-head">
      <div><p className="sec-kicker">{kicker}</p><h2>{title}</h2>{text ? <p>{text}</p> : null}</div>
      {link ? <Link className="sec-link" href={link.href}>{link.label}</Link> : null}
    </div>
  );
}

export default async function HomePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const filters = {
    q: sp(searchParams, "q"), purpose: sp(searchParams, "purpose"), city: sp(searchParams, "city"),
    maxPrice: sp(searchParams, "maxPrice"), minBeds: sp(searchParams, "minBeds"),
  };
  const searching = Object.values(filters).some(Boolean);
  // Searches live on the browse page now; old links to "/?city=..." still work.
  if (searching) {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    redirect(`/browse?${q.toString()}`);
  }
  const h = await headers();
  const bot = isBot(h.get("user-agent"));
  const country = visitorCountry(h);
  const session = await getSession();
  const [listings, sponsored, picks] = await Promise.all([
    searchListingsRanked(filters),
    sponsoredFor("HOME_FEATURED", { filters, bot }).catch(() => []),
    session ? suggestedListings(session.user.id, 10).catch(() => null) : Promise.resolve(null),
  ]);
  // Suggestions from what this person has looked at, saved and asked about; each says why. Shown only when there are some.
  const pickRows = picks?.length ? await decorateListings(await publicListingsByRefs(picks.map((p) => p.publicRef)), false) : [];
  const picked = (picks ?? []).map((p) => ({ why: p.why, l: pickRows.find((r) => r.publicRef === p.publicRef) })).filter((x): x is { why: string[]; l: (typeof pickRows)[number] } => !!x.l);

  const search = (
    <form className="hx-search" role="search" aria-label="Search properties" action="/browse">
      <fieldset className="hx-tabs">
        <legend>What are you looking for?</legend>
        {[["", "All"], ["SALE", "Buy"], ["RENT", "Rent"], ["LEASE", "Lease"]].map(([v, l]) => (
          <label key={v}><input type="radio" name="purpose" value={v} defaultChecked={(filters.purpose ?? "") === v} />{l}</label>
        ))}
      </fieldset>
      <div className="hx-fields">
        <input name="city" defaultValue={filters.city ?? ""} placeholder="City, area or state" aria-label="Location" />
        <input name="maxPrice" defaultValue={filters.maxPrice ?? ""} placeholder="Max price (₦)" inputMode="decimal" aria-label="Maximum price" />
        <input name="minBeds" defaultValue={filters.minBeds ?? ""} placeholder="Min bedrooms" inputMode="numeric" aria-label="Minimum bedrooms" />
        <button className="btn primary" type="submit">Search</button>
      </div>
    </form>
  );
  const hero = (
    <HomeHero photos={HERO}>
      {search}
      <nav className="hx-actions" aria-label="Other ways to search">
        <Link className="hx-action" href="/find"><span className="hx-action-ico">{Icon.sparkle()}</span><span><strong>Describe it</strong><small>Type what you want in a sentence</small></span></Link>
        <Link className="hx-action" href="/map"><span className="hx-action-ico">{Icon.map()}</span><span><strong>Street map</strong><small>See properties around you</small></span></Link>
        <Link className="hx-action" href="/flatmates"><span className="hx-action-ico">{Icon.people()}</span><span><strong>Find a flatmate</strong><small>Matched on how you live and your budget</small></span></Link>
      </nav>
    </HomeHero>
  );


  const [counts, cities, reviews, partners, companies, agents] = await Promise.all([
    siteCounts(), cityCounts(country), latestReviews(9), publicPartners(),
    directory({ kind: "companies" }).then((r) => r.rows.slice(0, 8)).catch(() => []),
    directory({ kind: "agents" }).then((r) => r.rows.slice(0, 8)).catch(() => []),
  ]);
  const trusts = new Map([...(await trustMany("COMPANY", companies.map((c) => c.targetId))), ...(await trustMany("AGENT", agents.map((a) => a.targetId)))]);
  const pros = [...companies, ...agents].sort((a, b) => (trusts.get(b.targetId)?.score ?? 0) - (trusts.get(a.targetId)?.score ?? 0)).slice(0, 10);
  const promoted = listings.filter((l) => l.promo);
  const featured = listings.filter((l) => !l.promo);
  const THEME: Record<string, string> = { RED: "t-red", GOLD: "t-gold", GREEN: "t-green", PURPLE: "t-purple", BLUE: "t-blue" };
  const countRows = [
    { n: counts.companies, label: "Registered companies" }, { n: counts.agents, label: "Listed agents" }, { n: counts.listings, label: "Properties listed" },
    { n: counts.completed, label: "Completed deals" }, { n: counts.cities, label: "Cities covered" },
  ];

  return (
    <div className="stack-lg">
      <ModeSwitch active="listings" />
      <div>
        {hero}
        {countRows.some((c) => c.n > 0) ? <section className="counts" aria-label={`${PLATFORM_NAME} in numbers`}>
          {countRows.map((c, i) => { if (c.n <= 0) return null; const I = COUNT_ICONS[i]; return <div key={c.label} className="count"><span className="count-ico">{I()}</span><CountUp value={c.n} /><span>{c.label}</span></div>; })}
        </section> : null}
      </div>

      {promoted.length ? (
        <section className="sec" aria-label="Offers">
          <SectionHead kicker="Hot offers" title="Promotions on now" text="Discounts set by the listing company, with the original price and the date the offer ends." />
          <Carousel label="Offers ending soon" few={promoted.length <= 3}>
            {[...promoted].sort((a, b) => a.promo!.endsOn.getTime() - b.promo!.endsOn.getTime()).map((l) => (
              <Link key={l.id} href={`/properties/${l.publicRef}`} className={`offer ${THEME[l.promo!.theme] ?? "t-red"}`}>
                <div className="offer-img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.coverPhotoId ? <img src={`/photos/${l.coverPhotoId}`} alt="" loading="lazy" decoding="async" /> : null}
                  <span className="burst" aria-hidden="true">{l.promo!.pct}%<small>OFF</small></span>
                </div>
                <div className="offer-body">
                  <span className="offer-tag">{l.promo!.campaignName}</span>
                  <strong>{l.title}</strong>
                  <span><s>{formatKobo(l.promo!.originalKobo)}</s> <b>{formatKobo(l.promo!.promoKobo)}</b></span>
                  <span className="small muted">{l.city}, {l.state} · ends {formatDate(l.promo!.endsOn)}</span>
                </div>
              </Link>
            ))}
          </Carousel>
        </section>
      ) : null}
      <SponsoredStrip items={sponsored} where="home" />


      {picked.length ? (
      <section className="sec" aria-labelledby="picks-h">
        <SectionHead kicker="For you" title="Picked for you" text="From the places, homes and agents you have been looking at. You can see or clear what shapes this in Your data and privacy." link={{ href: "/me/privacy#suggestions", label: "Why these?" }} />
        <Carousel label="Picked for you" few={picked.length <= 3}>
          {picked.map(({ l, why }) => (
            <div key={l.id} className="pick">
              <ListingCard l={l} />
              <p className="pick-why small">{why[0]}</p>
            </div>
          ))}
        </Carousel>
      </section>
      ) : null}

      {/* Each section shows only when it has something in it; an empty platform shows no empty boxes. */}
      {featured.length || promoted.length ? (
      <section className="sec">
        <SectionHead kicker="Featured" title="Featured properties" text="From registered companies, reviewed before publication." link={{ href: "/map", label: "See them on a map" }} />
        <Carousel label="Featured properties" few={(featured.length || promoted.length) <= 3}>
          {(featured.length ? featured : promoted).map((l) => <ListingCard key={l.id} l={l} />)}
        </Carousel>
      </section>
      ) : null}

      {cities.cities.length ? (
      <section className="sec">
        <SectionHead kicker="Locations" title={`Explore cities in ${countryName(cities.country)}`} text={cities.country !== country ? `No listings in ${countryName(country)} yet, so here is ${countryName(cities.country)}.` : "Where properties are listed right now."} />
        {(
          <div className="tiles">
            {cities.cities.map((c, i) => (
              <Link key={`${c.city}-${c.state}`} href={`/?city=${encodeURIComponent(c.city)}`} className="tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/stock/city-${(i % 6) + 1}.jpg`} alt="" loading="lazy" decoding="async" />
                <span className="tile-count">{c.count} {c.count === 1 ? "property" : "properties"}</span>
                <strong>{c.city}</strong><span>{c.state}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      ) : null}


      {pros.length ? (
      <section className="sec">
        <SectionHead kicker="Professionals" title="Companies and agents you can check" text="Trust levels come from identity and business checks done by people on our team." link={{ href: "/directory", label: "All companies and agents" }} />
        {(
          <Carousel label="Companies and agents" few={pros.length <= 3}>
            {pros.map((p) => (
              <Link key={`${p.kind}-${p.targetId}`} href={p.kind === "AGENT" ? `/agents/${p.targetId}` : `/companies/${p.targetId}`} className="pro">
                <div className="pro-top"><span className="avatar" aria-hidden="true">{initials(p.name)}</span><div><strong>{p.name}</strong><span className="small muted">{p.kind === "AGENT" ? `Agent${p.sub ? ` · ${p.sub}` : ""}` : p.sub}</span></div></div>
                {trusts.get(p.targetId) ? <TrustBadge t={trusts.get(p.targetId)!} /> : null}
                {p.blurb ? <span className="small muted">{p.blurb}</span> : null}
              </Link>
            ))}
          </Carousel>
        )}
      </section>
      ) : null}



      {reviews.length ? (
      <section className="sec">
        <SectionHead kicker="Reviews" title="What clients say" text="Every review is tied to a recorded inspection or deal, so only real clients can write one." link={{ href: "/reviews", label: "All reviews" }} />
        {(
          <Carousel label="Client reviews" few={reviews.length <= 3}>
            {reviews.map((r) => (
              <figure key={r.id} className="rv">
                <span className="rv-stars" role="img" aria-label={`${r.overall} out of 5`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= r.overall ? undefined : "off"} aria-hidden="true">★</span>)}</span>
                <blockquote style={{ margin: 0 }}><q>{r.body}</q></blockquote>
                <footer><span className="avatar" aria-hidden="true">{initials(r.reviewerName)}</span><figcaption><strong>{r.reviewerName}</strong><div className="small muted">About {r.about} · {formatDate(r.createdAt)}</div></figcaption></footer>
              </figure>
            ))}
          </Carousel>
        )}
      </section>
      ) : null}

      {partners.length ? (
      <section className="sec" aria-label="Partners">
        <SectionHead kicker="Partners" title="Working with" />
        {(
          <div className="partners">
            <div className="partners-row">
              {[0, 1].map((copy) => partners.map((p) => {
                const inner = <>{/* eslint-disable-next-line @next/next/no-img-element */}{p.logoMime ? <img src={`/partners/${p.id}/logo`} alt={copy ? "" : p.name} /> : null}<span>{p.name}</span></>;
                return p.url
                  ? <a key={`${copy}-${p.id}`} className="partner" href={p.url} rel="noopener sponsored" target="_blank" data-copy={copy ? "" : undefined} aria-hidden={copy ? true : undefined} tabIndex={copy ? -1 : undefined}>{inner}</a>
                  : <span key={`${copy}-${p.id}`} className="partner" data-copy={copy ? "" : undefined} aria-hidden={copy ? true : undefined}>{inner}</span>;
              }))}
            </div>
          </div>
        )}
      </section>
      ) : null}


      <section className="cta">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/cta.jpg" alt="" loading="lazy" decoding="async" />
        <p className="sec-kicker" style={{ color: "#FFD36B" }}>For companies and agents</p>
        <h2>List your properties where buyers can check you</h2>
        <p>Register your company, complete verification and publish listings with photos, offers and reels. Manage tenants, rent and deals in the same workspace.</p>
        <div className="row"><Link className="btn primary" href="/join?as=company">Register a company</Link><Link className="btn" href="/how-it-works">How it works</Link></div>
      </section>
    </div>
  );
}
