import { test } from "node:test";
import assert from "node:assert/strict";
import { FACTORS, band, checkAnswers, excluded, match, publicName, type Profile } from "../../src/lib/flatmate-rules";

const base: Profile = {
  userId: "a", intent: "NEED_ROOM", country: "NG", city: "Lagos", budgetMinKobo: 10_000_000n, budgetMaxKobo: 20_000_000n,
  moveIn: new Date("2026-11-01T00:00:00Z"), ageBand: "25-34", agePref: "ANY", gender: "WOMAN", genderPref: "ANY",
  answers: { smoking: "NON_SMOKER", smokeOk: "NO_SMOKE", schedule: "REGULAR", personality: "INTROVERT", cleanliness: "TIDY", guests: "SOMETIMES", noise: "QUIET", drinking: "SOCIAL", pets: "LIKE_PETS", workFromHome: "SOMETIMES", cooking: "SOMETIMES", inclusive: "FINE" },
  must: [],
};
const other = (o: Partial<Profile> & { answers?: Partial<Profile["answers"]> } = {}): Profile => ({ ...base, userId: "b", intent: "HAVE_ROOM", ...o, answers: { ...base.answers, ...(o.answers ?? {}) } as Profile["answers"] });

test("the four bands", () => {
  assert.equal(band(100).label, "Perfectly matched");
  assert.equal(band(85).label, "Perfectly matched");
  assert.equal(band(84).label, "Excellent match");
  assert.equal(band(65).label, "Excellent match");
  assert.equal(band(64).label, "Average match");
  assert.equal(band(40).label, "Average match");
  assert.equal(band(39).label, "Poorly matched");
  assert.equal(band(0).label, "Poorly matched");
});

test("two people who live the same way are perfectly matched", () => {
  const m = match(base, other());
  assert.equal(m.score, 100);
  assert.equal(m.band.label, "Perfectly matched");
  assert.ok(m.good.includes("Same view on smoking"));
  assert.deepEqual(m.bad, []);
});

test("smoking, late nights, introvert and extrovert, tidiness: each clash lowers the match", () => {
  const smoker = match(base, other({ answers: { smoking: "SMOKER", smokeOk: "ANY" } }));
  assert.ok(smoker.score < 90 && smoker.bad.includes("Smoking clash"));
  const nightOwl = match(base, other({ answers: { schedule: "NIGHT_OWL" } }));
  assert.ok(nightOwl.score < 100 && nightOwl.bad.length === 0, "one step apart is not a clash");
  assert.ok(nightOwl.mixed.includes("A little different on sleep hours"), "but it is worth a conversation");
  const early = match({ ...base, answers: { ...base.answers, schedule: "EARLY_BIRD" } }, other({ answers: { schedule: "NIGHT_OWL" } }));
  assert.ok(early.bad.includes("Different sleep hours (early riser and late nighter)"));
  const extro = match(base, other({ answers: { personality: "EXTROVERT" } }));
  assert.ok(extro.bad.includes("One likes quiet, the other company"));
  const everything = match(base, other({ answers: { smoking: "SMOKER", smokeOk: "ANY", schedule: "NIGHT_OWL", personality: "EXTROVERT", cleanliness: "RELAXED", guests: "OFTEN", noise: "LIVELY", drinking: "OFTEN", pets: "HAVE_PETS", workFromHome: "MOSTLY", cooking: "OFTEN", inclusive: "FINE" }, budgetMinKobo: 60_000_000n, budgetMaxKobo: 80_000_000n, moveIn: new Date("2027-06-01T00:00:00Z") }));
  assert.equal(everything.band.label, "Poorly matched");
  assert.ok(smoker.score > everything.score);
});

test("a clash on a must-match answer is always a poor match", () => {
  const free = match(base, other({ answers: { pets: "HAVE_PETS" }, must: [] }));
  assert.ok(free.score >= 65, `still a good match overall (${free.score})`);
  const strict = match({ ...base, answers: { ...base.answers, pets: "NO_PETS" }, must: ["pets"] }, other({ answers: { pets: "HAVE_PETS" } }));
  assert.ok(strict.score <= 39);
  assert.match(strict.dealbreaker ?? "", /Must-match: Pet clash/);
});

