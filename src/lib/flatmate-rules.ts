// Flatmate and roommate matching (master prompt module 18). Pure rules, so they can be tested without a database.
//
// Each person answers the same questions about how they live. Two people are compared question by question; each answer pair
// gives a similarity from 0 to 1, weighted by how much it matters when sharing a home. The weighted average is the match, from
// 0% to 100%, and falls in one of four bands. Some things are not scored but decide whether two people are shown to each other
// at all (country and city, who each would share with, and whether both of them already have a room). Each person can also mark
// up to three questions as "must match": a clear clash on one of those caps the match at "Poorly matched", whatever else agrees.

export type Opt = { code: string; label: string };
export type Factor = {
  key: string;
  question: string;
  weight: number;
  options: Opt[];
  /** Shown to other people on the profile. Answers about a household's inclusiveness are never shown. */
  shown: boolean;
  good: string;
  bad: string;
};

const o = (code: string, label: string): Opt => ({ code, label });

export const FACTORS: Factor[] = [
  { key: "smoking", question: "Do you smoke?", weight: 3, shown: true, good: "Same view on smoking", bad: "Smoking clash", options: [o("NON_SMOKER", "I don't smoke"), o("OUTSIDE", "I smoke, outside only"), o("SMOKER", "I smoke indoors")] },
  { key: "smokeOk", question: "Is a flatmate smoking all right with you?", weight: 0, shown: true, good: "", bad: "", options: [o("NO_SMOKE", "No smoking at home"), o("OUTSIDE_OK", "Fine if it's outside"), o("ANY", "Fine either way")] },
  { key: "schedule", question: "When are you usually up and about?", weight: 2, shown: true, good: "Similar daily rhythm", bad: "Different sleep hours (early riser and late nighter)", options: [o("EARLY_BIRD", "Early riser"), o("REGULAR", "Regular hours"), o("NIGHT_OWL", "Late nighter"), o("SHIFTS", "Shift work, it varies")] },
  { key: "personality", question: "Which sounds most like you at home?", weight: 1.5, shown: true, good: "Compatible personalities", bad: "One likes quiet, the other company", options: [o("INTROVERT", "Introvert: I like my own space"), o("AMBIVERT", "A bit of both"), o("EXTROVERT", "Extrovert: I like company")] },
  { key: "cleanliness", question: "How tidy do you keep shared spaces?", weight: 2.5, shown: true, good: "Same standard of tidiness", bad: "Different standards of tidiness", options: [o("RELAXED", "Relaxed"), o("TIDY", "Tidy"), o("VERY_TIDY", "Very tidy")] },
  { key: "guests", question: "How often do you have guests over?", weight: 1.5, shown: true, good: "Similar about guests", bad: "Different about guests", options: [o("RARELY", "Rarely"), o("SOMETIMES", "Sometimes"), o("OFTEN", "Often, including overnight")] },
  { key: "noise", question: "What noise level are you comfortable with at home?", weight: 1.5, shown: true, good: "Similar noise levels", bad: "Different noise levels", options: [o("QUIET", "Quiet"), o("MODERATE", "Some music and chat"), o("LIVELY", "Lively")] },
  { key: "drinking", question: "Do you drink alcohol?", weight: 1, shown: true, good: "Same view on drinking", bad: "Different about drinking", options: [o("NEVER", "Never"), o("SOCIAL", "Socially"), o("OFTEN", "Often")] },
  { key: "pets", question: "Pets?", weight: 2, shown: true, good: "Agree about pets", bad: "Pet clash", options: [o("HAVE_PETS", "I have a pet"), o("LIKE_PETS", "No pet, but happy to live with one"), o("NO_PETS", "No pets, please")] },
  { key: "workFromHome", question: "Do you work or study from home?", weight: 0.75, shown: true, good: "Similar time at home", bad: "Very different time at home", options: [o("NEVER", "Rarely"), o("SOMETIMES", "Some days"), o("MOSTLY", "Most days")] },
  { key: "cooking", question: "How much do you cook?", weight: 0.5, shown: true, good: "Similar in the kitchen", bad: "Different in the kitchen", options: [o("RARELY", "Rarely"), o("SOMETIMES", "Sometimes"), o("OFTEN", "Most days")] },
  { key: "inclusive", question: "Sharing with LGBTQ+ people", weight: 2, shown: false, good: "", bad: "", options: [o("IMPORTANT", "I need an LGBTQ+ inclusive home"), o("FINE", "Fine with me"), o("PREFER_NOT", "I'd rather not"), o("UNSAID", "I'd rather not say")] },
];

export const FACTOR_KEYS = FACTORS.map((f) => f.key);
export const MUST_MAX = 3;
/** Questions a person may mark as "must match". */
export const MUST_KEYS = ["smoking", "schedule", "personality", "cleanliness", "guests", "noise", "drinking", "pets", "inclusive", "budget", "moveIn"];

