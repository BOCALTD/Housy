import Link from "next/link";
import { marketOverview } from "@/lib/services/market";
import { MIN_COMPANIES, MIN_LISTINGS, compactNaira } from "@/lib/market-rules";
import { RangeLine, TrendBars } from "@/components/MarketCharts";
import { formatDateTime } from "@/lib/dates";
import { PLATFORM_NAME } from "@/lib/labels";

export const metadata = { title: "Property market insights", description: `Asking prices, rents, price per square metre, yields and time on the market by city, from listings on ${PLATFORM_NAME}.` };
export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const o = await marketOverview();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6, maxWidth: 820 }}>
        <p className="eyebrow">Market insights</p>
        <h1>What property costs, city by city</h1>
        <p className="muted">Asking prices and yearly rents for homes, price per square metre, yields and how long homes stay on the market, worked out from {o.listings.toLocaleString("en-GB")} listings on {PLATFORM_NAME}. These are asking figures, not agreed prices. A figure appears only when at least {MIN_LISTINGS} listings from at least {MIN_COMPANIES} companies sit behind it. Updated {formatDateTime(o.generatedAt)}.</p>
      </div>
      {o.cities.length === 0 ? <div className="card"><p className="muted">There are not enough listings yet to show market figures. They appear as companies publish more properties.</p></div> : (
        <>
          <div className="two">
            <section className="card stack"><h2>Homes for sale</h2><TrendBars points={o.trendSale} label="Median asking price, last 12 months" /></section>
            <section className="card stack"><h2>Homes to rent</h2><TrendBars points={o.trendRent} label="Median yearly rent, last 12 months" /></section>
          </div>
          <section className="stack">
            <h2>By city</h2>
            <ul className="market-cities">
              {o.cities.slice(0, 12).map((c) => (
                <li key={c.slug}>
                  <Link className="market-city" href={`/market/${c.slug}`}>
                    <span className="market-city-head"><strong>{c.city}</strong><span className="small muted">{c.state}</span></span>
                    <span className="small">For sale: <RangeLine s={c.sale} /></span>
                    <span className="small">To rent (yearly): <RangeLine s={c.rent} /></span>
                    {c.salePerSqm ? <span className="small muted">{compactNaira(c.salePerSqm.median)} per m² to buy</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
            {o.cities.length > 12 ? (
              <details className="inline"><summary>Show {o.cities.length - 12} more cities</summary>
                <ul className="market-cities">{o.cities.slice(12).map((c) => <li key={c.slug}><Link className="market-city" href={`/market/${c.slug}`}><span className="market-city-head"><strong>{c.city}</strong><span className="small muted">{c.state}</span></span></Link></li>)}</ul>
              </details>
            ) : null}
          </section>
        </>
      )}
      <p className="small muted">Asking prices often differ from final prices. Use these figures as a guide, and ask a valuer for the value of a particular property.</p>
    </div>
  );
}
