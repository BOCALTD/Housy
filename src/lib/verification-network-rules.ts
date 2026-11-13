/**
 * The verification network: independent, vetted provider organisations doing property verification through Housy.
 * Pure rules (no database) so they can be tested on their own: service categories, application steps and checks,
 * which status may follow which, references, provider roles and what each role may do.
 *
 * Housy is the platform and overseer; providers are independent professional firms. No provider (BOCA included) has any
 * rule here that the others do not.
 */
import { z } from "zod";

// ---------- Service categories (configurable in the database; these are the starting set) ----------

export type ServiceCategorySeed = { code: string; name: string; summary: string; requiredDocuments: string[]; qualifications: string; evidence: string; finding: "DOCUMENTARY" | "REGISTRY" | "PHYSICAL" | "OPINION" | "MIXED" };

/**
 * What each kind of finding is, so a report never presents a document check or a database search as proof of ownership.
 */
export const FINDING_KINDS = {
  DOCUMENTARY: "Documents examined: what the papers say, not proof that they are genuine or current.",
  REGISTRY: "Registry search: what the official register showed on the date searched.",
  PHYSICAL: "Physical observation: what was seen on site on the date of inspection.",
  OPINION: "Professional opinion: a qualified professional's judgement on the evidence.",
  MIXED: "Several kinds of finding: each is labelled in the report.",
} as const;

export const SERVICE_CATEGORIES: ServiceCategorySeed[] = [
  { code: "TITLE", name: "Ownership and title investigation", summary: "Who holds title, by what instrument, and whether the chain of title is complete.", requiredDocuments: ["Title document (C of O, deed, governor's consent or similar)", "Seller's identification"], qualifications: "Legal practitioner or title investigation professional", evidence: "Copies of instruments examined; search reports", finding: "MIXED" },
  { code: "REGISTRY_SEARCH", name: "Land registry search", summary: "An official search of the land registry for the property.", requiredDocuments: ["Title document or registry particulars"], qualifications: "Authorised to conduct registry searches in the state", evidence: "Official search report or receipt", finding: "REGISTRY" },
  { code: "ENCUMBRANCE", name: "Encumbrances and existing interests", summary: "Mortgages, charges, caveats, leases and other interests registered against the property.", requiredDocuments: ["Registry particulars"], qualifications: "Legal practitioner or title investigation professional", evidence: "Registry search report", finding: "REGISTRY" },
  { code: "SURVEY_PLAN", name: "Survey plan examination", summary: "Whether the survey plan is registered, consistent and matches the land offered.", requiredDocuments: ["Survey plan"], qualifications: "Registered surveyor (SURCON)", evidence: "Survey plan copy; charting result from the surveyor-general", finding: "MIXED" },
  { code: "BOUNDARY", name: "Boundary and location verification", summary: "Whether the beacons and boundaries on the ground match the survey plan.", requiredDocuments: ["Survey plan"], qualifications: "Registered surveyor (SURCON)", evidence: "Beacon photographs with coordinates; field notes", finding: "PHYSICAL" },
  { code: "SITE_INSPECTION", name: "Physical site inspection", summary: "A visit to the property: access, occupation, condition and surroundings.", requiredDocuments: [], qualifications: "Trained field investigator", evidence: "Dated photographs with location; inspection checklist", finding: "PHYSICAL" },
  { code: "STRUCTURAL", name: "Building and structural condition", summary: "The condition of the building and any visible structural concerns.", requiredDocuments: ["Building plans, if available"], qualifications: "Registered engineer (COREN) or builder", evidence: "Photographs; condition schedule", finding: "OPINION" },
  { code: "PLANNING", name: "Planning permission and approvals", summary: "Whether the building or development has the required approvals.", requiredDocuments: ["Approved building plan, if claimed"], qualifications: "Town planner (TOPREC) or authorised professional", evidence: "Approval copies; enquiry results from the planning authority", finding: "MIXED" },
  { code: "LITIGATION", name: "Litigation and dispute checks", summary: "Court cases, disputes or claims involving the property or its owner.", requiredDocuments: ["Owner's full name"], qualifications: "Legal practitioner", evidence: "Court registry search results", finding: "REGISTRY" },
  { code: "ZONING", name: "Land use and zoning", summary: "What the land may be used for under the applicable master plan or zoning.", requiredDocuments: [], qualifications: "Town planner (TOPREC)", evidence: "Zoning information from the planning authority", finding: "MIXED" },
  { code: "VALUATION", name: "Property valuation", summary: "A formal valuation of the property.", requiredDocuments: ["Title document", "Building plans, if available"], qualifications: "Estate surveyor and valuer (ESVARBON)", evidence: "Valuation report with comparables", finding: "OPINION" },
  { code: "MARKET_PRICE", name: "Market price assessment", summary: "Whether the asking price is in line with the local market.", requiredDocuments: [], qualifications: "Estate surveyor and valuer, or market analyst", evidence: "Comparable sales and listings", finding: "OPINION" },
  { code: "OWNERSHIP_HISTORY", name: "Ownership history", summary: "Past owners and transfers, as far as records allow.", requiredDocuments: ["Title documents in the chain"], qualifications: "Legal practitioner or title investigation professional", evidence: "Instruments and search reports", finding: "MIXED" },
  { code: "SELLER_DUE_DILIGENCE", name: "Developer and seller due diligence", summary: "Whether the seller or developer is who they say they are and is in good standing.", requiredDocuments: ["Seller's or developer's identification and registration"], qualifications: "Due diligence professional", evidence: "Registration searches; identity checks", finding: "MIXED" },
  { code: "ENVIRONMENTAL", name: "Environmental and location risk", summary: "Flooding, erosion, setbacks, right-of-way and similar location risks.", requiredDocuments: [], qualifications: "Qualified environmental or planning professional", evidence: "Site photographs; authority records; maps", finding: "MIXED" },
  { code: "GENERAL", name: "General property due diligence", summary: "A combined first look across title, site and seller, with recommendations for deeper checks.", requiredDocuments: ["Any documents the seller has provided"], qualifications: "Due diligence professional", evidence: "As each part requires", finding: "MIXED" },
];
export const SERVICE_CODES = SERVICE_CATEGORIES.map((s) => s.code);

