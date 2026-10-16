import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressKey, areaCount, bytesHash, findDuplicates, haversineM, insideNigeria, nextStage, normaliseAddress, ownerFacingReporter, stageMoveProblem, textHash, vacancySignals, vacancyStatusText, VACANCY_STAGES, type Candidate,
} from "../../src/lib/vacancy-rules";

const base: Candidate = { id: "n", reporterId: "r1", addressKey: addressKey("12 Allen Avenue", "Ikeja", "Lagos"), lat: 6.6018, lng: 3.3515, propertyType: "FLAT", bedrooms: 2, createdAt: new Date("2026-10-10T10:00:00Z") };
const now = new Date("2026-10-16T10:00:00Z");

test("stages move forward one step at a time and only while the report is open", () => {
  assert.equal(nextStage("SUBMITTED"), "DUPLICATE_CHECK");
  assert.equal(nextStage("REWARD_REVIEW"), null);
  assert.equal(VACANCY_STAGES.length, 7);
  assert.equal(stageMoveProblem("SUBMITTED", "DUPLICATE_CHECK", "OPEN"), null);
  assert.match(stageMoveProblem("SUBMITTED", "INITIAL_REVIEW", "OPEN")!, /one stage/);
  assert.match(stageMoveProblem("INITIAL_REVIEW", "SUBMITTED", "OPEN")!, /forward/);
  assert.match(stageMoveProblem("SUBMITTED", "DUPLICATE_CHECK", "REJECTED")!, /closed/);
});

test("an approved report is told apart from permission to publish", () => {
  assert.match(vacancyStatusText("REWARD_REVIEW", "APPROVED"), /not the same as a published listing/);
  assert.match(vacancyStatusText("INITIAL_REVIEW", "REJECTED", { reason: "No such street." }), /No such street\..*appeal/);
  assert.match(vacancyStatusText("INITIAL_REVIEW", "NEEDS_INFO", { question: "Which house number?" }), /Which house number\?/);
  assert.match(vacancyStatusText("OWNER_VERIFICATION", "OPEN"), /Nothing is published without/);
});

test("the same address written two ways gives the same key", () => {
  assert.equal(normaliseAddress("No. 12, Allen Ave."), normaliseAddress("12 allen avenue"));
  assert.equal(addressKey("12 Allen Ave", "Ikeja", "Lagos"), base.addressKey);
  assert.notEqual(addressKey("14 Allen Ave", "Ikeja", "Lagos"), base.addressKey);
});

test("distance between two points", () => {
  assert.ok(haversineM({ lat: 6.6018, lng: 3.3515 }, { lat: 6.6018, lng: 3.3515 }) < 0.01);
  const d = haversineM({ lat: 6.6018, lng: 3.3515 }, { lat: 6.60225, lng: 3.3515 });
  assert.ok(d > 45 && d < 55, `about 50 m, got ${d}`);
  assert.equal(insideNigeria(6.5, 3.4), true);
  assert.equal(insideNigeria(51.5, -0.1), false);
});

test("duplicates are found by address or by place and kind, within the window, and the reporter's own are kept apart", () => {
  const earlier: Candidate = { ...base, id: "e1", reporterId: "r2", createdAt: new Date("2026-10-01T10:00:00Z") };
  const mine: Candidate = { ...base, id: "m1", reporterId: "r1", createdAt: new Date("2026-10-02T10:00:00Z") };
  const far: Candidate = { ...base, id: "f1", reporterId: "r3", addressKey: addressKey("9 Other Road", "Yaba", "Lagos"), lat: 6.52, lng: 3.38 };
  const r = findDuplicates(base, [earlier, mine, far], 50, 365, now);
  assert.equal(r.earliest?.id, "e1");
  assert.equal(r.sameReporter?.id, "m1");
  assert.equal(r.others.length, 1);
  // Same place by coordinates only, a different way of writing the address.
  const byPlace: Candidate = { ...base, id: "p1", reporterId: "r4", addressKey: "x|y|z", lat: 6.60185, lng: 3.35152 };
  assert.equal(findDuplicates(base, [byPlace], 50, 365, now).earliest?.id, "p1");
  assert.equal(findDuplicates(base, [{ ...byPlace, propertyType: "OFFICE" }], 50, 365, now).earliest, null, "a different kind of property nearby is not a duplicate");
  assert.equal(findDuplicates(base, [{ ...byPlace, bedrooms: 4 }], 50, 365, now).earliest, null, "a different size nearby is not a duplicate");
  assert.equal(findDuplicates(base, [{ ...earlier, createdAt: new Date("2025-01-01") }], 50, 365, now).earliest, null, "outside the window");
  const blank = { ...base, addressKey: "||", lat: null, lng: null };
  assert.equal(findDuplicates(blank, [{ ...blank, id: "b2", reporterId: "r9" }], 50, 365, now).earliest, null, "empty addresses never match");
});

test("warning signs are reasons to look and never a verdict", () => {
  const clean = { photoReused: false, textRepeated: false, rejectedRecently: 0, rejectFlag: 3, reportsToday: 1, perDay: 5, lat: 6.5, lng: 3.4 };
  assert.deepEqual(vacancySignals(clean), []);
  assert.deepEqual(vacancySignals({ ...clean, photoReused: true, textRepeated: true }), ["SAME_PHOTO", "SAME_TEXT"]);
  assert.deepEqual(vacancySignals({ ...clean, rejectedRecently: 3 }), ["REPEAT_REJECTIONS"]);
  assert.deepEqual(vacancySignals({ ...clean, reportsToday: 5 }), ["REPORT_BURST"]);
  assert.deepEqual(vacancySignals({ ...clean, lat: 40, lng: -3 }), ["OUTSIDE_COVERAGE"]);
  assert.equal(textHash("  The  SAME words "), textHash("the same words"));
  assert.notEqual(bytesHash(new Uint8Array([1, 2])), bytesHash(new Uint8Array([1, 3])));
});

test("an owner learns nothing about the reporter unless the reporter chose it, and small areas are not counted", () => {
  assert.equal(ownerFacingReporter({ showNameToOwner: false, reporterName: "Ada Obi" }), "A member of the community");
  assert.equal(ownerFacingReporter({ showNameToOwner: true, reporterName: "Ada Obi" }), "Ada Obi");
  assert.equal(areaCount(2), "fewer than 3");
  assert.equal(areaCount(3), "3");
});
