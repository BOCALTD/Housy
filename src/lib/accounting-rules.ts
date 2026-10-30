/**
 * Accounting export (master prompt §13.3): the company's rent, deposit and service charge records as balanced double-entry
 * journals, ready to import into its accounting package. The platform is not the books of account; this hands the records
 * over in a form an accountant can post and reconcile.
 *
 * Two rules matter most:
 * - Rent on a property the company only manages belongs to the owner. It is posted to "Rent held for owners", never to income.
 * - Service charge money is the tenants' fund (§13.1). Assessments, collections and spending move the fund, not income.
 *
 * Pure functions, tested on their own.
 */

export const ACCOUNTS = {
  BANK: { code: "1000", name: "Bank" },
  TENANT_RECEIVABLE: { code: "1100", name: "Tenant rent receivable" },
  SERVICE_RECEIVABLE: { code: "1110", name: "Service charge receivable" },
  PAYABLES: { code: "2000", name: "Accounts payable" },
  OWNER_RENT: { code: "2100", name: "Rent held for property owners" },
  DEPOSITS_HELD: { code: "2200", name: "Tenant deposits held" },
  SERVICE_FUND: { code: "2300", name: "Service charge fund" },
  TENANT_CREDIT: { code: "2400", name: "Tenant payments in advance" },
  RENT_INCOME: { code: "4000", name: "Rental income" },
  OTHER_INCOME: { code: "4010", name: "Late fees and deposit deductions" },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;
export type AccountCodes = Partial<Record<AccountKey, string>>;

export const ACCOUNT_HELP: Record<AccountKey, string> = {
  BANK: "Where receipts are paid in and refunds paid out.",
  TENANT_RECEIVABLE: "Rent billed to tenants and not yet paid.",
  SERVICE_RECEIVABLE: "Service charge billed to tenants and not yet paid.",
  PAYABLES: "Approved service charge spending not yet paid to suppliers.",
  OWNER_RENT: "Rent on properties you manage for someone else. It is the owner's money, not your income.",
  DEPOSITS_HELD: "Caution deposits you hold until the tenant leaves.",
  SERVICE_FUND: "The tenants' service charge fund. Not income.",
  TENANT_CREDIT: "Money received beyond what was billed, held until the next charge.",
  RENT_INCOME: "Rent on properties your company owns.",
  OTHER_INCOME: "Late fees and deductions from deposits on properties you own.",
};

/** Codes must be short and plain so every accounting package accepts them. */
export function cleanCodes(raw: Record<string, unknown>): { codes: AccountCodes; problems: string[] } {
  const codes: AccountCodes = {};
  const problems: string[] = [];
  const seen = new Map<string, AccountKey>();
  for (const k of Object.keys(ACCOUNTS) as AccountKey[]) {
    const v = typeof raw[k] === "string" ? (raw[k] as string).trim() : "";
    if (!v) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,29}$/.test(v)) { problems.push(`${ACCOUNTS[k].name}: use up to 30 letters, numbers, dots, dashes or slashes`); continue; }
    const dup = seen.get(v.toLowerCase());
    if (dup) { problems.push(`${ACCOUNTS[k].name} and ${ACCOUNTS[dup].name} cannot share the code ${v}`); continue; }
    seen.set(v.toLowerCase(), k);
    codes[k] = v;
  }
  return { codes, problems };
}

export type Line = { account: AccountKey; debit: bigint; credit: bigint };
export type Entry = { date: string; source: string; ref: string; property: string; memo: string; lines: Line[] };

export type AccountingEvent =
  | { kind: "CHARGE"; date: string; ref: string; property: string; owned: boolean; amount: bigint; memo: string }
  | { kind: "ADJUSTMENT"; date: string; ref: string; property: string; owned: boolean; amount: bigint; adjustment: string; memo: string }
  | { kind: "RECEIPT"; date: string; ref: string; property: string; amount: bigint; allocated: bigint; memo: string; reversed?: boolean }
  | { kind: "DEPOSIT"; date: string; ref: string; property: string; owned: boolean; entry: "RECEIVED" | "DEDUCTION" | "REFUND"; amount: bigint; memo: string }
  | { kind: "SERVICE_ASSESSMENT"; date: string; ref: string; property: string; amount: bigint; memo: string }
  | { kind: "SERVICE_COLLECTION"; date: string; ref: string; property: string; amount: bigint; memo: string; reversed?: boolean }
  | { kind: "SERVICE_EXPENSE"; date: string; ref: string; property: string; amount: bigint; memo: string };

const dr = (account: AccountKey, v: bigint): Line => ({ account, debit: v, credit: 0n });
const cr = (account: AccountKey, v: bigint): Line => ({ account, debit: 0n, credit: v });
const flip = (ls: Line[]) => ls.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));

