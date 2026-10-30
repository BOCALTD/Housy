/**
 * Turn rows into CSV text. Cells that start with =, +, - or @ are prefixed with an apostrophe so a
 * spreadsheet never runs them as a formula (CSV injection), and quotes, commas and newlines are escaped.
 */
export function csvCell(value: string | number | bigint | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | bigint | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Kobo as a plain decimal naira string for spreadsheets, for example 123456n -> "1234.56". */
export function koboToPlain(kobo: bigint): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Like toCsv, but cells in the named columns that are plain numbers (for example "-1500.00") are written as they are, so an
 * accounting package reads a negative amount as a number. Anything else in those columns is still guarded.
 */
export function toCsvWithAmounts(header: string[], rows: (string | number | bigint | null | undefined)[][], amountColumns: string[]): string {
  const idx = new Set(amountColumns.map((c) => header.indexOf(c)).filter((i) => i >= 0));
  const cell = (v: string | number | bigint | null | undefined, i: number) => (idx.has(i) && typeof v === "string" && /^-?\d+(?:\.\d{1,2})?$/.test(v) ? v : csvCell(v));
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
