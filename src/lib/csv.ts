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
