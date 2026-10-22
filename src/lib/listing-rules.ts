/**
 * Listing details (master prompt §7), marketplace categories (§5) and search filters (§6).
 * Reference values are plain codes with labels here, so they can later move to platform-managed reference data.
 * Pure functions, tested on their own.
 */

export const PROPERTY_TYPES = {
  HOUSE: "Detached house", DUPLEX: "Duplex", SEMI_DETACHED: "Semi-detached house", TERRACE: "Terrace house", BUNGALOW: "Bungalow",
  FLAT: "Flat or apartment", PENTHOUSE: "Penthouse", MAISONETTE: "Maisonette", SELF_CONTAINED: "Self-contained (studio)",
  ROOM: "Room in a shared home", SHARED_ROOM: "Shared room (bed space)",
  LAND: "Land", OFFICE: "Office space", SHOP: "Shop or retail space", PLAZA: "Plaza or mall unit", HOTEL: "Hotel or guest house",
  EVENT_CENTRE: "Event centre or hall", WAREHOUSE: "Warehouse", INDUSTRIAL: "Factory or industrial", FILLING_STATION: "Filling station",
  FARM: "Farm or agricultural land", PLANT_MACHINERY: "Plant and machinery", OTHER: "Other",
} as const;
export type PropertyType = keyof typeof PROPERTY_TYPES;
export const RESIDENTIAL_TYPES: PropertyType[] = ["HOUSE", "DUPLEX", "SEMI_DETACHED", "TERRACE", "BUNGALOW", "FLAT", "PENTHOUSE", "MAISONETTE", "SELF_CONTAINED", "ROOM", "SHARED_ROOM"];
export const COMMERCIAL_TYPES: PropertyType[] = ["OFFICE", "SHOP", "PLAZA", "HOTEL", "EVENT_CENTRE", "FILLING_STATION"];
export const INDUSTRIAL_TYPES: PropertyType[] = ["WAREHOUSE", "INDUSTRIAL"];

export const PRICE_PERIODS = { TOTAL: "Total price", YEAR: "Per year", MONTH: "Per month", NIGHT: "Per night" } as const;
export type PricePeriod = keyof typeof PRICE_PERIODS;
export const priceSuffix = (p: string) => (p === "YEAR" ? " / year" : p === "MONTH" ? " / month" : p === "NIGHT" ? " / night" : "");
/** The period a price is for when none is given: a sale is a total, anything else a year. */
export const defaultPeriod = (purpose: string): PricePeriod => (purpose === "SALE" ? "TOTAL" : "YEAR");

export const FURNISHING = { UNSPECIFIED: "Not stated", FURNISHED: "Furnished", SEMI_FURNISHED: "Semi-furnished", UNFURNISHED: "Unfurnished" } as const;
export const CONDITIONS = { UNSPECIFIED: "Not stated", NEW: "Newly built", RENOVATED: "Recently renovated", GOOD: "Good", FAIR: "Fair", NEEDS_WORK: "Needs renovation" } as const;
export const CONSTRUCTION = { COMPLETED: "Completed", UNDER_CONSTRUCTION: "Under construction", OFF_PLAN: "Off-plan" } as const;
/** Documents the listing company says the property has. Recorded as stated, never as verified (master prompt §8). */
export const TITLE_DOCUMENTS = {
  UNSPECIFIED: "Not stated", C_OF_O: "Certificate of Occupancy (C of O)", R_OF_O: "Right of Occupancy", GOVERNORS_CONSENT: "Governor's Consent",
  DEED_OF_ASSIGNMENT: "Deed of Assignment", REGISTERED_SURVEY: "Registered survey plan", GAZETTE: "Gazette", EXCISION: "Excision",
  LETTER_OF_ALLOCATION: "Letter of allocation", CONTRACT_OF_SALE: "Contract of sale", LEASE_AGREEMENT: "Lease agreement", OTHER: "Other document",
} as const;

export const AMENITIES = {
  SECURITY: "Security guard", GATED: "Gated estate or compound", CCTV: "CCTV", FENCED: "Fenced", PARKING: "Parking",
  POWER_PUBLIC: "Grid power", PREPAID_METER: "Prepaid meter", GENERATOR: "Generator", SOLAR: "Solar or inverter",
  WATER: "Running water", BOREHOLE: "Borehole", INTERNET: "Internet ready", AIR_CON: "Air conditioning",
  FITTED_KITCHEN: "Fitted kitchen", WARDROBES: "Built-in wardrobes", BOYS_QUARTERS: "Boys' quarters", BALCONY: "Balcony",
  GARDEN: "Garden or yard", POOL: "Swimming pool", GYM: "Gym", ELEVATOR: "Lift", TARRED_ROAD: "Tarred road", DRAINAGE: "Good drainage",
  LOADING_BAY: "Loading bay", PET_FRIENDLY: "Pets allowed", ACCESSIBLE: "Step-free or wheelchair access",
} as const;
export type Amenity = keyof typeof AMENITIES;

