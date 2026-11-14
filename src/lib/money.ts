// Money is stored as integer minor units (kobo, cents, pence) in BigInt. Never use floating point for money (master prompt Section 42).
// The columns are named *_kobo from when Housy was naira-only; the amount is in the currency of the record or workspace.
import { CURRENCIES, formatMoney, isCurrency } from "./regions";
import { requestCurrency } from "./money-context";

const SYMBOLS = [...new Set(Object.values(CURRENCIES).map((c) => c.symbol.trim()))].sort((a, b) => b.length - a.length);

/**
 * Parse a typed amount ("185,000,000", "1500.50", "₦2,000", "$1,250", "GBP 900") into minor units. The amount is taken in the
 * workspace's currency; any supported currency symbol or code typed with it is ignored.
 */
export function parseNairaToKobo(input: string): bigint {
  let cleaned = input.trim().replace(/^[A-Z]{3}\s*/i, "");
  for (const s of SYMBOLS) cleaned = cleaned.split(s).join("");
  cleaned = cleaned.replace(/[\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    const cur = requestCurrency();
    throw new Error(`Enter an amount${isCurrency(cur) ? ` in ${CURRENCIES[cur].name}` : ""}, for example 185,000 or 1500.50`);
  }
  const [whole, frac = ""] = cleaned.split(".");
  const kobo = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return kobo;
}

/**
 * Format minor units with thousands separators: 18500000000n -> "₦185,000,000". In the workspace's currency unless one is given;
 * naira when there is no workspace (public pages pass each record's own currency).
 */
export function formatKobo(kobo: bigint | number | string, currency?: string): string {
  return formatMoney(kobo, currency ?? requestCurrency());
}

/** The workspace's currency symbol for form labels ("₦", "$", "£"); naira when there is no workspace. */
export function moneySymbol(currency?: string): string {
  const c = currency ?? requestCurrency();
  return isCurrency(c) ? CURRENCIES[c].symbol.trim() : c;
}
