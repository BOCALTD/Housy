import { createHash } from "node:crypto";

// Pure rules for vacancy reports: the review stages, how duplicates are recognised, the warning signs that send a report to a person,
// and the privacy rules for what an owner or the public may be told about the person who reported.

export const VACANCY_STAGES = ["SUBMITTED", "DUPLICATE_CHECK", "INITIAL_REVIEW", "LOCATION_VERIFICATION", "AVAILABILITY_CONFIRMATION", "OWNER_VERIFICATION", "REWARD_REVIEW"] as const;
export type VacancyStageName = (typeof VACANCY_STAGES)[number];
export type VacancyOutcomeName = "OPEN" | "APPROVED" | "REJECTED" | "NEEDS_INFO" | "MERGED" | "WITHDRAWN";

export const STAGE_TEXT: Record<VacancyStageName, { label: string; plain: string }> = {
  SUBMITTED: { label: "Submitted", plain: "We received your report." },
  DUPLICATE_CHECK: { label: "Duplicate check", plain: "We are checking whether someone has already reported this place." },
  INITIAL_REVIEW: { label: "Initial review", plain: "A person is reading your report." },
  LOCATION_VERIFICATION: { label: "Location check", plain: "We are checking that the place is where you said it is." },
  AVAILABILITY_CONFIRMATION: { label: "Availability check", plain: "We are checking that the property is really vacant and available." },
  OWNER_VERIFICATION: { label: "Owner or agent check", plain: "We are trying to reach the owner or an authorised agent. Nothing is published without their permission." },
  REWARD_REVIEW: { label: "Reward review", plain: "Your report checks out. We are reviewing the reward." },
};

/** Stages only move forward, one step at a time. Whether a report is approved, rejected or needs more information is a separate decision. */
export function nextStage(stage: VacancyStageName): VacancyStageName | null {
  const i = VACANCY_STAGES.indexOf(stage);
  return i >= 0 && i < VACANCY_STAGES.length - 1 ? VACANCY_STAGES[i + 1] : null;
}
export function stageMoveProblem(from: VacancyStageName, to: VacancyStageName, outcome: VacancyOutcomeName): string | null {
  if (outcome !== "OPEN") return "This report is closed or waiting for the reporter.";
  if (nextStage(from) !== to) return "A report moves one stage at a time, forward only.";
  return null;
}

/** What the reporter reads. It never says more than the facts: a vacancy seen is not yet a vacancy confirmed, and neither is permission to publish. */
export function vacancyStatusText(stage: VacancyStageName, outcome: VacancyOutcomeName, o: { reason?: string; question?: string } = {}): string {
  switch (outcome) {
    case "APPROVED": return "Your report was verified. A verified report is not the same as a published listing: the owner or an authorised agent must agree before anything is advertised.";
    case "REJECTED": return `Your report was not accepted.${o.reason ? ` ${o.reason}` : ""} You can appeal once if you think this is wrong.`;
    case "NEEDS_INFO": return `We need a little more from you.${o.question ? ` ${o.question}` : ""}`;
    case "MERGED": return "Another report of the same property was received earlier, so yours was merged into it. If your report was the first to give a verifiable detail, tell us in an appeal.";
    case "WITHDRAWN": return "You withdrew this report.";
    default: return STAGE_TEXT[stage].plain;
  }
}

// ---------- Duplicates ----------

const ABBREVIATIONS: Record<string, string> = { st: "street", rd: "road", ave: "avenue", cl: "close", cres: "crescent", dr: "drive", ln: "lane", est: "estate", blk: "block", no: "", number: "", plot: "plot", opp: "opposite" };

/** The same address written two ways should give the same key. */
export function normaliseAddress(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => (w in ABBREVIATIONS ? ABBREVIATIONS[w] : w)).filter(Boolean).join(" ");
}
export const addressKey = (address: string, area: string, city: string) => `${normaliseAddress(address)}|${normaliseAddress(area)}|${normaliseAddress(city)}`;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const insideNigeria = (lat: number, lng: number) => lat >= 4.2 && lat <= 13.9 && lng >= 2.6 && lng <= 14.7;

export interface Candidate {
  id: string; reporterId: string; addressKey: string; lat: number | null; lng: number | null; propertyType: string; bedrooms: number | null; createdAt: Date; clusterId?: string;
}
/** Same place, same sort of property, close in time. Reports by the same person are separated from reports by others. */
export function findDuplicates(n: Candidate, existing: Candidate[], radiusM: number, windowDays: number, now: Date) {
  const same: Candidate[] = [], others: Candidate[] = [];
  for (const e of existing) {
    if (e.id === n.id || now.getTime() - e.createdAt.getTime() > windowDays * 864e5) continue;
    const bedsAgree = n.bedrooms === null || e.bedrooms === null || n.bedrooms === e.bedrooms;
    const byAddress = e.addressKey === n.addressKey && n.addressKey.replace(/\|/g, "").length > 0;
    const byPlace = n.lat !== null && n.lng !== null && e.lat !== null && e.lng !== null && e.propertyType === n.propertyType && bedsAgree && haversineM({ lat: n.lat, lng: n.lng }, { lat: e.lat, lng: e.lng }) <= radiusM;
    if (byAddress || byPlace) (e.reporterId === n.reporterId ? same : others).push(e);
  }
  const earliest = (xs: Candidate[]) => xs.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return { sameReporter: earliest(same) ?? null, others, earliest: earliest(others) ?? null };
}

// ---------- Warning signs ----------

export const textHash = (text: string) => createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
export const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface VacancyFacts { photoReused: boolean; textRepeated: boolean; rejectedRecently: number; rejectFlag: number; reportsToday: number; perDay: number; lat: number | null; lng: number | null }
/** Reasons for a person to look. None of them is a finding on its own. */
export function vacancySignals(f: VacancyFacts): string[] {
  const out: string[] = [];
  if (f.photoReused) out.push("SAME_PHOTO");
  if (f.rejectedRecently >= f.rejectFlag) out.push("REPEAT_REJECTIONS");
  if (f.reportsToday >= f.perDay) out.push("REPORT_BURST");
  if (f.lat !== null && f.lng !== null && !insideNigeria(f.lat, f.lng)) out.push("OUTSIDE_COVERAGE");
  if (f.textRepeated) out.push("SAME_TEXT");
  return out;
}

// ---------- Privacy ----------

/** What an owner is told about the reporter. The default is nothing. */
export function ownerFacingReporter(r: { showNameToOwner: boolean; reporterName: string }): string {
  return r.showNameToOwner ? r.reporterName : "A member of the community";
}
/** Whether the platform may contact the reporter outside the app. In-app messages are always allowed. */
export const mayContactOutsideApp = (r: { allowContact: boolean }) => r.allowContact;

/** Area figures for administrators never show a group small enough to point at one reporter. */
export const AREA_MINIMUM = 3;
export function areaCount(n: number): string { return n >= AREA_MINIMUM ? String(n) : `fewer than ${AREA_MINIMUM}`; }
