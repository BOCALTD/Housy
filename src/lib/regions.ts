/**
 * Countries and currencies Housy works in (pure, tested on its own). Each country has its currency, which online payment provider
 * normally serves it (Paystack in the African countries it covers, Stripe elsewhere: the platform administrator can change this
 * per country), and the bank details used there for direct transfers. All the supported currencies have two decimal places, so
 * money is stored as whole minor units (kobo, cents, pence) in the same columns everywhere.
 */
export const CURRENCIES = {
  NGN: { symbol: "₦", name: "Nigerian naira", locale: "en-NG" },
  GHS: { symbol: "GH₵", name: "Ghanaian cedi", locale: "en-GH" },
  KES: { symbol: "KSh", name: "Kenyan shilling", locale: "en-KE" },
  ZAR: { symbol: "R", name: "South African rand", locale: "en-ZA" },
  USD: { symbol: "$", name: "US dollar", locale: "en-US" },
  GBP: { symbol: "£", name: "Pound sterling", locale: "en-GB" },
  CAD: { symbol: "C$", name: "Canadian dollar", locale: "en-CA" },
  EUR: { symbol: "€", name: "Euro", locale: "en-IE" },
  AUD: { symbol: "A$", name: "Australian dollar", locale: "en-AU" },
  AED: { symbol: "AED ", name: "UAE dirham", locale: "en-AE" },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];
export const isCurrency = (c: string): c is Currency => c in CURRENCIES;

export type OnlineProvider = "PAYSTACK" | "STRIPE" | "NONE";
/** The bank details a payer needs for a direct transfer in each banking system. */
export type BankSystem = "NUBAN" | "AFRICA_ACCOUNT" | "US_ACH" | "UK" | "CANADA" | "IBAN" | "AU_BSB";

