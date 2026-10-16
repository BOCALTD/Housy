/**
 * Pure rules for bringing existing records in from spreadsheets: reading CSV, matching column headings, and the keys used to spot
 * duplicates. No database here, so every rule can be tested on its own.
 */

import { parseNairaToKobo } from "./money";
import { generateRentSchedule, type Frequency } from "./rent";
import { parseDateOnly } from "./dates";

export const IMPORT_KINDS = ["ASSETS", "LEASES"] as const;
export type ImportKindName = (typeof IMPORT_KINDS)[number];
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Read CSV text (RFC 4180): quoted cells, doubled quotes, commas and line breaks inside quotes, CRLF or LF, and an optional byte-order mark. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQuotes = false, started = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") { inQuotes = true; started = true; }
    else if (ch === ",") { row.push(cell); cell = ""; started = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (started || cell !== "") { row.push(cell); rows.push(row); }
      row = []; cell = ""; started = false;
    } else { cell += ch; started = true; }
  }
  if (inQuotes) throw new Error("A quoted cell is never closed. Check for a stray quotation mark.");
  if (started || cell !== "") { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "Asset Class", "asset_class" and "ASSET-CLASS" are the same heading. */
export const headingKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface Column { key: string; label: string; required: boolean; hint: string; aliases?: string[] }

export const ASSET_COLUMNS: Column[] = [
  { key: "name", label: "Name", required: true, hint: "For example: Block B, Adeola Court", aliases: ["propertyname", "asset", "assetname"] },
  { key: "assetClass", label: "Class", required: true, hint: "Residential, Commercial, Land, Industrial, Plant and machinery or Other", aliases: ["type", "propertytype"] },
  { key: "category", label: "Category", required: true, hint: "For example: Duplex, Shop, Generator" },
  { key: "companyRelationship", label: "Held as", required: true, hint: "Owner, Manager, Custodian or Listing agent", aliases: ["relationship", "heldas", "role"] },
  { key: "address", label: "Address", required: false, hint: "Street address" },
  { key: "city", label: "City", required: false, hint: "For example: Lagos" },
  { key: "state", label: "State", required: false, hint: "For example: Lagos" },
  { key: "description", label: "Description", required: false, hint: "Short notes" },
  { key: "status", label: "Status", required: false, hint: "Active, Vacant, Occupied, Under renovation. Blank means Active" },
  { key: "acquisition", label: "Acquisition cost", required: false, hint: "Naira, for example 45,000,000", aliases: ["acquisitioncost", "cost", "purchaseprice"] },
  { key: "acquiredOn", label: "Acquired on", required: false, hint: "Date as YYYY-MM-DD", aliases: ["acquisitiondate", "dateacquired"] },
];

export const LEASE_COLUMNS: Column[] = [
  { key: "assetRef", label: "Asset reference", required: false, hint: "For example AST-00012. Give this or the asset name", aliases: ["assetreference", "propertyref", "ref"] },
  { key: "assetName", label: "Asset name", required: false, hint: "Used when the reference is blank. Must match one asset exactly", aliases: ["property", "propertyname", "asset"] },
  { key: "occupantName", label: "Tenant", required: true, hint: "Tenant or occupying organisation", aliases: ["tenant", "tenantname", "occupant", "name"] },
  { key: "occupantContact", label: "Tenant contact", required: false, hint: "Phone or email", aliases: ["contact", "tenantcontact", "phone"] },
  { key: "unit", label: "Unit", required: false, hint: "Flat or shop number. Blank means the whole property" },
  { key: "startDate", label: "Start date", required: true, hint: "YYYY-MM-DD", aliases: ["start", "from"] },
  { key: "endDate", label: "End date", required: true, hint: "YYYY-MM-DD, after the start date", aliases: ["end", "to", "expiry"] },
  { key: "rent", label: "Rent per period", required: true, hint: "Naira each time rent falls due", aliases: ["rentperperiod", "rentamount", "amount"] },
  { key: "frequency", label: "How often", required: true, hint: "Monthly, Quarterly, Half yearly, Yearly or Custom", aliases: ["paymentfrequency", "period"] },
  { key: "intervalMonths", label: "Months between payments", required: false, hint: "Only when How often is Custom", aliases: ["interval"] },
  { key: "deposit", label: "Deposit", required: false, hint: "Naira held as deposit. Recorded on the lease; the money itself is entered in the deposit ledger", aliases: ["securitydeposit", "cautiondeposit"] },
  { key: "graceDays", label: "Grace days", required: false, hint: "Days after the due date before rent is late" },
  { key: "noticeDays", label: "Notice days", required: false, hint: "Notice period in days" },
  { key: "amountPaid", label: "Paid so far", required: false, hint: "Total naira the tenant has paid on this lease to date. Cleared against the oldest rent first", aliases: ["amountpaidtodate", "paidtodate", "paid", "totalpaid"] },
];

export const columnsFor = (kind: ImportKindName) => (kind === "ASSETS" ? ASSET_COLUMNS : LEASE_COLUMNS);

export interface Mapped { rows: { rowNo: number; cells: Record<string, string> }[]; unknownHeadings: string[]; missing: string[] }

/** Match the spreadsheet's headings to our columns, and turn each row into named cells. `rowNo` is the line number in the file (the heading is line 1). */
export function mapRows(kind: ImportKindName, table: string[][]): Mapped {
  if (table.length === 0) throw new Error("The file is empty.");
  const cols = columnsFor(kind);
  const byHeading = new Map<string, string>();
  for (const c of cols) for (const k of [c.key, c.label, ...(c.aliases ?? [])]) if (!byHeading.has(headingKey(k))) byHeading.set(headingKey(k), c.key);
  const heads = table[0].map((h) => byHeading.get(headingKey(h)) ?? null);
  const seen = new Set<string>();
  for (const h of heads) { if (h && seen.has(h)) throw new Error(`Two columns are both "${cols.find((c) => c.key === h)!.label}". Remove one.`); if (h) seen.add(h); }
  const unknownHeadings = table[0].filter((_, i) => heads[i] === null && table[0][i].trim() !== "");
  const missing = cols.filter((c) => c.required && !seen.has(c.key)).map((c) => c.label);
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`The file has ${body.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`);
  const rows = body.map((r, i) => {
    const cells: Record<string, string> = {};
    heads.forEach((h, k) => { if (h) cells[h] = (r[k] ?? "").trim(); });
    return { rowNo: i + 2, cells };
  });
  return { rows, unknownHeadings, missing };
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** What makes two assets the same one: the name, the address and the city, ignoring case, punctuation and spacing. */
export const assetKey = (a: { name: string; address?: string; city?: string }) => `${flat(a.name)}|${flat(a.address ?? "")}|${flat(a.city ?? "")}`;
/** What makes two leases the same one: the same property and unit, the same start, the same tenant. */
export const leaseKey = (l: { assetId: string; unit: string; startDate: string; occupantName: string }) => `${l.assetId}|${flat(l.unit)}|${l.startDate}|${flat(l.occupantName)}`;

/** "Under renovation", "under-renovation" and "UNDER_RENOVATION" all mean UNDER_RENOVATION. Returns the matching allowed value or null. */
export function matchChoice(input: string, allowed: readonly string[], aliases: Record<string, string> = {}): string | null {
  const k = input.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!k) return null;
  const a = aliases[k];
  if (a && allowed.includes(a)) return a;
  return allowed.find((v) => v === k) ?? null;
}

