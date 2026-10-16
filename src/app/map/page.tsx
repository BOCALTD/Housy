import Link from "next/link";
import { publicMapPoints } from "@/lib/services/maps";
import { PURPOSES } from "@/lib/services/listings";
import { humanize } from "@/lib/labels";
import GeoMap from "@/components/GeoMap";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Properties on the map" };
export const dynamic = "force-dynamic";

export default async function PublicMapPage({ searchParams }: { searchParams?: SP }) {
  const f = { purpose: sp(searchParams, "purpose"), city: sp(searchParams, "city"), maxPrice: sp(searchParams, "maxPrice"), minBeds: sp(searchParams, "minBeds") };
  const r = await publicMapPoints(f);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Properties on the map</h1><p className="muted">Each circle is an area, not an address: exact locations are never published. <Link href="/">Back to search</Link></p></div>
      <form className="search" role="search" aria-label="Filter the map">
        <input name="city" defaultValue={f.city ?? ""} placeholder="City, area or state" aria-label="Location" />
        <select name="purpose" defaultValue={f.purpose ?? ""} aria-label="Purpose"><option value="">Buy, rent or lease</option>{PURPOSES.map((p) => <option key={p} value={p}>{p === "SALE" ? "Buy" : humanize(p)}</option>)}</select>
        <input name="maxPrice" defaultValue={f.maxPrice ?? ""} placeholder="Max price (₦)" inputMode="decimal" aria-label="Maximum price" />
        <input name="minBeds" defaultValue={f.minBeds ?? ""} placeholder="Min bedrooms" inputMode="numeric" aria-label="Minimum bedrooms" />
        <button className="btn primary" type="submit">Filter</button>
      </form>
      {r.points.length === 0 ? <div className="card"><p className="muted">No published property with a known area matches that.</p></div> : <GeoMap points={r.points} caption="Map of published properties in Nigeria, grouped by area" />}
      {r.unplaced > 0 ? <p className="small muted">{r.unplaced} matching properties have no area the map knows, so they are not drawn. <Link href={`/?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString()}`}>See them in the list</Link>.</p> : null}
    </div>
  );
}
