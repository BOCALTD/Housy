/**
 * Know-your-customer checks for companies and agents, and the trust level they add up to.
 * The vocabulary follows the master prompt (Section 8.1): Not Submitted → Submitted → Under Review → Verified, Rejected or
 * Needs More Information → Expired or Revoked. A check counts towards trust only while it is Verified and not expired.
 * Pure functions, tested on their own.
 */

export type KycKind = "COMPANY" | "AGENT";
export const KYC_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED", "NEEDS_INFO", "EXPIRED", "REVOKED"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export type FieldDef = { key: string; label: string; hint?: string; kind: "text" | "select" | "secret" | "date"; options?: [string, string][]; required: boolean; max: number };
export type Requirement = {
  code: string; kind: KycKind; title: string; why: string; weight: number; core: boolean;
  fields: FieldDef[]; document: { label: string; required: boolean } | null;
  /** What a reviewer confirms, shown next to the badge once verified ("CAC registration checked on 4 Oct 2026"). */
  scope: string; months: number;
};

export const ID_TYPES: [string, string][] = [["NIN", "National Identification Number (NIN)"], ["PASSPORT", "International passport"], ["DRIVERS_LICENCE", "Driver's licence"], ["VOTERS_CARD", "Permanent voter's card"]];

export const REQUIREMENTS: Requirement[] = [
  // ----- Companies -----
  { code: "CAC_REGISTRATION", kind: "COMPANY", title: "Company registration (CAC)", why: "Shows the company legally exists.", weight: 30, core: true, months: 24,
    fields: [
      { key: "legalName", label: "Registered company name", kind: "text", required: true, max: 160 },
      { key: "rcNumber", label: "RC or BN number", hint: "For example RC 1234567 or BN 1234567", kind: "text", required: true, max: 20 },
      { key: "incorporatedOn", label: "Date of registration", kind: "date", required: false, max: 10 },
    ],
    document: { label: "Certificate of incorporation or registration (PDF or photo)", required: true }, scope: "CAC registration checked" },
  { code: "DIRECTOR_ID", kind: "COMPANY", title: "Director's government ID", why: "Shows a real, named person is responsible for the company.", weight: 25, core: true, months: 24,
    fields: [
      { key: "directorName", label: "Director's full name", kind: "text", required: true, max: 120 },
      { key: "idType", label: "Type of ID", kind: "select", options: ID_TYPES, required: true, max: 20 },
      { key: "idNumber", label: "ID number", hint: "Stored encrypted. Only the verification team can read it.", kind: "secret", required: true, max: 30 },
    ],
    document: { label: "Clear photo or scan of the ID", required: true }, scope: "Director's identity checked" },
  { code: "OFFICE_ADDRESS", kind: "COMPANY", title: "Office address", why: "Shows where the company can be found.", weight: 15, core: false, months: 12,
    fields: [
      { key: "address", label: "Office address", kind: "text", required: true, max: 300 },
      { key: "city", label: "City", kind: "text", required: true, max: 80 },
      { key: "state", label: "State", kind: "text", required: true, max: 80 },
    ],
    document: { label: "Proof of address (utility bill, tenancy agreement or bank statement, last 3 months)", required: true }, scope: "Office address checked" },
  { code: "COMPANY_CONTACT", kind: "COMPANY", title: "Company phone and email", why: "Lets people reach the company. Our team calls the number to confirm it.", weight: 10, core: false, months: 12,
    fields: [
      { key: "phone", label: "Company phone", hint: "For example 0803 123 4567 or +234 803 123 4567", kind: "text", required: true, max: 20 },
      { key: "email", label: "Company email", kind: "text", required: true, max: 160 },
      { key: "website", label: "Website", kind: "text", required: false, max: 200 },
    ],
    document: null, scope: "Company phone and email confirmed" },
  { code: "TAX_ID", kind: "COMPANY", title: "Tax identification number (TIN)", why: "Shows the company is registered for tax.", weight: 10, core: false, months: 24,
    fields: [{ key: "tin", label: "TIN", kind: "text", required: true, max: 20 }],
    document: { label: "TIN certificate or tax clearance (optional)", required: false }, scope: "Tax registration checked" },
  { code: "PROFESSIONAL_BODY", kind: "COMPANY", title: "Professional membership", why: "Membership of a body such as REDAN, NIESV or ESVARBON.", weight: 10, core: false, months: 12,
    fields: [
      { key: "body", label: "Professional body", kind: "text", required: true, max: 120 },
      { key: "membershipNo", label: "Membership number", kind: "text", required: true, max: 40 },
    ],
    document: { label: "Membership certificate", required: true }, scope: "Professional membership checked" },

  // ----- Agents -----
  { code: "AGENT_ID", kind: "AGENT", title: "Government ID", why: "Shows you are who you say you are.", weight: 35, core: true, months: 24,
    fields: [
      { key: "fullName", label: "Full name as on the ID", kind: "text", required: true, max: 120 },
      { key: "idType", label: "Type of ID", kind: "select", options: ID_TYPES, required: true, max: 20 },
      { key: "idNumber", label: "ID number", hint: "Stored encrypted. Only the verification team can read it.", kind: "secret", required: true, max: 30 },
    ],
    document: { label: "Clear photo or scan of the ID", required: true }, scope: "Identity checked" },
  { code: "AGENT_PHOTO", kind: "AGENT", title: "Your photo", why: "Lets clients recognise you at an inspection. Our team compares it with your ID.", weight: 15, core: false, months: 24,
    fields: [], document: { label: "A clear, recent photo of your face (no filters)", required: true }, scope: "Photo matched to ID" },
  { code: "AGENT_PHONE", kind: "AGENT", title: "Phone number", why: "Our team calls the number to confirm it is yours.", weight: 15, core: false, months: 12,
    fields: [{ key: "phone", label: "Phone number", hint: "For example 0803 123 4567", kind: "text", required: true, max: 20 }],
    document: null, scope: "Phone number confirmed" },
  { code: "AGENT_ADDRESS", kind: "AGENT", title: "Address", why: "Shows where you can be found.", weight: 15, core: false, months: 12,
    fields: [
      { key: "address", label: "Address", kind: "text", required: true, max: 300 },
      { key: "city", label: "City", kind: "text", required: true, max: 80 },
      { key: "state", label: "State", kind: "text", required: true, max: 80 },
    ],
    document: { label: "Proof of address (utility bill or bank statement, last 3 months)", required: true }, scope: "Address checked" },
  { code: "AGENT_LICENCE", kind: "AGENT", title: "Professional licence or membership", why: "For example ESVARBON registration, NIESV or REDAN membership.", weight: 20, core: false, months: 12,
    fields: [
      { key: "body", label: "Licensing or professional body", kind: "text", required: true, max: 120 },
      { key: "licenceNo", label: "Licence or membership number", kind: "text", required: true, max: 40 },
    ],
    document: { label: "Licence or membership certificate", required: true }, scope: "Professional licence checked" },
];