export const CLASS_ALIASES: Record<string, string> = { PLANT_AND_MACHINERY: "PLANT_MACHINERY", PLANT: "PLANT_MACHINERY", MACHINERY: "PLANT_MACHINERY", HOUSE: "RESIDENTIAL", HOME: "RESIDENTIAL", OFFICE: "COMMERCIAL", SHOP: "COMMERCIAL", RETAIL: "COMMERCIAL" };
export const RELATIONSHIP_ALIASES: Record<string, string> = { LISTING_AGENT: "LISTING_AGENT", AGENT: "LISTING_AGENT", OWNED: "OWNER", MANAGING: "MANAGER", PROPERTY_MANAGER: "MANAGER" };
export const FREQUENCY_ALIASES: Record<string, string> = { HALF_YEARLY: "HALF_YEARLY", HALFYEARLY: "HALF_YEARLY", BI_ANNUAL: "HALF_YEARLY", SEMI_ANNUAL: "HALF_YEARLY", BIANNUAL: "HALF_YEARLY", SIX_MONTHLY: "HALF_YEARLY", ANNUAL: "YEARLY", ANNUALLY: "YEARLY", PER_YEAR: "YEARLY", PER_MONTH: "MONTHLY", QUARTERLY: "QUARTERLY", THREE_MONTHLY: "QUARTERLY" };

