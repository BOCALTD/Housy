// Money is stored as integer kobo (BigInt). Never use floating point for money (master prompt Section 42).

const NAIRA = "₦";

/** Parse a user-entered naira amount ("185,000,000", "1500.50", "₦2,000") into kobo. */
export function parseNairaToKobo(input: string): bigint {
  const cleaned = input.replace(/[\s,₦]/g, "").replace(/^NGN/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Enter an amount in naira, for example 185,000,000 or 1500.50");
  }
  const [whole, frac = ""] = cleaned.split(".");
  const kobo = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return kobo;
}

/** Format kobo as naira with thousands separators: 18500000000n -> "₦185,000,000". */
export function formatKobo(kobo: bigint | number | string): string {
  let k = BigInt(kobo);
  const negative = k < 0n;
  if (negative) k = -k;
  const whole = (k / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = k % 100n;
  const text = NAIRA + whole + (frac === 0n ? "" : "." + frac.toString().padStart(2, "0"));
  return negative ? "-" + text : text;
}