export const isCode = <T extends Record<string, string>>(table: T, v: unknown): v is keyof T => typeof v === "string" && Object.prototype.hasOwnProperty.call(table, v);

/** Amenity codes from a stored list. With `allowed`, codes the administrators added are kept too. */
export function parseAmenities(stored: string, allowed?: Iterable<string>): Amenity[] {
  const ok = allowed ? new Set(allowed) : null;
  return stored.split(",").map((s) => s.trim()).filter((s): s is Amenity => (ok ? ok.has(s) : isCode(AMENITIES, s)));
}
export function joinAmenities(list: string[], allowed?: Iterable<string>): string {
  const ok = allowed ? new Set(allowed) : null;
  return [...new Set(list.filter((s) => (ok ? ok.has(s) : isCode(AMENITIES, s))))].sort().join(",");
}

// ---------- Categories (the browse pages) ----------
export type CategoryRule = { purpose?: ("SALE" | "RENT" | "LEASE")[]; types?: PropertyType[]; period?: PricePeriod[]; notPeriod?: PricePeriod[]; construction?: string[] };
export type Category = { slug: string; title: string; intro: string; img: string; rule: CategoryRule };

export const CATEGORIES: Category[] = [
  { slug: "buy", title: "Property for sale", intro: "Houses, flats and duplexes to buy.", img: "/stock/buy.jpg", rule: { purpose: ["SALE"], types: RESIDENTIAL_TYPES } },
  { slug: "rent", title: "Property to rent", intro: "Homes to rent by the year or month.", img: "/stock/rent.jpg", rule: { purpose: ["RENT"], types: RESIDENTIAL_TYPES, notPeriod: ["NIGHT"] } },
  { slug: "short-let", title: "Short lets", intro: "Furnished homes priced by the night.", img: "/stock/shortlet.jpg", rule: { period: ["NIGHT"] } },
  { slug: "land", title: "Land for sale", intro: "Plots, acreage and farmland.", img: "/stock/land.jpg", rule: { types: ["LAND", "FARM"] } },
  { slug: "commercial", title: "Commercial property", intro: "Offices, shops, hotels, event centres and more, to buy, rent or lease.", img: "/stock/commercial.jpg", rule: { types: COMMERCIAL_TYPES } },
  { slug: "shops", title: "Shops and retail spaces", intro: "Shops, plaza and mall units.", img: "/stock/shops.jpg", rule: { types: ["SHOP", "PLAZA"] } },
  { slug: "warehouses", title: "Warehouses and industrial", intro: "Warehouses, factories and logistics space.", img: "/stock/warehouse.jpg", rule: { types: INDUSTRIAL_TYPES } },
  { slug: "plant-and-machinery", title: "Plant and machinery", intro: "Equipment and machinery offered by registered companies.", img: "/stock/developments.jpg", rule: { types: ["PLANT_MACHINERY"] } },
  { slug: "new-developments", title: "New developments", intro: "Off-plan and under-construction homes and estates.", img: "/stock/developments.jpg", rule: { construction: ["OFF_PLAN", "UNDER_CONSTRUCTION"] } },
  { slug: "rooms", title: "Rooms and shared accommodation", intro: "Rooms, bed spaces and self-contained studios.", img: "/stock/rent.jpg", rule: { types: ["ROOM", "SHARED_ROOM", "SELF_CONTAINED"] } },
];
export const categoryBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug) ?? null;

// ---------- Search filters ----------
export const SORTS = { newest: "Newest first", price_asc: "Lowest price", price_desc: "Highest price", size_desc: "Largest first" } as const;
export type Sort = keyof typeof SORTS;
export const SEARCH_PAGE = 24;

export type Filters = {
  q?: string; city?: string; purpose?: "SALE" | "RENT" | "LEASE"; types: PropertyType[]; minPrice?: string; maxPrice?: string;
  minBeds?: number; minBaths?: number; furnishing?: keyof typeof FURNISHING; serviced?: boolean; amenities: Amenity[];
  minSize?: number; construction?: keyof typeof CONSTRUCTION; titleDoc?: keyof typeof TITLE_DOCUMENTS; estate?: string;
  availableBy?: string; verifiedOnly?: boolean; negotiable?: boolean; period?: PricePeriod; sort: Sort; page: number;
};

type Get = (k: string) => string | undefined;
const int = (v: string | undefined, max: number) => { const n = Number.parseInt(v ?? "", 10); return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined; };
const text = (v: string | undefined, max: number) => { const t = (v ?? "").trim().slice(0, max); return t || undefined; };

