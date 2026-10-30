/**
 * Industry templates: one-click starting set-ups for the kinds of organisation that use the workspace. Each suggests departments,
 * inspection checklists, recurring obligations, commission rules and reminder timings that suit that kind of business. Nothing is
 * applied without the administrator seeing it first: they untick what they do not want, enter every date and rate themselves,
 * and the platform never invents an amount, a rate or a deadline on their behalf. Applying again adds only what is missing.
 */

export type ChecklistItem = { category: string; prompt: string };
export type Template = {
  key: IndustryKey; name: string; who: string; summary: string;
  departments: { name: string; code: string }[];
  checklists: { name: string; assetClass: "RESIDENTIAL" | "COMMERCIAL" | "LAND" | "INDUSTRIAL" | "PLANT_MACHINERY" | "OTHER"; items: ChecklistItem[] }[];
  obligations: { id: string; kind: "LAND_USE_CHARGE" | "TENEMENT_RATE" | "GROUND_RENT" | "PERMIT" | "INSURANCE" | "WITHHOLDING_TAX" | "OTHER"; title: string; authority: string; months: number | null; review: boolean; why: string }[];
  commission: { id: string; name: string; applies: "ALL" | "SALE" | "RENT" | "LEASE"; usual: string }[];
  reminders: { leadDays: number; escalationDays: number };
  firstSteps: { label: string; href: string }[];
};

export const INDUSTRY_KEYS = ["LETTING", "BROKERAGE", "DEVELOPER", "FACILITY", "INSTITUTION"] as const;
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];

const I = (category: string, ...prompts: string[]): ChecklistItem[] => prompts.map((prompt) => ({ category, prompt }));

