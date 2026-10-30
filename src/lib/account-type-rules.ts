/**
 * The three ways in: a personal account (people looking for property), an agent, or a company. Each signs up with what that
 * kind of account needs, and signs in on its own tab so it lands in the right place. Pure, tested on its own.
 */
export const ACCOUNT_TYPES = ["personal", "agent", "company"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const accountTypeOf = (v: unknown): AccountType => (ACCOUNT_TYPES as readonly string[]).includes(String(v)) ? (v as AccountType) : "personal";

export const BUSINESS_TYPES = {
  AGENCY: "Estate agency or brokerage",
  PROPERTY_MANAGER: "Property and letting management",
  DEVELOPER: "Property developer",
  FACILITY: "Facility management",
  INSTITUTION: "Institution or estate owner (bank, school, church, government)",
} as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;
/** A one-person workspace made for an agent who works for themselves. */
export const INDEPENDENT_AGENT = "INDEPENDENT_AGENT";

/** The industry set-up each business type starts with (src/lib/industry-templates.ts). */
export const TEMPLATE_FOR: Record<BusinessType, string> = { AGENCY: "BROKERAGE", PROPERTY_MANAGER: "LETTING", DEVELOPER: "DEVELOPER", FACILITY: "FACILITY", INSTITUTION: "INSTITUTION" };

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "mail.com", "gmx.com", "protonmail.com", "proton.me", "zoho.com", "yandex.com",
]);
/** A personal mailbox rather than one on the company's own domain. */
export function isFreeMail(email: string): boolean {
  const d = email.trim().toLowerCase().split("@")[1] ?? "";
  return FREE_MAIL.has(d);
}

/** A Nigerian phone number in a form we can store: 0803 123 4567, +234 803 123 4567 or 234803... become +2348031234567. */
export function normalisePhone(raw: string): string | null {
  const d = raw.replace(/[\s().-]/g, "");
  const m = /^(?:\+?234|0)([789][01]\d{8})$/.exec(d);
  if (m) return `+234${m[1]}`;
  return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
}

/** A CAC registration number as people write it: RC 1234567, BN 1234567, IT 12345 (optional at sign-up, checked in verification). */
export function cleanCac(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return "";
  const m = /^(RC|BN|IT|LP|LLP)\s?(\d{3,8})$/.exec(t.replace(/^(RC|BN|IT|LLP|LP)[\s.:-]*/, (x) => x.replace(/[\s.:-]+/g, "")).replace(/^(RC|BN|IT|LLP|LP)(\d)/, "$1 $2"));
  return m ? `${m[1]} ${m[2]}` : null;
}

export type MembershipLite = { role: string; businessType: string };

/** Which tab a set of memberships may sign in on. Personal is always open: every account has its own personal side. */
export function signInRefusal(as: AccountType, memberships: MembershipLite[]): string | null {
  const agent = memberships.some((m) => m.role === "AGENT" || m.businessType === INDEPENDENT_AGENT);
  const company = memberships.some((m) => m.role !== "AGENT" && m.businessType !== INDEPENDENT_AGENT);
  if (as === "agent" && !agent) return company ? "This email belongs to a company account. Choose Company above to sign in." : "This email has no agent account. Choose Personal above, or create an agent account.";
  if (as === "company" && !company) return agent ? "This email belongs to an agent account. Choose Agent above to sign in." : "This email has no company account. Choose Personal above, or register your company.";
  return null;
}

/** Where each kind of account lands after signing in. */
export function landingFor(as: AccountType, isPlatformAdmin: boolean): string {
  if (as === "personal") return isPlatformAdmin ? "/admin" : "/me";
  return "/app";
}