/** Read filters from a query string. Anything unknown or malformed is ignored rather than failing. */
export function parseFilters(get: Get, getAll: (k: string) => string[] = (k) => (get(k) ? [get(k)!] : []), allowed?: { amenities?: string[]; titleDocs?: string[] }): Filters {
  const amenOk = allowed?.amenities ? new Set(allowed.amenities) : null;
  const titleOk = allowed?.titleDocs ? new Set(allowed.titleDocs) : null;
  const purpose = get("purpose");
  const types = getAll("type").flatMap((t) => t.split(",")).filter((t): t is PropertyType => isCode(PROPERTY_TYPES, t));
  const amenities = getAll("amenity").flatMap((t) => t.split(",")).filter((t): t is Amenity => (amenOk ? amenOk.has(t) : isCode(AMENITIES, t)));
  const sort = get("sort");
  const date = get("availableBy");
  return {
    q: text(get("q"), 80), city: text(get("city"), 80),
    purpose: purpose === "SALE" || purpose === "RENT" || purpose === "LEASE" ? purpose : undefined,
    types: [...new Set(types)], minPrice: text(get("minPrice"), 20), maxPrice: text(get("maxPrice"), 20),
    minBeds: int(get("minBeds"), 50), minBaths: int(get("minBaths"), 50),
    furnishing: isCode(FURNISHING, get("furnishing")) && get("furnishing") !== "UNSPECIFIED" ? (get("furnishing") as keyof typeof FURNISHING) : undefined,
    serviced: get("serviced") === "1" ? true : undefined, amenities: [...new Set(amenities)], minSize: int(get("minSize"), 10_000_000),
    construction: isCode(CONSTRUCTION, get("construction")) ? (get("construction") as keyof typeof CONSTRUCTION) : undefined,
    titleDoc: (titleOk ? titleOk.has(get("titleDoc") ?? "") : isCode(TITLE_DOCUMENTS, get("titleDoc"))) && get("titleDoc") !== "UNSPECIFIED" ? (get("titleDoc") as keyof typeof TITLE_DOCUMENTS) : undefined,
    estate: text(get("estate"), 80), availableBy: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    verifiedOnly: get("verified") === "1" ? true : undefined, negotiable: get("negotiable") === "1" ? true : undefined,
    period: isCode(PRICE_PERIODS, get("period")) ? (get("period") as PricePeriod) : undefined,
    sort: isCode(SORTS, sort) ? (sort as Sort) : "newest", page: Math.max(1, Math.min(int(get("page"), 1000) ?? 1, 1000)),
  };
}

/** How many filters beyond the basics are switched on (shown on the "More filters" button). */
export function extraFilterCount(f: Filters) {
  return [f.types.length > 0, f.minBaths !== undefined, !!f.furnishing, !!f.serviced, f.amenities.length > 0, f.minSize !== undefined, !!f.construction, !!f.titleDoc, !!f.estate, !!f.availableBy, !!f.verifiedOnly, !!f.negotiable, !!f.minPrice, !!f.period].filter(Boolean).length;
}

/** The query string for a set of filters, with one value changed (for paging, sorting and removing a filter). */
export function filtersToQuery(f: Partial<Filters>, change: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && v.length === 0)) q.set(k, Array.isArray(v) ? v.join(",") : v === true ? "1" : String(v)); };
  put("q", f.q); put("city", f.city); put("purpose", f.purpose); put("type", f.types); put("minPrice", f.minPrice); put("maxPrice", f.maxPrice);
  put("minBeds", f.minBeds); put("minBaths", f.minBaths); put("furnishing", f.furnishing); put("serviced", f.serviced); put("amenity", f.amenities);
  put("minSize", f.minSize); put("construction", f.construction); put("titleDoc", f.titleDoc); put("estate", f.estate); put("availableBy", f.availableBy);
  put("verified", f.verifiedOnly); put("negotiable", f.negotiable); put("period", f.period);
  if (f.sort && f.sort !== "newest") q.set("sort", f.sort);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  for (const [k, v] of Object.entries(change)) { if (v === undefined || v === "") q.delete(k); else q.set(k, String(v)); }
  return q.toString();
}

/** Key facts for a listing card or page, in the order people look for them. */
export function keyFacts(l: { propertyType: string; bedrooms: number | null; bathrooms: number | null; toilets: number | null; buildingSqm: number | null; landSqm: number | null; furnishing: string }, typeLabels?: Record<string, string>) {
  const out: string[] = [];
  if (l.propertyType !== "OTHER" && isCode(PROPERTY_TYPES, l.propertyType)) out.push(typeLabels?.[l.propertyType] ?? PROPERTY_TYPES[l.propertyType]);
  if (l.bedrooms != null) out.push(`${l.bedrooms} bed`);
  if (l.bathrooms != null) out.push(`${l.bathrooms} bath`);
  if (l.toilets != null) out.push(`${l.toilets} toilet${l.toilets === 1 ? "" : "s"}`);
  if (l.buildingSqm != null) out.push(`${l.buildingSqm.toLocaleString("en-NG")} m²`);
  else if (l.landSqm != null) out.push(`${l.landSqm.toLocaleString("en-NG")} m² land`);
  if (l.furnishing !== "UNSPECIFIED" && isCode(FURNISHING, l.furnishing)) out.push(FURNISHING[l.furnishing]);
  return out;
}