/** Organisations that may apply. Not tied to any name: what matters is what they are and what they can show. */
export const ORG_TYPES = [
  ["CONSULTANCY", "Real estate consultancy or advisory firm"],
  ["DUE_DILIGENCE", "Property verification or due diligence company"],
  ["ESTATE_SURVEYING", "Estate surveying and valuation firm"],
  ["SURVEYING", "Licensed surveying organisation"],
  ["LEGAL", "Property legal practice or legal advisory firm"],
  ["TITLE_DOCUMENTATION", "Title investigation and documentation service"],
  ["RISK", "Property risk assessment or management firm"],
  ["OTHER", "Other qualified professional organisation"],
] as const;
export const ORG_TYPE_CODES = ORG_TYPES.map((o) => o[0]);

export const REGISTRATION_TYPES = ["PRIVATE_LIMITED", "PUBLIC_LIMITED", "BUSINESS_NAME", "PARTNERSHIP", "INCORPORATED_TRUSTEES", "FOREIGN_COMPANY", "OTHER"] as const;
export const PROPERTY_TYPES = ["LAND", "RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "MIXED_USE", "AGRICULTURAL", "UNDEVELOPED_PLOT", "INVESTMENT"] as const;

export const DOC_KINDS = [
  ["CAC", "CAC registration documents"],
  ["CERTIFICATE", "Professional certificate"],
  ["LICENCE", "Licence or registration"],
  ["PROFILE", "Company profile"],
  ["TAX", "Tax or compliance document"],
  ["IDENTITY", "Identity or authorisation document"],
  ["WORK_SAMPLE", "Work sample or reference"],
  ["OTHER", "Other document"],
] as const;
export type DocKind = (typeof DOC_KINDS)[number][0];

// ---------- Application ----------

export const APPLICATION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED", "RESUBMITTED", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Which status may follow which, and who may make the move. Anything not listed is refused. */
const APPLICATION_MOVES: Record<ApplicationStatus, Partial<Record<ApplicationStatus, "applicant" | "admin">>> = {
  DRAFT: { SUBMITTED: "applicant", WITHDRAWN: "applicant" },
  SUBMITTED: { UNDER_REVIEW: "admin", WITHDRAWN: "applicant" },
  UNDER_REVIEW: { ADDITIONAL_INFORMATION_REQUIRED: "admin", APPROVED: "admin", REJECTED: "admin", WITHDRAWN: "applicant" },
  ADDITIONAL_INFORMATION_REQUIRED: { RESUBMITTED: "applicant", WITHDRAWN: "applicant", REJECTED: "admin" },
  RESUBMITTED: { UNDER_REVIEW: "admin", WITHDRAWN: "applicant" },
  APPROVED: {},
  REJECTED: {},
  WITHDRAWN: {},
};
export function canMoveApplication(from: ApplicationStatus, to: ApplicationStatus, by: "applicant" | "admin"): boolean {
  return APPLICATION_MOVES[from]?.[to] === by;
}
/** The applicant may change the answers only while it is a draft or Housy has asked for more. */
export const applicantMayEdit = (s: ApplicationStatus) => s === "DRAFT" || s === "ADDITIONAL_INFORMATION_REQUIRED";

export const APPLICATION_STATUS_WORDS: Record<ApplicationStatus, string> = {
  DRAFT: "Draft: not sent yet",
  SUBMITTED: "Sent: waiting for review",
  UNDER_REVIEW: "Being reviewed by Housy",
  ADDITIONAL_INFORMATION_REQUIRED: "Housy needs more information",
  RESUBMITTED: "Sent again: waiting for review",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn",
};

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const applicationRef = (year: number, n: number) => `VPA-${year}-${pad(n, 6)}`;
export const providerCode = (n: number) => `HVP-${pad(n, 6)}`;
export const isApplicationRef = (s: string) => /^VPA-\d{4}-\d{6}$/.test(s);
export const isProviderCode = (s: string) => /^HVP-\d{6}$/.test(s);

// The application's answers, in five parts. Each part is saved on its own; all are checked again before sending.
const text = (max: number) => z.string().trim().max(max);
const req = (label: string, max = 300) => z.string().trim().min(2, `Enter ${label}`).max(max);
const year = z.coerce.number().int().min(1900, "Enter the year of incorporation").max(new Date().getFullYear(), "The year of incorporation cannot be in the future");
const optUrl = z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter the website as a full address, like https://example.com");
const emailField = z.string().trim().toLowerCase().max(200).email("Enter a valid email address");
const phoneField = z.string().trim().min(7, "Enter a telephone number").max(30).regex(/^[+0-9 ()-]+$/, "Enter the telephone number using digits only");
const dateOrEmpty = z.string().trim().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter dates as YYYY-MM-DD");

export const corporateSchema = z.object({
  registeredName: req("the registered company name", 200),
  tradingName: text(200).default(""),
  orgType: z.enum(ORG_TYPE_CODES as [string, ...string[]], { message: "Choose what kind of organisation this is" }),
  cacNumber: z.string().trim().toUpperCase().min(4, "Enter the CAC registration number").max(30).regex(/^[A-Z0-9 /-]+$/, "Enter the CAC number as shown on the certificate, like RC 1234567"),
  registrationType: z.enum(REGISTRATION_TYPES, { message: "Choose the registration type" }),
  yearIncorporated: year,
  country: req("the country of registration", 80),
  registeredAddress: req("the registered office address", 400),
  operationalAddresses: text(1200).default(""),
  officialEmail: emailField,
  officialPhone: phoneField,
  website: optUrl.default(""),
  profile: z.string().trim().min(40, "Describe the company in at least a few sentences (40 characters or more)").max(3000),
});
const person = z.object({ name: text(120), position: text(120) });
export const ownershipSchema = z.object({
  contactName: req("the principal contact person's name", 120),
  contactPosition: req("the contact person's position", 120),
  repName: req("the authorised representative's name", 120),
  repPosition: req("the authorised representative's position", 120),
  repEmail: emailField,
  repPhone: phoneField,
  directors: z.array(person).max(20).default([]).transform((a) => a.filter((d) => d.name)),
  ownershipNote: text(1500).default(""),
});
const licence = z.object({ body: text(160), number: text(80), expires: dateOrEmpty.default("") });
const professional = z.object({ name: text(120), qualification: text(200), licenceNumber: text(80), expires: dateOrEmpty.default("") });
export const qualificationsSchema = z.object({
  services: z.array(z.enum(SERVICE_CODES as [string, ...string[]])).min(1, "Choose at least one service you offer").max(SERVICE_CODES.length),
  memberships: text(1500).default(""),
  licences: z.array(licence).max(20).default([]).transform((a) => a.filter((l) => l.body || l.number)),
  accreditation: text(1500).default(""),
  certifications: text(1500).default(""),
  professionals: z.array(professional).max(30).default([]).transform((a) => a.filter((p) => p.name)),
}).refine((q) => q.professionals.length > 0, { message: "Name at least one responsible professional and their qualification", path: ["professionals"] });
export const operationsSchema = z.object({
  states: z.array(z.string().trim().min(2).max(60)).min(1, "Choose at least one state you cover").max(60),
  locationsNote: text(1000).default(""),
  propertyTypes: z.array(z.enum(PROPERTY_TYPES)).min(1, "Choose at least one type of property you investigate"),
  fieldInvestigators: z.coerce.number().int().min(0).max(100000),
  professionalStaff: z.coerce.number().int().min(1, "Enter how many professional staff you have").max(100000),
  monthlyCapacity: z.coerce.number().int().min(1, "Enter how many assignments you can take in a month").max(100000),
  previousProjects: z.string().trim().min(20, "Describe some previous relevant work (20 characters or more)").max(3000),
  references: text(2000).default(""),
  resources: text(2000).default(""),
});
export const APPLICATION_PARTS = [
  { key: "corporate", title: "Company", schema: corporateSchema },
  { key: "ownership", title: "Ownership and contacts", schema: ownershipSchema },
  { key: "qualifications", title: "Professional qualifications", schema: qualificationsSchema },
  { key: "operations", title: "Operations and coverage", schema: operationsSchema },
] as const;
export type PartKey = (typeof APPLICATION_PARTS)[number]["key"];
export type ApplicationAnswers = Partial<{ corporate: z.infer<typeof corporateSchema>; ownership: z.infer<typeof ownershipSchema>; qualifications: z.infer<typeof qualificationsSchema>; operations: z.infer<typeof operationsSchema> }>;

/** Documents every applicant must send; the rest depend on what they offer. */
export const REQUIRED_DOCS: DocKind[] = ["CAC", "PROFILE", "IDENTITY"];

/** Everything still missing before the application can be sent, in plain words. Empty when it is ready. */
export function missingForSubmit(answers: ApplicationAnswers, docKinds: string[]): string[] {
  const out: string[] = [];
  for (const part of APPLICATION_PARTS) {
    if (!answers[part.key]) { out.push(`${part.title}: not filled in yet`); continue; }
    const r = part.schema.safeParse(answers[part.key]);
    if (!r.success) out.push(`${part.title}: ${r.error.issues[0]?.message ?? "incomplete"}`);
  }
  for (const k of REQUIRED_DOCS) if (!docKinds.includes(k)) out.push(`Documents: add ${DOC_KINDS.find((d) => d[0] === k)![1].replace(/^Company profile$/, "the company profile").replace(/^Identity/, "an identity").replace(/^CAC/, "the CAC")}`);
  const services = answers.qualifications?.services ?? [];
  const needsLicence = services.some((s) => ["SURVEY_PLAN", "BOUNDARY", "VALUATION", "LITIGATION", "TITLE"].includes(s));
  if (needsLicence && !docKinds.includes("LICENCE") && !docKinds.includes("CERTIFICATE")) out.push("Documents: the services you chose need a professional licence or certificate");
  return out;
}

// ---------- Provider roles and permissions ----------

export const VP_ROLES = ["OWNER", "ADMIN", "MANAGER", "INVESTIGATOR", "REVIEWER", "FINANCE"] as const;
export type VpRole = (typeof VP_ROLES)[number];
export const VP_ROLE_LABELS: Record<VpRole, string> = {
  OWNER: "Organisation owner",
  ADMIN: "Organisation administrator",
  MANAGER: "Verification manager",
  INVESTIGATOR: "Field investigator",
  REVIEWER: "Professional reviewer",
  FINANCE: "Finance officer",
};
export const VP_ROLE_SUMMARY: Record<VpRole, string> = {
  OWNER: "Everything: the profile, staff (administrators included), money and performance.",
  ADMIN: "Day-to-day running: assignments, officers, documents and staff other than owners and administrators.",
  MANAGER: "Coordinates cases: allocates investigations, follows progress and deadlines.",
  INVESTIGATOR: "Works on the cases given to them: field photographs, findings and field reports.",
  REVIEWER: "Reviews findings, asks for corrections, approves reports for submission.",
  FINANCE: "Sees the organisation's earnings and payouts, and keeps the bank account payouts go to.",
};

export type VpAction =
  | "org.view" | "org.profile" | "org.services" | "org.documents"
  | "staff.view" | "staff.manage" | "staff.manage.senior"
  | "case.view.all" | "case.view.assigned" | "case.accept" | "case.assign" | "case.work" | "case.review" | "case.submit"
  | "finance.view" | "finance.manage" | "performance.view";

const ALL: VpAction[] = ["org.view", "org.profile", "org.services", "org.documents", "staff.view", "staff.manage", "staff.manage.senior", "case.view.all", "case.view.assigned", "case.accept", "case.assign", "case.work", "case.review", "case.submit", "finance.view", "finance.manage", "performance.view"];
const PERMS: Record<VpRole, VpAction[]> = {
  OWNER: ALL,
  ADMIN: ["org.view", "org.services", "org.documents", "staff.view", "staff.manage", "case.view.all", "case.view.assigned", "case.accept", "case.assign", "case.work", "case.submit", "performance.view"],
  MANAGER: ["org.view", "staff.view", "case.view.all", "case.view.assigned", "case.accept", "case.assign", "performance.view"],
  INVESTIGATOR: ["org.view", "case.view.assigned", "case.work"],
  REVIEWER: ["org.view", "case.view.all", "case.view.assigned", "case.review", "case.submit"],
  FINANCE: ["org.view", "finance.view", "finance.manage"],
};
export function vpCan(role: VpRole, action: VpAction): boolean {
  return PERMS[role]?.includes(action) ?? false;
}
/** Owners and administrators can only be added, changed or removed by an owner. */
export const SENIOR_ROLES: VpRole[] = ["OWNER", "ADMIN"];
export function mayManageRole(actor: VpRole, target: VpRole): boolean {
  if (!vpCan(actor, "staff.manage")) return false;
  return SENIOR_ROLES.includes(target) ? vpCan(actor, "staff.manage.senior") : true;
}