export const requirementsFor = (kind: KycKind) => REQUIREMENTS.filter((r) => r.kind === kind);
export const requirement = (code: string) => REQUIREMENTS.find((r) => r.code === code) ?? null;
export const maxScore = (kind: KycKind) => requirementsFor(kind).reduce((n, r) => n + r.weight, 0);

export const LEVELS = [
  { level: 0, name: "Not verified", text: "No checks have passed yet." },
  { level: 1, name: "Basic checks", text: "Some checks have passed, but not the identity check." },
  { level: 2, name: "Verified", text: "Identity (and, for companies, registration) checked by our team." },
  { level: 3, name: "Highly trusted", text: "Identity checked plus most other checks, including address." },
] as const;

export type Check = { code: string; verifiedAt: Date; expiresAt: Date | null };

/** Checks that still count: verified and not past their expiry. */
export function liveChecks(checks: Check[], now = new Date()) {
  return checks.filter((c) => !c.expiresAt || c.expiresAt.getTime() > now.getTime());
}

/** The trust score is the sum of the weights of live checks; the level also needs the core checks, so a pile of small checks never makes an unidentified company "Verified". */
export function trustOf(kind: KycKind, checks: Check[], now = new Date()) {
  const live = liveChecks(checks, now).filter((c) => requirement(c.code)?.kind === kind);
  const codes = new Set(live.map((c) => c.code));
  const reqs = requirementsFor(kind);
  const score = reqs.filter((r) => codes.has(r.code)).reduce((n, r) => n + r.weight, 0);
  const max = maxScore(kind);
  const pct = Math.round((score / max) * 100);
  const coreDone = reqs.filter((r) => r.core).every((r) => codes.has(r.code));
  const addressDone = codes.has(kind === "COMPANY" ? "OFFICE_ADDRESS" : "AGENT_ADDRESS");
  let level: 0 | 1 | 2 | 3 = 0;
  if (score > 0) level = 1;
  if (coreDone && pct >= 50) level = 2;
  if (coreDone && addressDone && pct >= 80) level = 3;
  return { score, max, pct, level, levelName: LEVELS[level].name, passed: reqs.filter((r) => codes.has(r.code)).map((r) => r.code), total: reqs.length };
}