/** Spreadsheets often store 20250131 as a number, 31/01/2025 or 2025-1-31. Accept the unambiguous ones and say what is wrong with the rest. */
export function normaliseDate(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let x: RegExpExecArray | null;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) {
    // Day first, as written in Nigeria. A first number above 12 is certainly a day; a second number above 12 would make this month-first, which we refuse to guess.
    d = +x[1]; m = +x[2]; y = +x[3];
    if (m > 12) return null;
  } else return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > dim || y < 1900 || y > 2200) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---------- Checking one row ----------
// These return the same text fields the forms submit, so the real services validate them again when the row is created.



const ASSET_CLASS_VALUES = ["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"] as const;
const ASSET_STATUS_VALUES = ["ACTIVE", "VACANT", "OCCUPIED", "UNDER_RENOVATION"] as const;
const RELATIONSHIP_VALUES = ["OWNER", "MANAGER", "CUSTODIAN", "LISTING_AGENT"] as const;
const FREQUENCY_VALUES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "CUSTOM"] as const;

export type RowCheck<T> = { ok: true; input: T } | { ok: false; errors: string[] };

export interface AssetInput { name: string; assetClass: string; category: string; description: string; address: string; city: string; state: string; status: string; companyRelationship: string; acquisitionCost: string; acquiredOn: string }

const money = (label: string, v: string, errors: string[], opts: { min?: bigint } = {}): bigint | null => {
  if (!v) return null;
  try { const k = parseNairaToKobo(v); if (opts.min !== undefined && k < opts.min) { errors.push(`${label} is too small`); return null; } return k; }
  catch { errors.push(`${label} "${v}" is not an amount in naira`); return null; }
};
const date = (label: string, v: string, errors: string[]): string | null => {
  if (!v) return null;
  const d = normaliseDate(v);
  if (!d) { errors.push(`${label} "${v}" is not a date. Write it as YYYY-MM-DD`); return null; }
  return d;
};

export function checkAssetRow(c: Record<string, string>): RowCheck<AssetInput> {
  const errors: string[] = [];
  const name = (c.name ?? "").trim();
  if (name.length < 2) errors.push("Name is missing");
  if (name.length > 200) errors.push("Name is longer than 200 characters");
  const assetClass = matchChoice(c.assetClass ?? "", ASSET_CLASS_VALUES, CLASS_ALIASES);
  if (!assetClass) errors.push(`Class "${c.assetClass ?? ""}" is not one of: Residential, Commercial, Land, Industrial, Plant and machinery, Other`);
  const category = (c.category ?? "").trim();
  if (category.length < 2) errors.push("Category is missing");
  const rel = matchChoice(c.companyRelationship ?? "", RELATIONSHIP_VALUES, RELATIONSHIP_ALIASES);
  if (!rel) errors.push(`Held as "${c.companyRelationship ?? ""}" is not one of: Owner, Manager, Custodian, Listing agent`);
  let status = "ACTIVE";
  if ((c.status ?? "").trim()) {
    const s = matchChoice(c.status, ASSET_STATUS_VALUES);
    if (!s) errors.push(`Status "${c.status}" is not one of: Active, Vacant, Occupied, Under renovation`); else status = s;
  }
  const cost = money("Acquisition cost", c.acquisition ?? "", errors);
  const acquiredOn = date("Acquired on", c.acquiredOn ?? "", errors);
  for (const [k, max] of [["address", 300], ["city", 80], ["state", 80], ["description", 5000]] as const) if ((c[k] ?? "").length > max) errors.push(`${k} is longer than ${max} characters`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, input: {
    name, assetClass: assetClass!, category, description: (c.description ?? "").trim(), address: (c.address ?? "").trim(), city: (c.city ?? "").trim(), state: (c.state ?? "").trim(),
    status, companyRelationship: rel!, acquisitionCost: cost === null ? "" : plain(cost), acquiredOn: acquiredOn ?? "",
  } };
}

export interface LeaseInput { assetRef: string; assetName: string; occupantName: string; occupantContact: string; unit: string; startDate: string; endDate: string; rent: string; frequency: string; intervalMonths: string; deposit: string; graceDays: string; noticeDays: string; paidKobo: bigint; totalDueKobo: bigint }

const plain = (k: bigint) => (k % 100n === 0n ? String(k / 100n) : `${k / 100n}.${String(k % 100n).padStart(2, "0")}`);
export const leasePlainRent = (i: LeaseInput) => i.rent;

