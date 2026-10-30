import Link from "next/link";
import { notFound } from "next/navigation";
import { marketCity } from "@/lib/services/market";
import { compactNaira } from "@/lib/market-rules";
import { RangeLine, TrendBars } from "@/components/MarketCharts";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const c = await marketCity((await params).city);
  return c ? { title: `Property prices in ${c.city}`, description: `Asking prices, rents, yields and time on the market in ${c.city}, ${c.state}.` } : { title: "Market insights" };
}

export default async function CityMarketPage({ params }: { params: Promise<{ city: string }> }) {
  const c = await marketCity((await params).city);
  if (!c) notFound();
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p><Link className="btn small" href="/market">All cities</Link></p>
        <h1>Property prices in {c.city}</h1>
        <p className="muted">{c.state} · from {c.listings} listings, asking figures only.</p>
      </div>
      <section className="stats" aria-label={`${c.city} in figures`}>
        <div className="stat"><b>{c.sale ? compactNaira(c.sale.median) : "—"}</b><span>Median asking price, homes</span></div>
        <div className="stat"><b>{c.rent ? compactNaira(c.rent.median) : "—"}</b><span>Median yearly rent, homes</span></div>
        <div className="stat"><b>{c.salePerSqm ? compactNaira(c.salePerSqm.median) : "—"}</b><span>Per m² to buy</span></div>
        <div className="stat"><b>{c.daysOnMarket ? `${Math.round(c.daysOnMarket.median)} days` : "—"}</b><span>Typical time on the market</span></div>
      </section>
      <section className="card stack" aria-labelledby="beds-h">
        <h2 id="beds-h">By number of bedrooms</h2>
        <div className="table-wrap">
          <table className="stack-table">
            <thead><tr><th>Bedrooms</th><th>To buy</th><th>To rent (a year)</th><th>Gross yield</th></tr></thead>
            <tbody>
              {c.byBedrooms.map((b) => (
                <tr key={b.band}>
                  <td data-label="Bedrooms">{b.band}</td>
                  <td data-label="To buy"><RangeLine s={b.sale} /></td>
                  <td data-label="To rent"><RangeLine s={b.rent} /></td>
                  <td data-label="Gross yield">{b.yieldPct !== null ? `${b.yieldPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Gross yield is a year&apos;s median rent as a share of the median asking price, before costs, voids and fees. An estimate.</p>
      </section>
      <div className="two">
        <section className="card stack"><h2>For sale</h2><TrendBars points={c.trendSale} label={`Median asking price in ${c.city}`} /></section>
        <section className="card stack"><h2>To rent</h2><TrendBars points={c.trendRent} label={`Median yearly rent in ${c.city}`} /></section>
      </div>
      <p className="row"><Link className="btn primary" href={`/browse?city=${encodeURIComponent(c.city)}`}>See properties in {c.city}</Link><Link className="btn" href="/map">Search on the map</Link></p>
    </div>
  );
}
