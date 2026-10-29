/**
 * Automatic identity and business checks: which checks can be confirmed against an official record, and how a record is
 * compared with what the person typed. Anything that cannot be confirmed automatically goes to a person on the verification team.
 * Pure functions, tested on their own.
 */

/** The official records a provider can be asked about. */
export type Lookup = "NIN" | "PVC" | "DRIVERS_LICENCE" | "CAC" | "TIN";

export const LOOKUP_LABEL: Record<Lookup, string> = {
  NIN: "NIN record (NIMC)",
  PVC: "voter's card record (INEC)",
  DRIVERS_LICENCE: "driver's licence record (FRSC)",
  CAC: "company register (CAC)",
  TIN: "tax register (FIRS)",
};

/** The outcome of an automatic attempt, kept with the check for the reviewer. */
export const AUTO_OUTCOMES = ["NONE", "MATCH", "NO_MATCH", "NOT_FOUND", "UNAVAILABLE", "NOT_SUPPORTED", "NO_CONSENT"] as const;
export type AutoOutcome = (typeof AUTO_OUTCOMES)[number];

export const AUTO_OUTCOME_LABEL: Record<AutoOutcome, string> = {
  NONE: "Not tried",
  MATCH: "Confirmed automatically",
  NO_MATCH: "Details did not match the official record",
  NOT_FOUND: "No official record found",
  UNAVAILABLE: "Automatic check was unavailable",
  NOT_SUPPORTED: "Cannot be checked automatically",
  NO_CONSENT: "Person did not ask for an automatic check",
};

/** Which record a check is compared with, from its code and what was entered. Null: only a person can check it. */
export function lookupFor(code: string, fields: Record<string, string>): Lookup | null {
  if (code === "DIRECTOR_ID" || code === "AGENT_ID") {
    return ({ NIN: "NIN", VOTERS_CARD: "PVC", DRIVERS_LICENCE: "DRIVERS_LICENCE" } as Record<string, Lookup>)[fields.idType ?? ""] ?? null;
  }
  if (code === "CAC_REGISTRATION") return "CAC";
  if (code === "TAX_ID") return "TIN";
  return null;
}

/** Checks that can ever be automatic (for the consent box on the form). */
export const AUTO_CODES = ["DIRECTOR_ID", "AGENT_ID", "CAC_REGISTRATION", "TAX_ID"];

/** The name typed for an ID check. */
export const nameFieldOf = (code: string) => (code === "DIRECTOR_ID" ? "directorName" : code === "AGENT_ID" ? "fullName" : "legalName");

const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "PROF", "CHIEF", "ENGR", "ALHAJI", "ALHAJA", "PASTOR", "BARR", "ARC", "HON", "SIR", "LADY", "PRINCE", "PRINCESS", "OTUNBA", "COMRADE", "REV"]);

/** A person's name as comparable words: capitals, letters only, titles dropped. */
export function nameWords(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 1 && !TITLES.has(w));
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Same word, allowing one slip in longer names (OLUWASEUN / OLUWASEYUN), never in short ones. */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

/**
 * Whether a typed name is the person on the record. The surname must be there and at least one other name (first or middle),
 * in any order, so "Obi Ada" matches ADA GRACE OBI but "Ada Okafor" does not.
 */
export function namesMatch(typed: string, record: { first?: string | null; middle?: string | null; last?: string | null }): { match: boolean; detail: string } {
  const t = nameWords(typed);
  const last = nameWords(record.last ?? "");
  const others = [...nameWords(record.first ?? ""), ...nameWords(record.middle ?? "")];
  if (!t.length || !last.length) return { match: false, detail: "the record has no usable name" };
  const has = (w: string) => t.some((x) => sameWord(x, w));
  const surname = last.every(has);
  const given = others.filter(has).length;
  const extra = t.filter((x) => ![...last, ...others].some((w) => sameWord(x, w))).length;
  const match = surname && given >= 1 && extra <= 1;
  return { match, detail: match ? `name matches the record (${given + last.length} of ${others.length + last.length} names)` : !surname ? "surname differs from the record" : given === 0 ? "first names differ from the record" : "the name has extra names not on the record" };
}

const COMPANY_NOISE = new Set(["LIMITED", "LTD", "PLC", "NIGERIA", "NIG", "COMPANY", "CO", "THE", "AND", "INCORPORATED", "INC", "LLP", "LP", "ENTERPRISE", "ENTERPRISES", "VENTURE", "VENTURES"]);
export function companyWords(s: string): string[] {
  return s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !COMPANY_NOISE.has(w));
}
/** Whether a typed company name is the registered one, ignoring "Limited", "Nig.", punctuation and order. */
export function companiesMatch(typed: string, registered: string): boolean {
  const a = new Set(companyWords(typed)), b = new Set(companyWords(registered));
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.max(a.size, b.size) >= 0.8;
}

/** CAC numbers are typed many ways ("RC 1234567", "rc-1234567", "BN1234567"); providers want the digits and the register. */
export function cacNumber(raw: string): { number: string; type: "COMPANY" | "BUSINESS_NAME" | "INCORPORATED_TRUSTEES" | "LIMITED_PARTNERSHIP" | "LIMITED_LIABILITY_PARTNERSHIP" } | null {
  const s = raw.toUpperCase().replace(/[\s.-]/g, "");
  const m = /^(RC|BN|IT|LLP|LP)?(\d{3,9})$/.exec(s);
  if (!m) return null;
  const type = ({ BN: "BUSINESS_NAME", IT: "INCORPORATED_TRUSTEES", LP: "LIMITED_PARTNERSHIP", LLP: "LIMITED_LIABILITY_PARTNERSHIP" } as const)[m[1] as "BN" | "IT" | "LP" | "LLP"] ?? "COMPANY";
  return { number: m[2], type };
}

export const digitsOf = (s: string) => s.replace(/\D/g, "");

/** A name shown to a reviewer when it did not match: enough to see the difference, not the whole record. */
export function maskName(s: string): string {
  return nameWords(s).map((w) => `${w[0]}${"*".repeat(Math.max(1, w.length - 2))}${w.length > 2 ? w[w.length - 1] : ""}`).join(" ");
}
