import { headers } from "next/headers";
import { StreetMap, type View } from "@/components/StreetMap";
import { countryName, countryView, visitorCountry } from "@/lib/countries";
import { PROPERTY_TYPES } from "@/lib/listing-rules";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "Find property on the map" };
export const dynamic = "force-dynamic";

function startView(s: SP | undefined, fallback: View): View {
  const lat = Number(sp(s, "lat")), lng = Number(sp(s, "lng")), z = Number(sp(s, "z"));
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && sp(s, "lat") && sp(s, "lng")
    ? { lat, lng, zoom: Number.isFinite(z) && z >= 2 && z <= 19 ? Math.round(z) : 12 } : fallback;
}

export default async function MapPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const country = visitorCountry(await headers());
  const start = startView(s, countryView(country));
  const filters: Record<string, string> = {};
  for (const k of ["purpose", "maxPrice", "minBeds", "type"]) { const v = sp(s, k); if (v) filters[k] = v.slice(0, 40); }
  const keep = { lat: sp(s, "lat") ?? "", lng: sp(s, "lng") ?? "", z: sp(s, "z") ?? "" };
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Find property on the map</h1>
        <p className="muted">Move and zoom the map: the properties in view load as you go. Pins show the area, about a kilometre wide, never the exact address. {sp(s, "lat") ? "" : `Opened on ${countryName(country)}, where you are browsing from.`}</p>
      </div>
      <form className="map-filters" aria-label="Filter the map">
        {keep.lat ? <><input type="hidden" name="lat" value={keep.lat} /><input type="hidden" name="lng" value={keep.lng} /><input type="hidden" name="z" value={keep.z} /></> : null}
        <label className="field">Looking to<select name="purpose" defaultValue={filters.purpose ?? ""}><option value="">Buy, rent or lease</option><option value="SALE">Buy</option><option value="RENT">Rent</option><option value="LEASE">Lease</option></select></label>
        <label className="field">Type<select name="type" defaultValue={filters.type ?? ""}><option value="">Any type</option>{Object.entries(PROPERTY_TYPES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <label className="field">Highest price (₦)<input name="maxPrice" inputMode="numeric" defaultValue={filters.maxPrice ?? ""} placeholder="No limit" /></label>
        <label className="field">Bedrooms<select name="minBeds" defaultValue={filters.minBeds ?? ""}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
        <button className="btn primary" type="submit">Apply</button>
      </form>
      <StreetMap mode="listings" start={start} filters={filters} label="Map of properties for sale and to rent" />
    </div>
  );
}
