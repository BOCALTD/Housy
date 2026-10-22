/** Countries the marketplace can show, and how to tell which one a visitor is browsing from. */
export const COUNTRY_NAMES: Record<string, string> = {
  NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", EG: "Egypt", RW: "Rwanda", CI: "Côte d'Ivoire", SN: "Senegal",
  CM: "Cameroon", TZ: "Tanzania", UG: "Uganda", GB: "United Kingdom", US: "United States", CA: "Canada", AE: "United Arab Emirates",
};
export const HOME_COUNTRY = "NG";

export function countryName(code: string) { return COUNTRY_NAMES[code] ?? code; }

/**
 * The visitor's country, from the header the hosting proxy adds (Cloudflare, Vercel, or nginx with GeoIP setting X-Country-Code),
 * or the region in the browser's language, or the platform's home country. Only used to choose which cities to show first.
 */
export function visitorCountry(h: { get(name: string): string | null }): string {
  for (const name of ["cf-ipcountry", "x-vercel-ip-country", "x-country-code"]) {
    const v = (h.get(name) ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1") return v;
  }
  const lang = /-([A-Za-z]{2})\b/.exec(h.get("accept-language") ?? "");
  return lang ? lang[1].toUpperCase() : HOME_COUNTRY;
}

/** Where the map opens for a visitor from each country: centre and web-map zoom. Unknown countries open on a world view. */
export const COUNTRY_VIEWS: Record<string, { lat: number; lng: number; zoom: number }> = {
  NG: { lat: 9.08, lng: 8.68, zoom: 6 }, GH: { lat: 7.95, lng: -1.03, zoom: 7 }, KE: { lat: 0.2, lng: 37.9, zoom: 6 }, ZA: { lat: -28.8, lng: 24.7, zoom: 5 },
  EG: { lat: 26.8, lng: 30.8, zoom: 6 }, RW: { lat: -1.94, lng: 29.87, zoom: 8 }, CI: { lat: 7.54, lng: -5.55, zoom: 7 }, SN: { lat: 14.5, lng: -14.45, zoom: 7 },
  CM: { lat: 7.37, lng: 12.35, zoom: 6 }, TZ: { lat: -6.37, lng: 34.89, zoom: 6 }, UG: { lat: 1.37, lng: 32.29, zoom: 7 }, GB: { lat: 54.0, lng: -2.5, zoom: 6 },
  US: { lat: 39.8, lng: -98.6, zoom: 4 }, CA: { lat: 56.1, lng: -106.3, zoom: 4 }, AE: { lat: 24.2, lng: 54.4, zoom: 7 },
};
export const WORLD_VIEW = { lat: 15, lng: 10, zoom: 2 } as const;
export function countryView(code: string) { return COUNTRY_VIEWS[code] ?? WORLD_VIEW; }