export const COUNTRIES = {
  NG: { name: "Nigeria", currency: "NGN", online: "PAYSTACK", bank: "NUBAN", dial: "+234", timeZone: "Africa/Lagos" },
  GH: { name: "Ghana", currency: "GHS", online: "PAYSTACK", bank: "AFRICA_ACCOUNT", dial: "+233", timeZone: "Africa/Accra" },
  KE: { name: "Kenya", currency: "KES", online: "PAYSTACK", bank: "AFRICA_ACCOUNT", dial: "+254", timeZone: "Africa/Nairobi" },
  ZA: { name: "South Africa", currency: "ZAR", online: "PAYSTACK", bank: "AFRICA_ACCOUNT", dial: "+27", timeZone: "Africa/Johannesburg" },
  US: { name: "United States", currency: "USD", online: "STRIPE", bank: "US_ACH", dial: "+1", timeZone: "America/New_York" },
  GB: { name: "United Kingdom", currency: "GBP", online: "STRIPE", bank: "UK", dial: "+44", timeZone: "Europe/London" },
  CA: { name: "Canada", currency: "CAD", online: "STRIPE", bank: "CANADA", dial: "+1", timeZone: "America/Toronto" },
  IE: { name: "Ireland", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+353", timeZone: "Europe/Dublin" },
  DE: { name: "Germany", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+49", timeZone: "Europe/Berlin" },
  FR: { name: "France", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+33", timeZone: "Europe/Paris" },
  NL: { name: "Netherlands", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+31", timeZone: "Europe/Amsterdam" },
  ES: { name: "Spain", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+34", timeZone: "Europe/Madrid" },
  IT: { name: "Italy", currency: "EUR", online: "STRIPE", bank: "IBAN", dial: "+39", timeZone: "Europe/Rome" },
  AU: { name: "Australia", currency: "AUD", online: "STRIPE", bank: "AU_BSB", dial: "+61", timeZone: "Australia/Sydney" },
  AE: { name: "United Arab Emirates", currency: "AED", online: "STRIPE", bank: "IBAN", dial: "+971", timeZone: "Asia/Dubai" },
} as const satisfies Record<string, { name: string; currency: Currency; online: OnlineProvider; bank: BankSystem; dial: string; timeZone: string }>;
export type Country = keyof typeof COUNTRIES;
export const COUNTRY_CODES = Object.keys(COUNTRIES) as Country[];
export const isCountry = (c: string): c is Country => c in COUNTRIES;
export const countryName = (c: string) => (isCountry(c) ? COUNTRIES[c].name : c);
export const currencyOf = (c: string): Currency => (isCountry(c) ? COUNTRIES[c].currency : "NGN");

/** Where Paystack can take payments and settle to a local bank account (its "subaccounts"), and in which currency. */
export const PAYSTACK_COUNTRIES: Partial<Record<Country, { currency: Currency; bankListCountry: string }>> = {
  NG: { currency: "NGN", bankListCountry: "nigeria" }, GH: { currency: "GHS", bankListCountry: "ghana" },
  KE: { currency: "KES", bankListCountry: "kenya" }, ZA: { currency: "ZAR", bankListCountry: "south africa" },
};
/** Countries where Stripe can pay a business out (Connect Express accounts). */
export const STRIPE_COUNTRIES: Country[] = ["US", "GB", "CA", "IE", "DE", "FR", "NL", "ES", "IT", "AU", "AE"];

export function providerCanServe(provider: OnlineProvider, country: Country): boolean {
  if (provider === "PAYSTACK") return !!PAYSTACK_COUNTRIES[country];
  if (provider === "STRIPE") return STRIPE_COUNTRIES.includes(country);
  return true;
}

// ---------- Money in any supported currency ----------

/** Format minor units in a currency: 18500000000n NGN → "₦185,000,000"; 125050n USD → "$1,250.50". */
export function formatMoney(minor: bigint | number | string, currency: string = "NGN"): string {
  let k = BigInt(minor);
  const negative = k < 0n;
  if (negative) k = -k;
  const symbol = isCurrency(currency) ? CURRENCIES[currency].symbol : `${currency} `;
  const whole = (k / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = k % 100n;
  const text = symbol + whole + (frac === 0n ? "" : "." + frac.toString().padStart(2, "0"));
  return negative ? "-" + text : text;
}

/** Parse an amount typed in a currency ("1,250.50", "$1,250", "GBP 900") into minor units. */
export function parseMoney(input: string, currency: string = "NGN"): bigint {
  const symbol = isCurrency(currency) ? CURRENCIES[currency].symbol.trim() : "";
  let cleaned = input.trim().replace(new RegExp(`^${currency}\\s*`, "i"), "");
  if (symbol) cleaned = cleaned.split(symbol).join("");
  cleaned = cleaned.replace(/[\s,₦$£€]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`Enter an amount in ${isCurrency(currency) ? CURRENCIES[currency].name.toLowerCase() + "s" : currency}, for example 1,250 or 1250.50`);
  const [whole, frac = ""] = cleaned.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** Minor units as the plain amount for a form field: 125050n → "1250.50". */
export const moneyInput = (minor: bigint) => `${minor / 100n}${minor % 100n ? `.${String(minor % 100n).padStart(2, "0")}` : ""}`;

// ---------- Bank details for direct transfers ----------

export type BankField = { key: string; label: string; hint?: string; pattern: RegExp; problem: string; numeric?: boolean };
const F = {
  accountName: { key: "accountName", label: "Account name", hint: "Exactly as the bank shows it", pattern: /^.{2,200}$/, problem: "Enter the account name exactly as the bank shows it." },
  bankName: { key: "bankName", label: "Bank", pattern: /^.{2,120}$/, problem: "Enter the bank's name." },
} satisfies Record<string, BankField>;

export const BANK_FIELDS: Record<BankSystem, BankField[]> = {
  NUBAN: [F.bankName, F.accountName, { key: "accountNumber", label: "Account number", hint: "10 digits (NUBAN)", pattern: /^\d{10}$/, problem: "The account number must be the 10-digit NUBAN.", numeric: true }],
  AFRICA_ACCOUNT: [F.bankName, F.accountName, { key: "accountNumber", label: "Account number", pattern: /^\d{6,18}$/, problem: "Enter the account number (digits only).", numeric: true }],
  US_ACH: [F.bankName, F.accountName, { key: "routingNumber", label: "Routing number (ABA)", hint: "9 digits", pattern: /^\d{9}$/, problem: "The routing number has 9 digits.", numeric: true }, { key: "accountNumber", label: "Account number", pattern: /^\d{4,17}$/, problem: "Enter the account number (4 to 17 digits).", numeric: true }],
  UK: [F.bankName, F.accountName, { key: "sortCode", label: "Sort code", hint: "6 digits, for example 20-00-00", pattern: /^\d{6}$/, problem: "The sort code has 6 digits.", numeric: true }, { key: "accountNumber", label: "Account number", hint: "8 digits", pattern: /^\d{8}$/, problem: "A UK account number has 8 digits.", numeric: true }],
  CANADA: [F.bankName, F.accountName, { key: "institutionNumber", label: "Institution number", hint: "3 digits", pattern: /^\d{3}$/, problem: "The institution number has 3 digits.", numeric: true }, { key: "transitNumber", label: "Transit number", hint: "5 digits", pattern: /^\d{5}$/, problem: "The transit number has 5 digits.", numeric: true }, { key: "accountNumber", label: "Account number", pattern: /^\d{7,12}$/, problem: "Enter the account number (7 to 12 digits).", numeric: true }],
  IBAN: [F.bankName, F.accountName, { key: "iban", label: "IBAN", pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, problem: "Enter a valid IBAN." }, { key: "bic", label: "BIC / SWIFT", hint: "Optional", pattern: /^([A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?)?$/, problem: "A BIC has 8 or 11 letters and digits." }],
  AU_BSB: [F.bankName, F.accountName, { key: "bsb", label: "BSB", hint: "6 digits", pattern: /^\d{6}$/, problem: "The BSB has 6 digits.", numeric: true }, { key: "accountNumber", label: "Account number", pattern: /^\d{5,10}$/, problem: "Enter the account number (5 to 10 digits).", numeric: true }],
};

export const bankFieldsFor = (country: string) => BANK_FIELDS[isCountry(country) ? COUNTRIES[country].bank : "NUBAN"];

/** IBAN check digits (ISO 13616, mod 97). */
export function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let r = 0;
  for (const d of moved) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}

/** US routing numbers carry a check digit (3-7-1 weights). */
export function abaValid(n: string): boolean {
  if (!/^\d{9}$/.test(n)) return false;
  const d = n.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

/** Clean and check bank details for a country. Returns the cleaned values, or the first problem in plain words. */
export function checkBankDetails(country: string, raw: Record<string, string>): { ok: true; details: Record<string, string> } | { ok: false; problem: string } {
  const out: Record<string, string> = {};
  for (const f of bankFieldsFor(country)) {
    let v = (raw[f.key] ?? "").trim();
    if (f.numeric) v = v.replace(/[\s-]/g, "");
    if (f.key === "iban" || f.key === "bic") v = v.replace(/\s+/g, "").toUpperCase();
    if (!f.pattern.test(v)) return { ok: false, problem: f.problem };
    if (f.key === "iban" && !ibanValid(v)) return { ok: false, problem: "That IBAN does not check out. Copy it again from the bank." };
    if (f.key === "routingNumber" && !abaValid(v)) return { ok: false, problem: "That routing number does not check out. Copy it again from the bank." };
    out[f.key] = v;
  }
  return { ok: true, details: out };
}

/** Bank details as lines for a payer: label and value, in the country's order. */
export function bankLines(country: string, details: Record<string, string>): { label: string; value: string }[] {
  return bankFieldsFor(country).filter((f) => details[f.key]).map((f) => ({ label: f.label, value: f.key === "sortCode" ? details[f.key].replace(/(\d{2})(\d{2})(\d{2})/, "$1-$2-$3") : details[f.key] }));
}