export function expiryFor(code: string, from: Date, months?: number) {
  const r = requirement(code);
  const m = months ?? r?.months ?? 12;
  const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + m);
  return d;
}

// ----- Checking what people type -----
const digits = (s: string) => s.replace(/\D/g, "");

export function checkIdNumber(type: string, raw: string): string | null {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  switch (type) {
    case "NIN": return /^\d{11}$/.test(v) ? null : "A NIN has 11 digits";
    case "PASSPORT": return /^[A-Z]\d{8}$/.test(v) ? null : "A Nigerian passport number is a letter followed by 8 digits";
    case "DRIVERS_LICENCE": return /^[A-Z0-9]{8,14}$/.test(v) ? null : "Enter the licence number as printed (8 to 14 letters and digits)";
    case "VOTERS_CARD": return /^[A-Z0-9]{16,20}$/.test(v) ? null : "A voter's card number has about 19 letters and digits";
    default: return "Choose the type of ID";
  }
}

export function checkRcNumber(raw: string): string | null {
  return /^(RC|BN|IT|LP|LLP)?\s?-?\d{4,8}$/i.test(raw.trim()) ? null : "Enter the RC or BN number, for example RC 1234567";
}

export function checkPhone(raw: string): string | null {
  const d = digits(raw);
  return /^(0[789][01]\d{8}|234[789][01]\d{8})$/.test(d) || /^\+?\d{10,15}$/.test(raw.replace(/[\s-]/g, "")) ? null : "Enter a phone number, for example 0803 123 4567";
}

export function checkEmail(raw: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim()) ? null : "Enter an email address";
}

export function checkTin(raw: string): string | null {
  return /^\d{8}-?\d{4}$|^\d{10,14}$/.test(raw.trim()) ? null : "Enter the TIN, for example 12345678-0001";
}

/** Only the last few characters of an ID number are ever shown, even to the person who typed it. */
export function maskId(raw: string) {
  const v = raw.replace(/\s+/g, "");
  return v.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, v.length - 3))}${v.slice(-3)}`;
}

/** Validate a submission's fields against the requirement. Returns errors, and the cleaned public and secret parts separately. */
export function checkSubmission(code: string, input: Record<string, string>) {
  const r = requirement(code);
  if (!r) return { errors: ["Unknown check"], values: {}, secret: null as string | null, masked: "" };
  const errors: string[] = [];
  const values: Record<string, string> = {};
  let secret: string | null = null, masked = "";
  for (const f of r.fields) {
    const v = (input[f.key] ?? "").trim();
    if (!v) { if (f.required) errors.push(`${f.label} is needed`); continue; }
    if (v.length > f.max) { errors.push(`${f.label} is too long`); continue; }
    if (f.kind === "select" && !f.options?.some(([k]) => k === v)) { errors.push(`Choose ${f.label.toLowerCase()}`); continue; }
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors.push(`${f.label} is not a date`); continue; }
    if (f.kind === "secret") { secret = v.replace(/\s+/g, "").toUpperCase(); masked = maskId(secret); continue; }
    values[f.key] = v;
  }
  if (secret && values.idType) { const e = checkIdNumber(values.idType, secret); if (e) errors.push(e); }
  if (values.rcNumber) { const e = checkRcNumber(values.rcNumber); if (e) errors.push(e); }
  if (values.phone) { const e = checkPhone(values.phone); if (e) errors.push(e); }
  if (values.email) { const e = checkEmail(values.email); if (e) errors.push(e); }
  if (values.tin) { const e = checkTin(values.tin); if (e) errors.push(e); }
  if (values.website && !/^https?:\/\/\S+\.\S+/.test(values.website)) errors.push("The website must start with https://");
  return { errors, values, secret, masked };
}

export const STATUS_LABEL: Record<KycStatus | "NOT_SUBMITTED", string> = {
  NOT_SUBMITTED: "Not submitted", SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", VERIFIED: "Verified", REJECTED: "Rejected",
  NEEDS_INFO: "Needs more information", EXPIRED: "Expired", REVOKED: "Revoked",
};