test("the household-inclusiveness answer counts but is never named", () => {
  const m = match({ ...base, answers: { ...base.answers, inclusive: "IMPORTANT" } }, other({ answers: { inclusive: "PREFER_NOT" } }));
  assert.ok(m.score < 100);
  assert.ok(![...m.good, ...m.bad].some((r) => /LGBTQ|inclusive/i.test(r)));
  const must = match({ ...base, answers: { ...base.answers, inclusive: "IMPORTANT" }, must: ["inclusive"] }, other({ answers: { inclusive: "PREFER_NOT" } }));
  assert.ok(must.score <= 39);
  assert.equal(must.dealbreaker, "A must-match answer differs");
  assert.equal(FACTORS.find((f) => f.key === "inclusive")!.shown, false);
});

test("people who could not share are never shown to each other", () => {
  assert.equal(excluded(base, other()), null);
  assert.equal(excluded(base, other({ city: "Abuja" })), "city");
  assert.equal(excluded(base, other({ city: "  lagos " })), null, "case and spaces do not matter");
  assert.equal(excluded(base, other({ country: "GH" })), "country");
  assert.equal(excluded({ ...base, intent: "HAVE_ROOM" }, other({ intent: "HAVE_ROOM" })), "both have rooms");
  assert.equal(excluded({ ...base, genderPref: "WOMEN" }, other({ gender: "MAN" })), "gender preference");
  assert.equal(excluded(base, other({ gender: "MAN", genderPref: "MEN" })), "gender preference", "their preference counts too");
  assert.equal(excluded({ ...base, genderPref: "SAME" }, other({ gender: "WOMAN" })), null);
  assert.equal(excluded({ ...base, gender: "UNSAID", genderPref: "SAME" }, other()), "gender preference");
});

test("budgets and move-in dates", () => {
  const far = match(base, other({ budgetMinKobo: 50_000_000n, budgetMaxKobo: 60_000_000n }));
  assert.ok(far.bad.includes("Budgets far apart"));
  const later = match(base, other({ moveIn: new Date("2027-04-01T00:00:00Z") }));
  assert.ok(later.bad.includes("Move-in dates far apart"));
});

test("answers are checked, and names are shortened", () => {
  assert.deepEqual(checkAnswers(base.answers, []), []);
  assert.ok(checkAnswers({ ...base.answers, smoking: "SOMETIMES" }, []).length === 1);
  assert.ok(checkAnswers(base.answers, ["pets", "smoking", "noise", "guests"]).some((p) => /at most/.test(p)));
  assert.equal(publicName("Adaeze Grace Okafor"), "Adaeze O.");
  assert.equal(publicName("[DEMO] Seyi Seeker"), "Seyi S.");
  assert.equal(publicName("Tunde"), "Tunde");
});

test("space, furnishing and must-haves: overlap helps, a clash hurts, not answering is neutral", () => {
  const m = match;
  const mk = (over: Partial<Profile>): Profile => ({ ...base, ...over });
  const same = m(mk({ spaces: ["FLAT_2"], amenities: ["POWER", "WATER"] }), other({ spaces: ["FLAT_2", "MINI_FLAT"], amenities: ["POWER", "WATER"] }));
  const clash = m(mk({ spaces: ["ROOM"], furnishing: "FURNISHED" }), other({ spaces: ["DUPLEX"], furnishing: "UNFURNISHED" }));
  const unsaid = m(mk({}), other());
  assert.equal(unsaid.score, 100);
  assert.ok(same.score >= 95, `overlap keeps a high score (${same.score})`);
  assert.ok(clash.score < unsaid.score - 10, `a space and furnishing clash costs points (${clash.score})`);
  assert.ok(clash.bad.includes("Want different kinds of space"));
  const mustSpace = m(mk({ spaces: ["ROOM"], must: ["space"] }), other({ spaces: ["DUPLEX"] }));
  assert.ok(mustSpace.score <= 39 && mustSpace.dealbreaker);
});

test("verified only: neither side sees an unverified person", () => {
  const ex = excluded;
  const me: Profile = { ...base, verifiedOnly: true, verified: true };
  assert.equal(ex(me, other({ verified: false })), "verification");
  assert.equal(ex(me, other({ verified: true })), null);
  assert.equal(ex({ ...base, verified: false }, other({ verifiedOnly: true, verified: true })), "verification");
});
