/** My search, as plain rules (no database), so the label and search parameters can be tested. */
export type SearchPrefView = { city: string; purpose: "" | "SALE" | "RENT"; maxNaira: number | null; minBeds: number | null };

/** The saved search as search-page address parameters (for "Use my search" and the reels filter). */
export function prefParams(p: SearchPrefView): Record<string, string> {
  return {
    ...(p.city ? { city: p.city } : {}), ...(p.purpose ? { purpose: p.purpose } : {}),
    ...(p.maxNaira !== null ? { maxPrice: String(Math.round(p.maxNaira)) } : {}), ...(p.minBeds !== null ? { minBeds: String(p.minBeds) } : {}),
  };
}

/** A short line describing it: "Lekki · Rent · up to ₦3m · 2+ bedrooms". */
export function prefLabel(p: SearchPrefView): string {
  const money = (n: number) => (n >= 1e9 ? `₦${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)}bn` : n >= 1e6 ? `₦${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}m` : `₦${Math.round(n).toLocaleString("en-NG")}`);
  return [p.city, p.purpose === "SALE" ? "Buy" : p.purpose === "RENT" ? "Rent" : "", p.maxNaira !== null ? `up to ${money(p.maxNaira)}` : "", p.minBeds ? `${p.minBeds}+ bedrooms` : ""].filter(Boolean).join(" · ");
}
