/**
 * Every country (ISO 3166-1, plus Kosovo), named from the built-in international tables so the names are always right, Nigeria
 * and the most common choices first. People in any country can use Housy; listings are strongest where companies have joined.
 */
const ALL_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
/** Shown first in country lists. */
export const POPULAR_COUNTRIES = ["NG", "GH", "KE", "ZA", "GB", "US", "CA", "AE", "EG", "RW", "CI", "SN", "CM", "TZ", "UG"];
const display = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const nameOf = (c: string) => { try { return display?.of(c) ?? c; } catch { return c; } };
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  [...POPULAR_COUNTRIES, ...ALL_CODES.filter((c) => !POPULAR_COUNTRIES.includes(c)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))].map((c) => [c, nameOf(c)]),
);
/** For a select: the popular group, then everyone else A to Z. */
export const COUNTRY_GROUPS = { popular: POPULAR_COUNTRIES.map((c) => [c, COUNTRY_NAMES[c]] as const), all: Object.entries(COUNTRY_NAMES).filter(([c]) => !POPULAR_COUNTRIES.includes(c)) };
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
