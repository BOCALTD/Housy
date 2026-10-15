// Pure rules for inspections (master prompt Section 14). Nothing here touches the database.

export const RATING_ORDER = ["EXCELLENT", "GOOD", "FAIR", "POOR", "CRITICAL"] as const;
export type Rating = (typeof RATING_ORDER)[number];
export type CheckResultName = "PENDING" | "PASS" | "ATTENTION" | "FAIL" | "NOT_APPLICABLE";
export type SeverityName = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function ratingScore(r: Rating): number {
  return RATING_ORDER.indexOf(r);
}

/** How the condition has moved between two inspections. Positive means worse. */
export function conditionChange(previous: Rating, current: Rating): number {
  return ratingScore(current) - ratingScore(previous);
}

/**
 * Possible inconsistencies for the reviewer to look at. These are prompts, not verdicts: an
 * inspector may have good reason, and nothing here replaces a professional inspection.
 */
export function inspectionWarnings(input: {
  rating: Rating | null;
  responses: { result: CheckResultName; note: string }[];
  findings: { severity: SeverityName; safetyRisk: boolean; recommendedAction: string }[];
}): string[] {
  const out: string[] = [];
  const failed = input.responses.filter((r) => r.result === "FAIL").length;
  const attention = input.responses.filter((r) => r.result === "ATTENTION").length;
  const severe = input.findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").length;
  const critical = input.findings.some((f) => f.severity === "CRITICAL");
  const safety = input.findings.filter((f) => f.safetyRisk).length;
  if (input.rating) {
    const score = ratingScore(input.rating);
    if (score <= 1 && failed > 0) out.push(`Rated ${input.rating.toLowerCase()} although ${failed} checklist item${failed === 1 ? "" : "s"} failed`);
    if (score <= 1 && severe > 0) out.push(`Rated ${input.rating.toLowerCase()} although ${severe} serious finding${severe === 1 ? " was" : "s were"} recorded`);
    if (critical && input.rating !== "CRITICAL" && input.rating !== "POOR") out.push("A critical finding is recorded but the overall condition is better than poor");
    if (score >= 3 && failed === 0 && input.findings.length === 0) out.push(`Rated ${input.rating.toLowerCase()} but no failed items or findings explain it`);
  }
  if (failed > 0 && input.findings.length === 0) out.push("Checklist items failed but no finding was recorded");
  if (attention > 0 && input.responses.filter((r) => r.result === "ATTENTION" && !r.note.trim()).length > 0) {
    out.push("Some items marked as needing attention have no note");
  }
  if (safety > 0 && input.findings.some((f) => f.safetyRisk && !f.recommendedAction.trim())) {
    out.push("A safety risk has no recommended action");
  }
  return out;
}

/** Why an inspection cannot be submitted yet, or null if it can. */
export function submissionProblem(input: {
  conductedOn: Date | null; today: Date; rating: Rating | null; summary: string;
  responses: { result: CheckResultName }[];
}): string | null {
  if (!input.conductedOn) return "Record the date the inspection was carried out";
  if (input.conductedOn.getTime() > input.today.getTime()) return "The inspection date cannot be in the future";
  if (input.responses.some((r) => r.result === "PENDING")) return "Answer every checklist item (use not applicable where it does not apply)";
  if (!input.rating) return "Record the overall condition rating";
  if (input.summary.trim().length < 5) return "Write a short summary of the inspection";
  return null;
}

export interface StarterItem { category: string; prompt: string }

const RESIDENTIAL: StarterItem[] = [
  { category: "Structure", prompt: "Walls, ceilings and floors free of cracks, damp or movement" },
  { category: "Roofing", prompt: "Roof covering, flashing and gutters sound and free of leaks" },
  { category: "Plumbing", prompt: "Taps, sanitary fittings and pipework working without leaks" },
  { category: "Electrical", prompt: "Sockets, switches, lighting and distribution board safe and working" },
  { category: "Finishes", prompt: "Paintwork, tiling, doors, windows and fixtures in good order" },
  { category: "Utilities", prompt: "Water supply, power supply and meters working and readings noted" },
  { category: "Drainage", prompt: "Drains, soakaways and surface water clear and flowing" },
  { category: "Access and security", prompt: "Gates, locks, fencing, lighting and access routes secure" },
];

const COMMERCIAL: StarterItem[] = [
  ...RESIDENTIAL,
  { category: "Fire and safety", prompt: "Extinguishers in date, exits clear, alarms and signage in place" },
  { category: "Common areas", prompt: "Corridors, stairs, lifts and shared facilities clean and safe" },
];

const LAND: StarterItem[] = [
  { category: "Boundaries", prompt: "Boundary beacons, fences or markers in place and undisturbed" },
  { category: "Encroachment", prompt: "No encroachment, squatters or unauthorised structures" },
  { category: "Access", prompt: "Access roads and rights of way clear" },
  { category: "Drainage and erosion", prompt: "No flooding, erosion or standing water" },
  { category: "Signage", prompt: "Ownership or warning signs displayed and legible" },
];

const MACHINERY: StarterItem[] = [
  { category: "Identification", prompt: "Serial number and model plate match the register" },
  { category: "Operation", prompt: "Starts, runs and stops normally; operating hours noted" },
  { category: "Mechanical", prompt: "No abnormal noise, vibration, wear or leaks" },
  { category: "Electrical and controls", prompt: "Controls, wiring, gauges and emergency stops working" },
  { category: "Safety", prompt: "Guards, interlocks and safety labels in place" },
  { category: "Documentation", prompt: "Service records, safety certificates and manuals available" },
  { category: "Maintenance status", prompt: "Service up to date against the maintenance schedule" },
];

const GENERAL: StarterItem[] = [
  { category: "General condition", prompt: "Overall physical condition" },
  { category: "Safety", prompt: "No visible hazards" },
  { category: "Security", prompt: "Secured against unauthorised access" },
  { category: "Records", prompt: "Documents and records available and consistent" },
];

export const STARTER_TEMPLATES: { name: string; assetClass: "RESIDENTIAL" | "COMMERCIAL" | "LAND" | "INDUSTRIAL" | "PLANT_MACHINERY" | "OTHER"; items: StarterItem[] }[] = [
  { name: "Residential property inspection", assetClass: "RESIDENTIAL", items: RESIDENTIAL },
  { name: "Commercial property inspection", assetClass: "COMMERCIAL", items: COMMERCIAL },
  { name: "Industrial property inspection", assetClass: "INDUSTRIAL", items: COMMERCIAL },
  { name: "Land inspection", assetClass: "LAND", items: LAND },
  { name: "Plant and machinery inspection", assetClass: "PLANT_MACHINERY", items: MACHINERY },
  { name: "General asset inspection", assetClass: "OTHER", items: GENERAL },
];

/** Turn pasted lines such as "Roofing | Gutters clear" into checklist items. A line without a bar has no category. */
export function parseChecklist(text: string): StarterItem[] {
  const items: StarterItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bar = line.indexOf("|");
    const category = bar >= 0 ? line.slice(0, bar).trim() : "General";
    const prompt = (bar >= 0 ? line.slice(bar + 1) : line).trim();
    if (prompt.length < 3) throw new Error(`Checklist line "${line.slice(0, 40)}" is too short`);
    items.push({ category: category || "General", prompt });
  }
  if (items.length === 0) throw new Error("Add at least one checklist item");
  if (items.length > 200) throw new Error("A checklist can have at most 200 items");
  return items;
}
