// Flatmate and roommate matching (master prompt: "Roommate and Flatmate Matching"). Pure rules, tested without a database.

export const MODES = { HAS_ROOM: "I have a room to share", LOOKING: "I am looking for a room", TEAM_UP: "I want to find a place together" } as const;
export type Mode = keyof typeof MODES;
export const SMOKING = { NO: "Non-smoker", OUTSIDE: "Smokes outside only", YES: "Smoker" } as const;
export const PETS = { NONE: "No pets", HAS: "Has a pet", OK: "No pets but happy with them" } as const;
export const SCHEDULE = { EARLY: "Early riser", LATE: "Night owl", SHIFTS: "Works shifts", FLEXIBLE: "Flexible" } as const;
export const TIDINESS = { RELAXED: "Relaxed", TIDY: "Tidy", VERY_TIDY: "Very tidy" } as const;
export const GUESTS = { RARELY: "Guests rarely", SOMETIMES: "Guests sometimes", OFTEN: "Guests often" } as const;
/** Some households are for women only or men only; that is the person's choice, used only to avoid mismatches. */
export const HOUSEHOLD = { ANY: "Anyone", WOMEN: "Women only", MEN: "Men only" } as const;
export const I_AM = { UNSAID: "Prefer not to say", WOMAN: "Woman", MAN: "Man" } as const;

export type Profile = {
  userId: string;
  mode: Mode;
  city: string;
  areas: string;
  budgetMinKobo: bigint;
  budgetMaxKobo: bigint;
  moveInFrom: Date;
  smoking: keyof typeof SMOKING;
  pets: keyof typeof PETS;
  schedule: keyof typeof SCHEDULE;
  tidiness: keyof typeof TIDINESS;
  guests: keyof typeof GUESTS;
  household: keyof typeof HOUSEHOLD;
  iAm: keyof typeof I_AM;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const areaList = (s: string) => s.split(/[,;\n]/).map(norm).filter(Boolean);

/** Whether two people could share at all. Anything here that fails rules the pair out entirely. */
export function compatible(a: Profile, b: Profile): boolean {
  if (a.userId === b.userId) return false;
  if (norm(a.city) !== norm(b.city)) return false;
  if (a.mode === "HAS_ROOM" && b.mode === "HAS_ROOM") return false;
  // A women-only or men-only household is respected both ways: each person must fit the other's household.
  const fits = (household: Profile["household"], person: Profile["iAm"]) => household === "ANY" || (household === "WOMEN" && person === "WOMAN") || (household === "MEN" && person === "MAN");
  if (!fits(a.household, b.iAm) || !fits(b.household, a.iAm)) return false;
  // Budgets must overlap.
  if (a.budgetMaxKobo < b.budgetMinKobo || b.budgetMaxKobo < a.budgetMinKobo) return false;
  return true;
}

const ORDER = { SCHEDULE: ["EARLY", "FLEXIBLE", "LATE"], TIDINESS: ["RELAXED", "TIDY", "VERY_TIDY"], GUESTS: ["RARELY", "SOMETIMES", "OFTEN"] };

/** How well two compatible people match, 0 to 100, with the reasons shown to them. */
export function matchScore(a: Profile, b: Profile): { score: number; reasons: string[]; cautions: string[] } {
  const reasons: string[] = [], cautions: string[] = [];
  let score = 40;
  if ((a.mode === "HAS_ROOM" && b.mode !== "HAS_ROOM") || (b.mode === "HAS_ROOM" && a.mode !== "HAS_ROOM")) { score += 10; reasons.push("One of you has a room, the other is looking"); }
  else if (a.mode === "TEAM_UP" && b.mode === "TEAM_UP") { score += 8; reasons.push("You both want to find a place together"); }

  const shared = areaList(a.areas).filter((x) => areaList(b.areas).includes(x));
  if (shared.length) { score += 10; reasons.push(`Both interested in ${shared.slice(0, 2).join(" and ")}`); }

  const days = Math.abs(a.moveInFrom.getTime() - b.moveInFrom.getTime()) / 864e5;
  if (days <= 30) { score += 10; reasons.push("Move-in dates within a month"); } else if (days <= 90) score += 4; else cautions.push("Move-in dates are far apart");

  if (a.smoking === b.smoking) { score += 8; reasons.push(SMOKING[a.smoking]); }
  else if ((a.smoking === "YES" && b.smoking === "NO") || (b.smoking === "YES" && a.smoking === "NO")) { score -= 12; cautions.push("One smokes indoors, the other does not smoke"); }

  if (a.pets === "HAS" && b.pets === "NONE" || b.pets === "HAS" && a.pets === "NONE") { score -= 8; cautions.push("One has a pet, the other would rather not"); }
  else if (a.pets === b.pets || a.pets === "OK" || b.pets === "OK") score += 4;

  const step = (k: keyof typeof ORDER, x: string, y: string) => Math.abs(ORDER[k].indexOf(x) - ORDER[k].indexOf(y));
  if (a.schedule === "SHIFTS" || b.schedule === "SHIFTS") { if (a.schedule === b.schedule) { score += 6; reasons.push("Both work shifts"); } }
  else if (step("SCHEDULE", a.schedule, b.schedule) === 0) { score += 6; reasons.push(SCHEDULE[a.schedule]); }
  else if (step("SCHEDULE", a.schedule, b.schedule) === 2) { score -= 4; cautions.push("Early riser and night owl"); }

  const t = step("TIDINESS", a.tidiness, b.tidiness);
  if (t === 0) { score += 8; reasons.push(`Both ${TIDINESS[a.tidiness].toLowerCase()}`); } else if (t === 2) { score -= 8; cautions.push("Very different ideas of tidy"); }
  const g = step("GUESTS", a.guests, b.guests);
  if (g === 0) score += 4; else if (g === 2) { score -= 4; cautions.push("Different views on guests"); }

  return { score: Math.max(0, Math.min(100, score)), reasons, cautions };
}

/** Matches for one person, best first, leaving out anyone hidden either way. */
export function rankMatches(me: Profile, others: Profile[], hidden: Set<string> = new Set()) {
  return others
    .filter((o) => !hidden.has(o.userId) && compatible(me, o))
    .map((o) => ({ userId: o.userId, ...matchScore(me, o) }))
    .sort((x, y) => y.score - x.score);
}

export function checkProfileInput(p: { city: string; budgetMinKobo: bigint; budgetMaxKobo: bigint; about: string; displayName: string; adult: boolean }): string[] {
  const out: string[] = [];
  if (!p.adult) out.push("Flatmate matching is for adults (18 or over)");
  if (p.displayName.trim().length < 2) out.push("Enter the name to show (a first name is enough)");
  if (p.city.trim().length < 2) out.push("Enter the city");
  if (p.budgetMinKobo < BigInt(0) || p.budgetMaxKobo <= BigInt(0)) out.push("Enter your monthly budget");
  if (p.budgetMinKobo > p.budgetMaxKobo) out.push("The lowest budget must not be more than the highest");
  if (p.about.length > 800) out.push("Keep the description under 800 characters");
  // Contact details are shared through messages after a match, never on the profile.
  if (/\b0[789][01]\d{8}\b|\+?234\s?\d{3}\s?\d{3}\s?\d{4}|@[a-z0-9-]+\.[a-z]{2,}|https?:\/\//i.test(p.about)) out.push("Leave phone numbers, emails and links out of your description. You can share them by message after you match");
  return out;
}
