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