/** The journal lines for one record. Every entry balances; amounts are kobo. */
export function entryFor(e: AccountingEvent): Entry | null {
  const base = { date: e.date, ref: e.ref, property: e.property, memo: e.memo };
  switch (e.kind) {
    case "CHARGE": {
      if (e.amount <= 0n) return null;
      return { ...base, source: "Rent billed", lines: [dr("TENANT_RECEIVABLE", e.amount), cr(e.owned ? "RENT_INCOME" : "OWNER_RENT", e.amount)] };
    }
    case "ADJUSTMENT": {
      if (e.amount === 0n) return null;
      const late = e.adjustment === "LATE_FEE";
      const other: AccountKey = !e.owned ? "OWNER_RENT" : late ? "OTHER_INCOME" : "RENT_INCOME";
      const v = e.amount < 0n ? -e.amount : e.amount;
      const lines = [dr("TENANT_RECEIVABLE", v), cr(other, v)];
      return { ...base, source: `Rent ${e.adjustment.toLowerCase().replace(/_/g, " ")}`, lines: e.amount > 0n ? lines : flip(lines) };
    }
    case "RECEIPT": {
      if (e.amount <= 0n) return null;
      const allocated = e.allocated > e.amount ? e.amount : e.allocated;
      const lines = [dr("BANK", e.amount), cr("TENANT_RECEIVABLE", allocated)];
      if (e.amount > allocated) lines.push(cr("TENANT_CREDIT", e.amount - allocated));
      return { ...base, source: e.reversed ? "Rent receipt reversed" : "Rent received", lines: e.reversed ? flip(lines) : lines };
    }
    case "DEPOSIT": {
      if (e.amount <= 0n) return null;
      if (e.entry === "RECEIVED") return { ...base, source: "Deposit received", lines: [dr("BANK", e.amount), cr("DEPOSITS_HELD", e.amount)] };
      if (e.entry === "REFUND") return { ...base, source: "Deposit refunded", lines: [dr("DEPOSITS_HELD", e.amount), cr("BANK", e.amount)] };
      return { ...base, source: "Deposit deduction", lines: [dr("DEPOSITS_HELD", e.amount), cr(e.owned ? "OTHER_INCOME" : "OWNER_RENT", e.amount)] };
    }
    case "SERVICE_ASSESSMENT":
      return e.amount <= 0n ? null : { ...base, source: "Service charge billed", lines: [dr("SERVICE_RECEIVABLE", e.amount), cr("SERVICE_FUND", e.amount)] };
    case "SERVICE_COLLECTION": {
      if (e.amount <= 0n) return null;
      const lines = [dr("BANK", e.amount), cr("SERVICE_RECEIVABLE", e.amount)];
      return { ...base, source: e.reversed ? "Service charge receipt reversed" : "Service charge received", lines: e.reversed ? flip(lines) : lines };
    }
    case "SERVICE_EXPENSE":
      return e.amount <= 0n ? null : { ...base, source: "Service charge spending", lines: [dr("SERVICE_FUND", e.amount), cr("PAYABLES", e.amount)] };
  }
}

export function balanced(e: Entry): boolean {
  const d = e.lines.reduce((s, l) => s + l.debit, 0n), c = e.lines.reduce((s, l) => s + l.credit, 0n);
  return d === c && d > 0n;
}

/** Entries in date order, numbered, with the movement on each account for the period. */
export function buildJournal(events: AccountingEvent[], prefix = "HSY") {
  const entries = events.map(entryFor).filter((e): e is Entry => !!e).sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.ref.localeCompare(b.ref));
  const numbered = entries.map((e, i) => ({ ...e, no: `${prefix}-${String(i + 1).padStart(5, "0")}` }));
  const totals = new Map<AccountKey, { debit: bigint; credit: bigint }>();
  for (const e of numbered) for (const l of e.lines) {
    const t = totals.get(l.account) ?? { debit: 0n, credit: 0n };
    t.debit += l.debit; t.credit += l.credit; totals.set(l.account, t);
  }
  const unbalanced = numbered.filter((e) => !balanced(e)).map((e) => e.no);
  return { entries: numbered, totals, unbalanced };
}

const plain = (k: bigint) => { const neg = k < 0n; const a = neg ? -k : k; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };

/** The rows of the export, in either layout. */
export function journalRows(j: ReturnType<typeof buildJournal>, codes: AccountCodes, layout: "debit-credit" | "signed") {
  const code = (k: AccountKey) => codes[k] || ACCOUNTS[k].code;
  const header = layout === "signed"
    ? ["Date", "Journal", "Account code", "Account", "Amount", "Description", "Reference", "Property"]
    : ["Date", "Journal", "Account code", "Account", "Debit", "Credit", "Description", "Reference", "Property"];
  const rows = j.entries.flatMap((e) => e.lines.map((l) => {
    const desc = `${e.source}${e.memo ? `: ${e.memo}` : ""}`;
    return layout === "signed"
      ? [e.date, e.no, code(l.account), ACCOUNTS[l.account].name, plain(l.debit - l.credit), desc, e.ref, e.property]
      : [e.date, e.no, code(l.account), ACCOUNTS[l.account].name, l.debit ? plain(l.debit) : "", l.credit ? plain(l.credit) : "", desc, e.ref, e.property];
  }));
  return { header, rows };
}