export const TEMPLATES: Template[] = [
  {
    key: "LETTING", name: "Letting and property management agency", who: "You let homes and shops for landlords and look after them.",
    summary: "Rent collection, tenancies, move-in and move-out checks, and the levies landlords must pay.",
    departments: [{ name: "Lettings", code: "LET" }, { name: "Property management", code: "PM" }, { name: "Accounts", code: "ACC" }, { name: "Legal", code: "LEG" }],
    checklists: [
      { name: "Move-in inspection", assetClass: "RESIDENTIAL", items: [...I("Keys and access", "Number of keys handed over recorded", "Gate, door and window locks working"), ...I("Meters", "Electricity meter reading taken", "Water meter reading taken"), ...I("Rooms", "Walls, floors and ceilings: condition noted", "Doors and windows open, close and lock"), ...I("Kitchen and bathrooms", "Taps, sinks and toilets working, no leaks", "Fitted appliances working"), ...I("Electrical", "Sockets and switches working", "Fittings and bulbs present")] },
      { name: "Move-out inspection", assetClass: "RESIDENTIAL", items: [...I("Keys and access", "All keys returned"), ...I("Meters", "Final electricity and water readings taken"), ...I("Condition", "Damage beyond fair wear and tear noted with photos", "Property clean and empty"), ...I("Utilities", "Outstanding bills checked")] },
      { name: "Quarterly tenancy inspection", assetClass: "RESIDENTIAL", items: [...I("Use", "Property used as agreed in the lease", "No unauthorised occupants or alterations"), ...I("Condition", "Roof, ceilings and walls: no leaks or cracks", "Drains and gutters clear"), ...I("Safety", "Fire extinguisher present and in date", "No exposed wiring")] },
    ],
    obligations: [
      { id: "insurance", kind: "INSURANCE", title: "Building insurance renewal", authority: "Insurer", months: 12, review: false, why: "Most landlords must insure their buildings; missing a renewal leaves them exposed." },
      { id: "luc", kind: "LAND_USE_CHARGE", title: "Land use charge", authority: "State land use charge office", months: 12, review: false, why: "An annual state levy on property; penalties apply when paid late." },
      { id: "wht", kind: "WITHHOLDING_TAX", title: "Withholding tax on rent", authority: "Tax authority", months: 1, review: true, why: "Corporate tenants deduct tax from rent; the treatment should be confirmed with a tax adviser." },
    ],
    commission: [{ id: "letting", name: "Letting fee", applies: "RENT", usual: "10" }, { id: "lease", name: "Commercial lease fee", applies: "LEASE", usual: "10" }],
    reminders: { leadDays: 30, escalationDays: 7 },
    firstSteps: [{ label: "Register your first property", href: "/app/assets/new" }, { label: "Record a lease and its rent schedule", href: "/app/assets" }, { label: "Invite your team", href: "/app/team" }, { label: "Verify the company", href: "/app/verification" }],
  },
  {
    key: "BROKERAGE", name: "Sales and lettings brokerage", who: "You sell and let property for owners and earn commission.",
    summary: "Listings, viewings, offers, the deal pipeline and commission splits between agents.",
    departments: [{ name: "Sales", code: "SAL" }, { name: "Lettings", code: "LET" }, { name: "Marketing", code: "MKT" }],
    checklists: [
      { name: "Listing quality check", assetClass: "OTHER", items: [...I("Documents", "Title document seen (not verified) and noted", "Owner's authority to sell or let on file"), ...I("Photos", "At least six clear photos, front view first", "No people or car plates in photos"), ...I("Details", "Size, rooms and price confirmed with the owner", "Fees and service charge stated")] },
      { name: "Viewing readiness check", assetClass: "OTHER", items: [...I("Access", "Keys or owner available at the time", "Security at the gate informed"), ...I("Presentation", "Lights and power working", "Property clean and aired")] },
    ],
    obligations: [
      { id: "membership", kind: "PERMIT", title: "Professional body membership renewal", authority: "Professional body (for example ESVARBON, NIESV or REDAN)", months: 12, review: false, why: "Lapsed membership can stop agents practising and lowers the company's trust level." },
      { id: "office-insurance", kind: "INSURANCE", title: "Office insurance renewal", authority: "Insurer", months: 12, review: false, why: "Covers the office and equipment." },
    ],
    commission: [{ id: "sale", name: "Sales commission", applies: "SALE", usual: "5" }, { id: "letting", name: "Letting fee", applies: "RENT", usual: "10" }, { id: "lease", name: "Commercial lease fee", applies: "LEASE", usual: "10" }],
    reminders: { leadDays: 30, escalationDays: 7 },
    firstSteps: [{ label: "Publish your first listing", href: "/app/assets/new" }, { label: "Add your agents' public profiles", href: "/app/team" }, { label: "Set up the deal pipeline", href: "/app/deals" }, { label: "Post a property reel", href: "/reels/new" }],
  },
  {
    key: "DEVELOPER", name: "Property developer", who: "You build estates and sell homes, often off-plan.",
    summary: "Projects with budgets and milestones, site inspections, defects after handover and buyer payment plans.",
    departments: [{ name: "Sales", code: "SAL" }, { name: "Projects", code: "PRJ" }, { name: "Legal", code: "LEG" }, { name: "Accounts", code: "ACC" }],
    checklists: [
      { name: "Site progress inspection", assetClass: "LAND", items: [...I("Progress", "Work done matches the programme for this stage", "Materials on site match the order"), ...I("Quality", "Work matches the approved drawings", "Concrete and blockwork quality acceptable"), ...I("Safety", "Workers wearing safety gear", "Site fenced and secured at night")] },
      { name: "Pre-handover snag inspection", assetClass: "RESIDENTIAL", items: [...I("Finishes", "Walls, floors and ceilings free of defects", "Doors and windows fit and lock"), ...I("Services", "Electrical, plumbing and drainage tested", "Meters installed and readings taken"), ...I("External", "Paving, drainage and landscaping complete")] },
      { name: "Defects period inspection", assetClass: "RESIDENTIAL", items: [...I("Defects", "Reported defects fixed", "No new cracks, leaks or damp"), ...I("Services", "Fittings still working")] },
    ],
    obligations: [
      { id: "approval", kind: "PERMIT", title: "Building plan approval and development permit", authority: "State physical planning authority", months: null, review: true, why: "Building without approval risks demolition; confirm the requirements with the authority." },
      { id: "car-insurance", kind: "INSURANCE", title: "Contractor's all-risks insurance", authority: "Insurer", months: 12, review: false, why: "Covers the works and third parties during construction." },
      { id: "ground-rent", kind: "GROUND_RENT", title: "Ground rent", authority: "State lands bureau", months: 12, review: false, why: "Payable yearly on state land; arrears can block consents." },
    ],
    commission: [{ id: "sale", name: "Sales agent commission", applies: "SALE", usual: "3" }],
    reminders: { leadDays: 45, escalationDays: 7 },
    firstSteps: [{ label: "Register the estate as an asset", href: "/app/assets/new" }, { label: "Start a construction project with its budget", href: "/app/projects" }, { label: "Draw the site outline on the map", href: "/app/assets" }, { label: "Publish the off-plan units", href: "/app/assets" }],
  },
  {
    key: "FACILITY", name: "Facility management", who: "You run and maintain buildings for their owners.",
    summary: "Planned maintenance, work orders, contractors, stock and safety checks.",
    departments: [{ name: "Facilities", code: "FM" }, { name: "Maintenance", code: "MNT" }, { name: "Health and safety", code: "HSE" }, { name: "Accounts", code: "ACC" }],
    checklists: [
      { name: "Monthly building services inspection", assetClass: "COMMERCIAL", items: [...I("Power", "Generator: oil, coolant and battery checked; run test done", "Changeover switch working"), ...I("Lifts", "Lifts running smoothly; alarm and phone working"), ...I("Water", "Pumps working; tanks clean and covered"), ...I("Electrical", "Distribution boards labelled and closed", "Emergency lighting working")] },
      { name: "Fire safety inspection", assetClass: "COMMERCIAL", items: [...I("Equipment", "Extinguishers present, in date and accessible", "Fire alarm tested"), ...I("Escape", "Exits clear and signed", "Assembly point marked")] },
      { name: "Common areas inspection", assetClass: "COMMERCIAL", items: [...I("Cleanliness", "Stairs, corridors and toilets clean"), ...I("Security", "Access control and CCTV working"), ...I("Parking", "Markings visible; lighting working")] },
    ],
    obligations: [
      { id: "fire", kind: "PERMIT", title: "Fire safety certificate", authority: "Fire service", months: 12, review: false, why: "Commercial buildings need a current fire certificate." },
      { id: "lift", kind: "OTHER", title: "Lift servicing", authority: "Lift contractor", months: 3, review: false, why: "Regular servicing keeps lifts safe and the warranty valid." },
      { id: "generator", kind: "OTHER", title: "Generator servicing", authority: "Generator contractor", months: 3, review: false, why: "Servicing on schedule prevents breakdowns." },
      { id: "insurance", kind: "INSURANCE", title: "Building insurance renewal", authority: "Insurer", months: 12, review: false, why: "Owners expect the building to stay insured." },
    ],
    commission: [],
    reminders: { leadDays: 14, escalationDays: 3 },
    firstSteps: [{ label: "Register the buildings you manage", href: "/app/assets/new" }, { label: "Add your contractors", href: "/app/maintenance" }, { label: "Set up recurring maintenance", href: "/app/maintenance" }, { label: "Record stock and equipment", href: "/app/inventory" }],
  },
  {
    key: "INSTITUTION", name: "Institutional or government portfolio", who: "You hold land and buildings for an institution, a ministry or a company.",
    summary: "A verified asset register, ownership records, condition surveys and audit-ready history.",
    departments: [{ name: "Estates", code: "EST" }, { name: "Asset register", code: "AR" }, { name: "Legal", code: "LEG" }, { name: "Internal audit", code: "AUD" }],
    checklists: [
      { name: "Annual asset verification", assetClass: "OTHER", items: [...I("Existence", "Asset seen at the recorded location", "Asset label or reference visible"), ...I("Records", "Title and ownership documents on file", "Occupier or custodian confirmed"), ...I("Condition", "Condition rated and photographed")] },
      { name: "Land and boundary inspection", assetClass: "LAND", items: [...I("Boundary", "Beacons present and intact", "No encroachment by neighbours"), ...I("Use", "No unauthorised structures or occupants"), ...I("Records", "Survey plan matches what is on the ground")] },
      { name: "Building condition survey", assetClass: "COMMERCIAL", items: [...I("Structure", "No structural cracks or settlement", "Roof sound and watertight"), ...I("Services", "Electrical and plumbing in working order"), ...I("Compliance", "Fire safety equipment present"), ...I("Recommendations", "Repairs needed recorded with estimated cost")] },
    ],
    obligations: [
      { id: "verification", kind: "OTHER", title: "Annual asset verification exercise", authority: "Internal audit", months: 12, review: false, why: "Auditors expect every asset to be seen and confirmed once a year." },
      { id: "ground-rent", kind: "GROUND_RENT", title: "Ground rent", authority: "State lands bureau", months: 12, review: false, why: "Payable yearly on state land." },
      { id: "insurance", kind: "INSURANCE", title: "Property insurance renewal", authority: "Insurer", months: 12, review: false, why: "Keeps the portfolio insured." },
    ],
    commission: [],
    reminders: { leadDays: 60, escalationDays: 14 },
    firstSteps: [{ label: "Import your asset register", href: "/app/import" }, { label: "Record ownership and custody", href: "/app/assets" }, { label: "Schedule the annual verification", href: "/app/inspections" }, { label: "Set up departments and who sees what", href: "/app/settings" }],
  },
];

export const templateFor = (key: string) => TEMPLATES.find((t) => t.key === key) ?? null;

/** Check what the administrator chose before anything is written: each ticked obligation needs a date, each ticked rule a rate. */
export function checkChoices(t: Template, c: { obligations: Record<string, string>; commission: Record<string, string> }, today: string): string[] {
  const out: string[] = [];
  for (const [id, date] of Object.entries(c.obligations)) {
    const o = t.obligations.find((x) => x.id === id);
    if (!o) { out.push("Unknown obligation"); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) out.push(`Enter when "${o.title}" is next due`);
    else if (date < today) out.push(`"${o.title}": choose a date from today on`);
  }
  for (const [id, rate] of Object.entries(c.commission)) {
    const r = t.commission.find((x) => x.id === id);
    if (!r) { out.push("Unknown commission rule"); continue; }
    const n = Number(rate);
    if (!rate.trim() || !Number.isFinite(n) || n <= 0 || n > 50) out.push(`Enter the percentage for "${r.name}" (more than 0, at most 50)`);
  }
  return out;
}
