/**
 * "What's different" on the compare page (master prompt §37: explain differences between shortlisted properties). Plain
 * sentences worked out from what each listing states and from market figures for similar homes; no opinion on which to choose.
 * Pure, tested on its own.
 */
import { bedroomBand, compactNaira, position, segmentOf, yearlyKobo, type CityInsight } from "./market-rules";

export type CompareRow = {
  ref: string; name: string; purpose: string; pricePeriod: string; priceKobo: bigint; serviceChargeKobo: bigint | null;
  bedrooms: number | null; buildingSqm: number | null; landSqm: number | null; city: string; propertyType: string;
  titleDocument: string; furnishing: string; serviced: boolean; amenities: string[]; verifiedCompany: boolean;
};

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const naira = (k: bigint) => compactNaira(Number(k) / 100);

export function compareNotes(rows: CompareRow[], cities: CityInsight[] = [], amenityLabel: (code: string) => string = (c) => c): string[] {
  if (rows.length < 2) return [];
  const notes: string[] = [];
  const purposes = new Set(rows.map((r) => r.purpose));

  if (purposes.size > 1) notes.push("These are not all for the same purpose (sale, rent or lease), so their prices are not compared here.");
  else {
    const cost = rows.map((r) => {
      const y = yearlyKobo(r);
      return { r, v: y === null ? null : r.purpose === "SALE" ? y : y + (r.serviceChargeKobo ?? 0n) };
    }).filter((x): x is { r: CompareRow; v: bigint } => x.v !== null).sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
    if (cost.length >= 2) {
      const lo = cost[0], hi = cost.at(-1)!;
      if (hi.v > lo.v) {
        const pct = Math.round((Number(hi.v - lo.v) / Number(lo.v)) * 100);
        const what = lo.r.purpose === "SALE" ? "asking price" : "yearly cost (rent plus service charge)";
        notes.push(`${lo.r.name} has the lowest ${what} at ${naira(lo.v)}; ${hi.r.name} is ${pct}% more at ${naira(hi.v)}.`);
      }
    }
    const sqm = rows.map((r) => { const a = r.buildingSqm ?? r.landSqm; const y = yearlyKobo(r); return a && y !== null ? { r, v: Number(y) / 100 / a } : null; })
      .filter((x): x is { r: CompareRow; v: number } => !!x).sort((a, b) => a.v - b.v);
    if (sqm.length >= 2 && sqm[0].r !== cost[0]?.r) notes.push(`For the space you get, ${sqm[0].r.name} is the best value at ${compactNaira(sqm[0].v)} per m².`);
  }

  // Against similar homes in the same city.
  for (const r of rows) {
    if (segmentOf(r.propertyType) !== "HOME") continue;
    const c = cities.find((x) => x.city.toLowerCase() === r.city.trim().toLowerCase());
    const band = c?.byBedrooms.find((b) => b.band === bedroomBand(r.bedrooms));
    const s = r.purpose === "SALE" ? band?.sale : r.purpose === "RENT" ? band?.rent : null;
    const y = yearlyKobo(r);
    if (!s || y === null) continue;
    const p = position(Number(y) / 100, s);
    if (p.where !== "within") notes.push(`${r.name} is ${Math.abs(p.vsMedianPct)}% ${p.vsMedianPct > 0 ? "above" : "below"} the typical asking ${r.purpose === "SALE" ? "price" : "rent"} for ${band!.band}-bedroom homes in ${c!.city}.`);
  }

  const beds = rows.filter((r) => r.bedrooms !== null);
  if (beds.length >= 2 && new Set(beds.map((r) => r.bedrooms)).size > 1) {
    const most = Math.max(...beds.map((r) => r.bedrooms!));
    notes.push(`${list(beds.filter((r) => r.bedrooms === most).map((r) => r.name))} ${beds.filter((r) => r.bedrooms === most).length > 1 ? "have" : "has"} the most bedrooms (${most}).`);
  }

  const titled = rows.filter((r) => r.titleDocument && r.titleDocument !== "UNSPECIFIED");
  if (purposes.has("SALE") && titled.length < rows.length) {
    const none = rows.filter((r) => !titled.includes(r)).map((r) => r.name);
    notes.push(`${list(none)} ${none.length > 1 ? "do" : "does"} not state a title document. Ask for it, and have a lawyer check it, before paying anything.`);
  }

  const verified = rows.filter((r) => r.verifiedCompany).map((r) => r.name);
  if (verified.length && verified.length < rows.length) notes.push(`${list(verified)} ${verified.length > 1 ? "are" : "is"} listed by a company whose business checks the platform has verified.`);

  const furnished = rows.filter((r) => r.furnishing === "FURNISHED").map((r) => r.name);
  if (furnished.length && furnished.length < rows.length) notes.push(`Only ${list(furnished)} ${furnished.length > 1 ? "are" : "is"} furnished.`);
  const serviced = rows.filter((r) => r.serviced).map((r) => r.name);
  if (serviced.length && serviced.length < rows.length) notes.push(`Only ${list(serviced)} ${serviced.length > 1 ? "are" : "is"} serviced.`);

  for (const r of rows) {
    const only = r.amenities.filter((a) => rows.every((o) => o === r || !o.amenities.includes(a)));
    if (only.length) notes.push(`Only ${r.name} lists ${list(only.slice(0, 4).map((a) => amenityLabel(a).toLowerCase()))}.`);
  }
  return notes.slice(0, 8);
}
