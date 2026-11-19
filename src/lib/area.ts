// Areas are kept as whole numbers of hundredths of a square metre (12050 = 120.5 m²), so sums and shares stay exact.

/** A typed area ("120.5", "1,250", "450.25 m²") as hundredths of a square metre. Two decimal places at most. */
export function parseArea(input: string): number {
  const t = input.trim().replace(/\s*(m²|m2|sqm|sq\.? ?m)$/i, "").replace(/[\s,]/g, "");
  const m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error("Enter the area in square metres, for example 120 or 120.5");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Hundredths of a square metre as square metres, for arithmetic and display. */
export const sqm = (area100: number) => area100 / 100;

/** "120.5 m²", "1,250 m²". */
export function formatArea(area100: number, suffix = " m²"): string {
  return `${sqm(area100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}${suffix}`;
}

/** The value for an input showing this area ("120.5"). */
export const areaInput = (area100: number | null | undefined) => (area100 == null ? "" : String(sqm(area100)));
