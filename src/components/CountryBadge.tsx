import { COUNTRY_NAMES, countryName } from "@/lib/countries";

const BY_NAME = new Map(Object.entries(COUNTRY_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

/** A country code from a code ("GB") or a name ("United Kingdom"); null when it is neither. */
export function countryCode(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(v) && COUNTRY_NAMES[v.toUpperCase()]) return v.toUpperCase();
  return BY_NAME.get(v.toLowerCase()) ?? null;
}

/** The flag for a country code, made from its two regional-indicator letters (shown as letters where a device has no flags). */
const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Where a business, agent, partner or person is: the flag and the country's name (or its two-letter code when compact). */
export function CountryBadge({ country, compact = false }: { country: string | null | undefined; compact?: boolean }) {
  const code = countryCode(country);
  if (!code) return null;
  const name = countryName(code);
  return (
    <span className={`country-badge${compact ? " compact" : ""}`} title={name} aria-label={`Based in ${name}`}>
      <span className="country-flag" aria-hidden="true">{flag(code)}</span>
      <span className="country-name">{compact ? code : name}</span>
    </span>
  );
}