export const INTENTS = { HAVE_ROOM: "I have a room and need a flatmate", NEED_ROOM: "I need a room", TEAM_UP: "I want to find a place together" } as const;
export type Intent = keyof typeof INTENTS;
export const GENDERS = { WOMAN: "Woman", MAN: "Man", NON_BINARY: "Non-binary", UNSAID: "Prefer not to say" } as const;
export type Gender = keyof typeof GENDERS;
export const GENDER_PREFS = { ANY: "Anyone", WOMEN: "Women only", MEN: "Men only", SAME: "Same gender as me" } as const;
export type GenderPref = keyof typeof GENDER_PREFS;
export const AGE_BANDS = { "18-24": "18 to 24", "25-34": "25 to 34", "35-44": "35 to 44", "45-59": "45 to 59", "60+": "60 or over" } as const;
export type AgeBand = keyof typeof AGE_BANDS;

export type Answers = Record<string, string>;
export type Profile = {
  userId: string;
  intent: Intent;
  country: string;
  city: string;
  budgetMinKobo: bigint;
  budgetMaxKobo: bigint;
  moveIn: Date;
  ageBand: AgeBand;
  agePref: "ANY" | "SIMILAR";
  gender: Gender;
  genderPref: GenderPref;
  answers: Answers;
  must: string[];
};

export const BANDS = [
  { min: 85, label: "Perfectly matched", tone: "perfect" },
  { min: 65, label: "Excellent match", tone: "excellent" },
  { min: 40, label: "Average match", tone: "average" },
  { min: 0, label: "Poorly matched", tone: "poor" },
] as const;

export function band(score: number) {
  return BANDS.find((b) => score >= b.min)!;
}

const ORDER: Record<string, string[]> = {
  schedule: ["EARLY_BIRD", "REGULAR", "NIGHT_OWL"],
  personality: ["INTROVERT", "AMBIVERT", "EXTROVERT"],
  cleanliness: ["RELAXED", "TIDY", "VERY_TIDY"],
  guests: ["RARELY", "SOMETIMES", "OFTEN"],
  noise: ["QUIET", "MODERATE", "LIVELY"],
  drinking: ["NEVER", "SOCIAL", "OFTEN"],
  workFromHome: ["NEVER", "SOMETIMES", "MOSTLY"],
  cooking: ["RARELY", "SOMETIMES", "OFTEN"],
};

/** Similar on a scale: the same answer is 1, one step apart 0.5, two steps apart 0. */
function ordinal(key: string, a: string, b: string): number {
  if (key === "schedule" && (a === "SHIFTS" || b === "SHIFTS")) return a === b ? 1 : 0.6;
  const scale = ORDER[key];
  const i = scale.indexOf(a), j = scale.indexOf(b);
  if (i < 0 || j < 0) return 0.5;
  return [1, 0.5, 0][Math.min(2, Math.abs(i - j))];
}

const SMOKE_OK: Record<string, Record<string, number>> = {
  NO_SMOKE: { NON_SMOKER: 1, OUTSIDE: 0.3, SMOKER: 0 },
  OUTSIDE_OK: { NON_SMOKER: 1, OUTSIDE: 1, SMOKER: 0.3 },
  ANY: { NON_SMOKER: 1, OUTSIDE: 1, SMOKER: 1 },
};

function pets(a: string, b: string): number {
  const pair = [a, b].sort().join("+");
  if (pair === "HAVE_PETS+NO_PETS") return 0;
  if (pair === "LIKE_PETS+NO_PETS") return 0.8;
  return 1;
}

function inclusive(a: string, b: string): number {
  if (a === "UNSAID" || b === "UNSAID") return 0.75;
  const pair = [a, b].sort().join("+");
  if (pair === "IMPORTANT+PREFER_NOT") return 0;
  if (pair === "FINE+PREFER_NOT" || pair === "PREFER_NOT+PREFER_NOT" || pair === "FINE+FINE") return 1;
  return pair === "FINE+IMPORTANT" || pair === "IMPORTANT+IMPORTANT" ? 1 : 0.5;
}

function budget(a: Profile, b: Profile): number {
  const lo = a.budgetMinKobo > b.budgetMinKobo ? a.budgetMinKobo : b.budgetMinKobo;
  const hi = a.budgetMaxKobo < b.budgetMaxKobo ? a.budgetMaxKobo : b.budgetMaxKobo;
  if (hi < lo) {
    // No overlap: how far apart, against the larger range.
    const gap = Number(lo - hi), span = Math.max(Number(a.budgetMaxKobo - a.budgetMinKobo), Number(b.budgetMaxKobo - b.budgetMinKobo), 1);
    return gap <= span * 0.25 ? 0.4 : 0;
  }
  const overlap = Number(hi - lo), narrow = Math.max(1, Math.min(Number(a.budgetMaxKobo - a.budgetMinKobo), Number(b.budgetMaxKobo - b.budgetMinKobo)));
  return 0.7 + 0.3 * Math.min(1, overlap / narrow);
}

function moveIn(a: Date, b: Date): number {
  const days = Math.abs(a.getTime() - b.getTime()) / 864e5;
  return days <= 14 ? 1 : days <= 45 ? 0.6 : days <= 90 ? 0.3 : 0;
}

