/**
 * Phone numbers in every country, as one international form (E.164: +, country code, number) so the same number typed two ways
 * ("0803 123 4567" in Nigeria, "+234 803 123 4567", "00234 803…") is recognised as the same person. A number written without its
 * country code is read in the country chosen beside it. No network or library needed.
 */

/** Country calling codes (ITU-T E.164), by ISO country. North America and much of the Caribbean share +1. */
const CODES = (
  "AD376 AE971 AF93 AG1 AI1 AL355 AM374 AO244 AQ672 AR54 AS1 AT43 AU61 AW297 AX358 AZ994 BA387 BB1 BD880 BE32 BF226 BG359 BH973 BI257 BJ229 " +
  "BL590 BM1 BN673 BO591 BQ599 BR55 BS1 BT975 BW267 BY375 BZ501 CA1 CC61 CD243 CF236 CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 CR506 CU53 " +
  "CV238 CW599 CX61 CY357 CZ420 DE49 DJ253 DK45 DM1 DO1 DZ213 EC593 EE372 EG20 EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FM691 FO298 FR33 GA241 " +
  "GB44 GD1 GE995 GF594 GG44 GH233 GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GS500 GT502 GU1 GW245 GY592 HK852 HN504 HR385 HT509 HU36 ID62 IE353 " +
  "IL972 IM44 IN91 IO246 IQ964 IR98 IS354 IT39 JE44 JM1 JO962 JP81 KE254 KG996 KH855 KI686 KM269 KN1 KP850 KR82 KW965 KY1 KZ7 LA856 LB961 LC1 " +
  "LI423 LK94 LR231 LS266 LT370 LU352 LV371 LY218 MA212 MC377 MD373 ME382 MF590 MG261 MH692 MK389 ML223 MM95 MN976 MO853 MP1 MQ596 MR222 MS1 " +
  "MT356 MU230 MV960 MW265 MX52 MY60 MZ258 NA264 NC687 NE227 NF672 NG234 NI505 NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 PG675 " +
  "PH63 PK92 PL48 PM508 PN64 PR1 PS970 PT351 PW680 PY595 QA974 RE262 RO40 RS381 RU7 RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 SI386 SJ47 " +
  "SK421 SL232 SM378 SN221 SO252 SR597 SS211 ST239 SV503 SX1 SY963 SZ268 TC1 TD235 TG228 TH66 TJ992 TK690 TL670 TM993 TN216 TO676 TR90 TT1 " +
  "TV688 TW886 TZ255 UA380 UG256 US1 UY598 UZ998 VA39 VC1 VE58 VG1 VI1 VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263"
).split(" ");
export const CALLING_CODES: Record<string, string> = Object.fromEntries(CODES.map((c) => [c.slice(0, 2), c.slice(2)]));

/** The digit dialled before a number inside the country (the "trunk" prefix), where it is not a single 0. */
const TRUNK: Record<string, string> = { RU: "8", KZ: "8", BY: "8", TM: "8", HU: "06" };
/** Countries where the leading 0 is part of the number and is kept after the country code. */
const KEEP_ZERO = new Set(["IT", "SM", "VA"]);
/** North America and the Caribbean: ten-digit numbers, an optional leading 1. */
const isNanp = (c: string) => CALLING_CODES[c] === "1";

export const dialCode = (country: string) => CALLING_CODES[country.toUpperCase()] ?? "";

/** Every known calling code, longest first, for reading a number that already carries one. */
const ALL_CODES = [...new Set(Object.values(CALLING_CODES))].sort((a, b) => b.length - a.length);
/** Whether a full international number (digits after +) starts with a real calling code and has a sensible length. */
function plausibleInternational(digits: string): boolean {
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return false;
  const code = ALL_CODES.find((c) => digits.startsWith(c));
  if (!code) return false;
  if (code === "234") return /^234[789][01]\d{8}$/.test(digits) || /^234[1-9]\d{6,8}$/.test(digits);
  if (code === "1") return digits.length === 11;
  return digits.length - code.length >= 4;
}

/**
 * The number in international form (+2348031234567), or null when it cannot be a phone number. `country` is used when the
 * number has no country code: "0803 123 4567" with NG, "024 123 4567" with GH, "(415) 555-0100" with US, "07700 900123" with GB.
 */
export function toE164(raw: string, country = "NG"): string | null {
  const c = (country || "NG").toUpperCase();
  const t = raw.trim();
  if (!t) return null;
  let d = t.replace(/[^\d+]/g, "");
  // Written with the country code: +234…, or 00234… (the international prefix used in most of the world), or 011… from North America.
  if (d.startsWith("+")) { d = d.slice(1).replace(/\D/g, ""); return plausibleInternational(d) ? `+${d}` : null; }
  if (d.startsWith("00")) { d = d.slice(2); return plausibleInternational(d) ? `+${d}` : null; }
  if (isNanp(c) && d.startsWith("011")) { d = d.slice(3); return plausibleInternational(d) ? `+${d}` : null; }
  const code = CALLING_CODES[c];
  if (!code) return null;
  if (isNanp(c)) {
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
  }
  // Typed with the country code but no +: 2348031234567 in Nigeria, 233241234567 in Ghana.
  if (d.startsWith(code) && !d.startsWith("0") && plausibleInternational(d) && d.length - code.length >= 8) return `+${d}`;
  const trunk = TRUNK[c] ?? "0";
  if (!KEEP_ZERO.has(c) && d.startsWith(trunk)) d = d.slice(trunk.length);
  if (c === "NG") return /^[789][01]\d{8}$/.test(d) ? `+234${d}` : null; // Nigerian mobiles, the numbers people give
  const full = code + d;
  if (KEEP_ZERO.has(c)) return d.length >= 6 && full.length <= 15 ? `+${full}` : null;
  return d.length >= 4 && !d.startsWith("0") && full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}

/** For a select: "🇳🇬 +234 Nigeria". */
export function flag(country: string): string {
  const c = country.toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
}
