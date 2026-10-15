/** Pure commission arithmetic. Money is integer kobo and shares are basis points (10,000 = 100%). No rates are built in: the company sets its own. */

export const COMMISSION_METHODS = ["PERCENT", "FIXED"] as const;
export const COMMISSION_APPLIES = ["ALL", "SALE", "RENT", "LEASE"] as const;
export const SPLIT_ROLES = ["LISTING_AGENT", "SELLING_AGENT", "TEAM_LEAD", "REFERRAL", "OTHER"] as const;

/** "2.5" -> 250 basis points. Accepts up to two decimals, 0.01% to 100%. */
export function parsePercentToBps(input: string): number {
  const t = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw new Error("Enter a percentage such as 5 or 2.5");
  const [w, f = ""] = t.split(".");
  const bps = Number(w) * 100 + Number((f + "00").slice(0, 2));
  if (bps < 1 || bps > 10_000) throw new Error("The percentage must be between 0.01 and 100");
  return bps;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** The commission for a deal: a percentage of the agreed price (rounded to the nearest kobo, halves up) or a fixed sum. */
export function commissionAmount(rule: { method: string; rateBps: number | null; fixedKobo: bigint | null }, basisKobo: bigint): bigint {
  if (rule.method === "FIXED") {
    if (rule.fixedKobo === null || rule.fixedKobo <= 0n) throw new Error("This rule has no fixed amount");
    return rule.fixedKobo;
  }
  if (rule.rateBps === null || rule.rateBps < 1 || rule.rateBps > 10_000) throw new Error("This rule has no rate");
  if (basisKobo <= 0n) throw new Error("The deal has no agreed price");
  return (basisKobo * BigInt(rule.rateBps) + 5_000n) / 10_000n;
}

export function rulesApplyTo(applies: string, dealType: string): boolean {
  return applies === "ALL" || applies === dealType;
}

export function splitProblem(shares: { key: string; bps: number }[]): string | null {
  if (shares.length === 0) return "Add at least one person to share the commission";
  const keys = new Set<string>();
  for (const s of shares) {
    if (!Number.isInteger(s.bps) || s.bps < 1 || s.bps > 10_000) return "Each share must be between 0.01% and 100%";
    if (keys.has(s.key)) return "A person can appear only once in the split";
    keys.add(s.key);
  }
  const total = shares.reduce((n, s) => n + s.bps, 0);
  if (total !== 10_000) return `The shares add up to ${bpsToPercent(total)}%. They must add up to exactly 100%`;
  return null;
}

/**
 * Divide a total among shares in basis points with no kobo lost or invented: each person gets their whole-kobo part, and the
 * leftover kobo go one each to the largest fractional remainders (ties to the earlier person in the list).
 */
export function allocate(totalKobo: bigint, bps: number[]): bigint[] {
  if (bps.reduce((n, b) => n + b, 0) !== 10_000) throw new Error("Shares must add up to 100%");
  const base = bps.map((b) => (totalKobo * BigInt(b)) / 10_000n);
  const rem = bps.map((b, i) => ({ i, r: (totalKobo * BigInt(b)) % 10_000n }));
  let left = totalKobo - base.reduce((n, x) => n + x, 0n);
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const x of rem) {
    if (left === 0n) break;
    base[x.i] += 1n;
    left -= 1n;
  }
  return base;
}

/** Where a commission stands in payment terms. */
export function payoutStatus(status: string, splits: { paidAt: Date | null }[]): "NOT_DUE" | "UNPAID" | "PART_PAID" | "PAID" {
  if (status !== "APPROVED" && status !== "PAID") return "NOT_DUE";
  const paid = splits.filter((s) => s.paidAt).length;
  if (paid === 0) return "UNPAID";
  return paid === splits.length ? "PAID" : "PART_PAID";
}

/** Percentage in basis points of part over whole, rounded to the nearest basis point (0 when the whole is 0). */
export function rateBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 10_000) / whole);
}