export function checkLeaseRow(c: Record<string, string>): RowCheck<LeaseInput> {
  const errors: string[] = [];
  const assetRef = (c.assetRef ?? "").trim().toUpperCase(), assetName = (c.assetName ?? "").trim();
  if (!assetRef && !assetName) errors.push("Give the asset reference or the asset name");
  const occupantName = (c.occupantName ?? "").trim();
  if (occupantName.length < 2) errors.push("Tenant is missing");
  if (occupantName.length > 200) errors.push("Tenant is longer than 200 characters");
  const startDate = date("Start date", c.startDate ?? "", errors), endDate = date("End date", c.endDate ?? "", errors);
  if (!c.startDate) errors.push("Start date is missing");
  if (!c.endDate) errors.push("End date is missing");
  if (startDate && endDate && endDate <= startDate) errors.push("End date must be after the start date");
  const rent = money("Rent", c.rent ?? "", errors);
  if (!c.rent) errors.push("Rent is missing"); else if (rent !== null && rent <= 0n) errors.push("Rent must be more than zero");
  const frequency = matchChoice(c.frequency ?? "", FREQUENCY_VALUES, FREQUENCY_ALIASES);
  if (!frequency) errors.push(`How often "${c.frequency ?? ""}" is not one of: Monthly, Quarterly, Half yearly, Yearly, Custom`);
  const im = (c.intervalMonths ?? "").trim();
  if (frequency === "CUSTOM" && !/^\d+$/.test(im)) errors.push("Custom needs the months between payments");
  if (frequency !== "CUSTOM" && im) errors.push("Months between payments is only for Custom");
  const deposit = money("Deposit", c.deposit ?? "", errors);
  const paid = money("Paid so far", c.amountPaid ?? "", errors);
  for (const k of ["graceDays", "noticeDays"] as const) if ((c[k] ?? "").trim() && !/^\d+$/.test(c[k].trim())) errors.push(`${k === "graceDays" ? "Grace days" : "Notice days"} must be a whole number`);
  if ((c.unit ?? "").length > 60) errors.push("Unit is longer than 60 characters");
  if ((c.occupantContact ?? "").length > 200) errors.push("Tenant contact is longer than 200 characters");

  let totalDue = 0n;
  if (!errors.length && startDate && endDate && rent && frequency) {
    try {
      const sched = generateRentSchedule({ startDate: parseDateOnly(startDate), endDate: parseDateOnly(endDate), frequency: frequency as Frequency, rentKobo: rent, intervalMonths: frequency === "CUSTOM" ? Number(im) : null });
      if (sched.length === 0) errors.push("These dates produce no rent payments");
      totalDue = sched.reduce((s, x) => s + x.amountKobo, 0n);
      if (sched.length > 600) errors.push("These dates produce more than 600 rent payments");
    } catch (e) { errors.push(e instanceof Error ? e.message : "Cannot build the rent schedule"); }
    if (paid !== null && totalDue > 0n && paid > totalDue) errors.push(`Paid so far (${plain(paid)}) is more than all the rent on this lease (${plain(totalDue)})`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, input: {
    assetRef, assetName, occupantName, occupantContact: (c.occupantContact ?? "").trim(), unit: (c.unit ?? "").trim(), startDate: startDate!, endDate: endDate!,
    rent: plain(rent!), frequency: frequency!, intervalMonths: im, deposit: deposit === null ? "" : plain(deposit), graceDays: (c.graceDays ?? "").trim(), noticeDays: (c.noticeDays ?? "").trim(),
    paidKobo: paid ?? 0n, totalDueKobo: totalDue,
  } };
}

/** The CSV a person can fill in. One example row shows the shape. */
export function templateCsv(kind: ImportKindName): string {
  const cols = columnsFor(kind);
  const example: Record<string, string> = kind === "ASSETS"
    ? { name: "Block B, Adeola Court", assetClass: "Residential", category: "Apartment block", companyRelationship: "Owner", address: "12 Admiralty Way", city: "Lagos", state: "Lagos", status: "Occupied", acquisition: "45000000", acquiredOn: "2019-03-01" }
    : { assetRef: "AST-00001", occupantName: "Ngozi Eze", occupantContact: "08031234567", unit: "Flat 2", startDate: "2026-01-01", endDate: "2026-12-31", rent: "1200000", frequency: "Quarterly", deposit: "600000", graceDays: "7", noticeDays: "30", amountPaid: "2400000" };
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [cols.map((c) => q(c.label)).join(","), cols.map((c) => q(example[c.key] ?? "")).join(",")].join("\r\n") + "\r\n";
}
