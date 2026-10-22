import Link from "next/link";
import { getSession } from "@/lib/auth";
import { AMENITIES, CONSTRUCTION, FURNISHING, PRICE_PERIODS, PROPERTY_TYPES, SEARCH_PAGE, SORTS, TITLE_DOCUMENTS, extraFilterCount, filtersToQuery, parseFilters, type Category } from "@/lib/listing-rules";
import { searchListingsPage } from "@/lib/services/listings";
import { decorateListings } from "@/lib/services/promotions";
import { verifiedCompanyIds } from "@/lib/services/kyc";
import { saveSearchAction } from "@/app/me/saved/actions";
import { ListingCard } from "./ListingCard";
import { CompareToggle } from "./Compare";
import { SponsoredStrip } from "./Sponsored";
import { sponsoredFor } from "@/lib/services/ads";
import { isBot } from "@/lib/ad-rules";
import { headers } from "next/headers";
import { Pager, type SP } from "./ui";

const opts = (t: Record<string, string>, skip?: string) => Object.entries(t).filter(([k]) => k !== skip).map(([k, v]) => <option key={k} value={k}>{v}</option>);

/** The search results page: a short filter bar, the rest folded under "More filters", sorting and pages. Used by /browse and every category page. */
export async function Browse({ searchParams, category, basePath }: { searchParams?: SP; category: Category | null; basePath: string }) {
  const get = (k: string) => { const v = searchParams?.[k]; return Array.isArray(v) ? v[0] : v; };
  const getAll = (k: string) => { const v = searchParams?.[k]; return Array.isArray(v) ? v : v ? [v] : []; };
  const f = parseFilters(get, getAll);
  const companyIds = f.verifiedOnly ? await verifiedCompanyIds() : undefined;
  const page = await searchListingsPage(f, category?.rule ?? {}, companyIds);
  const rows = await decorateListings(page.rows, f.sort === "newest");
  const session = await getSession();
  const bot = isBot((await headers()).get("user-agent"));
  const sponsored = await sponsoredFor("SEARCH_TOP", { filters: { q: f.q, purpose: f.purpose, city: f.city, maxPrice: f.maxPrice, minBeds: f.minBeds?.toString() }, bot }).catch(() => []);
  const extra = extraFilterCount(f);
  const href = (change: Record<string, string | number | undefined>) => { const q = filtersToQuery(f, change); return q ? `${basePath}?${q}` : basePath; };
  const typeChoices = category?.rule.types ?? (Object.keys(PROPERTY_TYPES) as (keyof typeof PROPERTY_TYPES)[]);

  return (
    <div className="stack-lg">
      <section className="page-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={category?.img ?? "/stock/hero-1.jpg"} alt="" />
        <p className="eyebrow">{category ? "Browse" : "Search"}</p>
        <h1>{category?.title ?? "Search properties"}</h1>
        <p>{category?.intro ?? "Every published property from registered companies. Narrow it down with the filters."}</p>
      </section>

      <form className="filters card" action={basePath} role="search" aria-label="Filter properties">
        <div className="filter-row">
          <label className="field">Location<input name="city" defaultValue={f.city ?? ""} placeholder="City, area or state" /></label>
          {category?.rule.purpose ? null : (
            <label className="field">Purpose<select name="purpose" defaultValue={f.purpose ?? ""}><option value="">Buy, rent or lease</option><option value="SALE">Buy</option><option value="RENT">Rent</option><option value="LEASE">Lease</option></select></label>
          )}
          <label className="field">Type<select name="type" defaultValue={f.types[0] ?? ""}><option value="">Any type</option>{typeChoices.map((t) => <option key={t} value={t}>{PROPERTY_TYPES[t]}</option>)}</select></label>
          <label className="field">Max price (₦)<input name="maxPrice" inputMode="decimal" defaultValue={f.maxPrice ?? ""} /></label>
          <label className="field">Bedrooms<select name="minBeds" defaultValue={f.minBeds?.toString() ?? ""}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
          <button className="btn primary" type="submit">Search</button>
        </div>
        <details className="inline more-filters" open={extra > 0 ? true : undefined}>
          <summary>More filters{extra ? ` (${extra} on)` : ""}</summary>
          <div className="stack">
            <div className="fields">
              <label className="field">Keywords<input name="q" maxLength={80} defaultValue={f.q ?? ""} placeholder="For example: pool, Lekki Phase 1" /></label>
              <label className="field">Min price (₦)<input name="minPrice" inputMode="decimal" defaultValue={f.minPrice ?? ""} /></label>
              <label className="field">Price is<select name="period" defaultValue={f.period ?? ""}><option value="">Any</option>{opts(PRICE_PERIODS)}</select></label>
              <label className="field">Bathrooms<select name="minBaths" defaultValue={f.minBaths?.toString() ?? ""}><option value="">Any</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
            </div>
            <div className="fields">
              <label className="field">Furnishing<select name="furnishing" defaultValue={f.furnishing ?? ""}><option value="">Any</option>{opts(FURNISHING, "UNSPECIFIED")}</select></label>
              <label className="field">Construction<select name="construction" defaultValue={f.construction ?? ""}><option value="">Any</option>{opts(CONSTRUCTION)}</select></label>
              <label className="field">Minimum size (m²)<input name="minSize" inputMode="numeric" defaultValue={f.minSize?.toString() ?? ""} /></label>
              <label className="field">Available by<input name="availableBy" type="date" defaultValue={f.availableBy ?? ""} /></label>
            </div>
            <div className="fields">
              <label className="field">Title document (as stated)<select name="titleDoc" defaultValue={f.titleDoc ?? ""}><option value="">Any</option>{opts(TITLE_DOCUMENTS, "UNSPECIFIED")}</select></label>
              <label className="field">Estate or development<input name="estate" maxLength={80} defaultValue={f.estate ?? ""} /></label>
            </div>
            <div className="fields">
              <label className="check"><input type="checkbox" name="verified" value="1" defaultChecked={!!f.verifiedOnly} /> Verified companies only</label>
              <label className="check"><input type="checkbox" name="serviced" value="1" defaultChecked={!!f.serviced} /> Serviced</label>
              <label className="check"><input type="checkbox" name="negotiable" value="1" defaultChecked={!!f.negotiable} /> Price negotiable</label>
            </div>
            <fieldset className="field"><legend>Must have</legend>
              <div className="amenity-grid">{Object.entries(AMENITIES).map(([k, v]) => <label key={k} className="check"><input type="checkbox" name="amenity" value={k} defaultChecked={f.amenities.includes(k as never)} /> {v}</label>)}</div>
            </fieldset>
            <div className="row"><button className="btn primary" type="submit">Apply filters</button><Link className="btn" href={basePath}>Clear all</Link></div>
          </div>
        </details>
      </form>

      <SponsoredStrip items={sponsored} where="search" />
      <section className="sec" aria-label="Results">
        <div className="sec-head">
          <div><h2>{page.total} {page.total === 1 ? "property" : "properties"}</h2><p className="small muted">Title documents are listed as the company states them; the platform has not verified title.</p></div>
          <nav className="sort-links" aria-label="Sort">{Object.entries(SORTS).map(([k, v]) => <Link key={k} href={href({ sort: k === "newest" ? undefined : k, page: undefined })} aria-current={f.sort === k ? "page" : undefined}>{v}</Link>)}</nav>
        </div>
        {session ? (
          <details className="inline"><summary>Save this search and get alerts</summary>
            <form action={saveSearchAction} className="stack">
              <input type="hidden" name="back" value={href({})} />
              {f.city ? <input type="hidden" name="city" value={f.city} /> : null}
              {f.purpose ? <input type="hidden" name="purpose" value={f.purpose} /> : null}
              {f.q ? <input type="hidden" name="q" value={f.q} /> : null}
              {f.maxPrice ? <input type="hidden" name="maxPrice" value={f.maxPrice} /> : null}
              {f.minBeds !== undefined ? <input type="hidden" name="minBeds" value={String(f.minBeds)} /> : null}
              <label className="field">Name this search<input name="name" required maxLength={80} defaultValue={[category?.title, f.city].filter(Boolean).join(" in ") || "My search"} /></label>
              <p className="small muted">Alerts use the location, purpose, keywords, maximum price and bedrooms.</p>
              <button className="btn" type="submit">Save search</button>
            </form>
          </details>
        ) : <p className="small muted"><Link href="/login">Sign in</Link> to save this search and be told about new matches.</p>}
        {rows.length === 0 ? (
          <div className="card stack"><p className="muted">No published properties match these filters yet.</p><p><Link href={basePath}>Clear the filters</Link> or <Link href="/browse">search everything</Link>.</p></div>
        ) : <div className="grid">{rows.map((l) => <div key={l.id} className="card-wrap"><ListingCard l={l} /><CompareToggle refId={l.publicRef} compact /></div>)}</div>}
        <Pager page={f.page - 1} total={page.total} pageSize={SEARCH_PAGE} noun="properties" href={(p) => href({ page: p > 0 ? p + 1 : undefined })} />
      </section>
    </div>
  );
}