const AGE_ORDER = Object.keys(AGE_BANDS);
function age(a: Profile, b: Profile): number {
  const d = Math.abs(AGE_ORDER.indexOf(a.ageBand) - AGE_ORDER.indexOf(b.ageBand));
  const strict = a.agePref === "SIMILAR" || b.agePref === "SIMILAR";
  return d === 0 ? 1 : d === 1 ? (strict ? 0.6 : 0.85) : strict ? 0.1 : 0.6;
}

export type Part = { key: string; label: string; weight: number; similarity: number };

/** Each scored part of a match, with its similarity. */
export function parts(a: Profile, b: Profile): Part[] {
  const out: Part[] = [];
  const smoke = Math.min(SMOKE_OK[a.answers.smokeOk]?.[b.answers.smoking] ?? 0.5, SMOKE_OK[b.answers.smokeOk]?.[a.answers.smoking] ?? 0.5);
  out.push({ key: "smoking", label: "Smoking", weight: 3, similarity: smoke });
  for (const f of FACTORS) {
    if (f.key === "smoking" || f.key === "smokeOk") continue;
    const x = a.answers[f.key], y = b.answers[f.key];
    const s = f.key === "pets" ? pets(x, y) : f.key === "inclusive" ? inclusive(x, y) : ordinal(f.key, x, y);
    out.push({ key: f.key, label: f.question, weight: f.weight, similarity: s });
  }
  out.push({ key: "budget", label: "Budget", weight: 2, similarity: budget(a, b) });
  out.push({ key: "moveIn", label: "Move-in date", weight: 1.5, similarity: moveIn(a.moveIn, b.moveIn) });
  out.push({ key: "age", label: "Age", weight: 1, similarity: age(a, b) });
  return out;
}

const genderOk = (pref: GenderPref, mine: Gender, theirs: Gender) =>
  pref === "ANY" || (pref === "WOMEN" && theirs === "WOMAN") || (pref === "MEN" && theirs === "MAN") || (pref === "SAME" && mine !== "UNSAID" && mine === theirs);

/** Whether two people should be shown to each other at all. Returns the reason they are not, or null. */
export function excluded(a: Profile, b: Profile): string | null {
  if (a.userId === b.userId) return "self";
  if (a.country !== b.country) return "country";
  if (norm(a.city) !== norm(b.city)) return "city";
  if (a.intent === "HAVE_ROOM" && b.intent === "HAVE_ROOM") return "both have rooms";
  if (!genderOk(a.genderPref, a.gender, b.gender) || !genderOk(b.genderPref, b.gender, a.gender)) return "gender preference";
  return null;
}

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type Match = { score: number; band: (typeof BANDS)[number]; dealbreaker: string | null; good: string[]; bad: string[] };

/** The match between two people, from 0 to 100, with the reasons. */
export function match(a: Profile, b: Profile): Match {
  const ps = parts(a, b);
  const total = ps.reduce((n, p) => n + p.weight, 0);
  // The weighted average is stretched (raised to the power 1.5) so that agreeing only on the easy things does not look like a
  // good match: 90% agreement scores 85, 80% scores 72, 60% scores 46, 40% scores 25.
  const avg = ps.reduce((n, p) => n + p.weight * p.similarity, 0) / total;
  let score = Math.round(100 * Math.pow(avg, 1.5));
  const must = new Set([...a.must, ...b.must]);
  const clash = ps.find((p) => must.has(p.key) && p.similarity < 0.5) ?? null;
  if (clash) score = Math.min(score, 39);
  const say = (p: Part, good: boolean) => {
    if (p.key === "inclusive") return null; // never named, only counted
    if (p.key === "budget") return good ? "Budgets overlap" : "Budgets far apart";
    if (p.key === "moveIn") return good ? "Moving in around the same time" : "Move-in dates far apart";
    if (p.key === "age") return good ? "Similar age" : "Different age groups";
    const f = FACTORS.find((x) => x.key === p.key)!;
    return good ? f.good : f.bad;
  };
  const good = ps.filter((p) => p.similarity >= 0.9 && p.weight >= 1).sort((x, y) => y.weight - x.weight).map((p) => say(p, true)).filter((x): x is string => !!x).slice(0, 4);
  const bad = ps.filter((p) => p.similarity <= 0.4).sort((x, y) => y.weight - x.weight).map((p) => say(p, false)).filter((x): x is string => !!x).slice(0, 3);
  return { score, band: band(score), dealbreaker: clash ? (clash.key === "inclusive" ? "A must-match answer differs" : `Must-match: ${say(clash, false)}`) : null, good, bad };
}

/** Check a profile form. Returns problems, empty when fine. */
export function checkAnswers(answers: Answers, must: string[]): string[] {
  const out: string[] = [];
  for (const f of FACTORS) if (!f.options.some((x) => x.code === answers[f.key])) out.push(`Answer: ${f.question}`);
  if (must.length > MUST_MAX) out.push(`Choose at most ${MUST_MAX} must-match answers`);
  if (must.some((m) => !MUST_KEYS.includes(m))) out.push("Unknown must-match choice");
  return out;
}

/** First name and initial only, so a profile never shows a full name. */
export function publicName(full: string): string {
  const parts = full.replace(/\[[^\]]*\]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Member";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export const ROOM_MAX = 6;
