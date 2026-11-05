import { test } from "node:test";
import assert from "node:assert/strict";
import { areaNames, fairStars, rankArtisans, servesPlace } from "../../src/lib/artisan-rules";

const base = { yearsExperience: null, verified: false, stars: 0, reviews: 0, jobsDone: 0 };

test("areas are matched by whole place names", () => {
  assert.deepEqual(areaNames("Lekki, Ajah and VI / Ikoyi"), ["lekki", "ajah", "vi", "ikoyi"]);
  assert.equal(servesPlace("VI, Ikoyi", "Plot 5, Adeola Odeku, VI, Lagos"), true);
  assert.equal(servesPlace("Lekki, Ajah", "12 Admiralty Way, Lekki Phase 1, Lagos"), true);
  assert.equal(servesPlace("Ikeja", "Lekki, Lagos"), false);
  assert.equal(servesPlace("Yaba", "Yabatech road, Lagos"), false, "part of a word is not a match");
  assert.equal(servesPlace("Abuja", "Wuse 2, Abuja, FCT"), true);
});

test("a few ratings are pulled toward the middle", () => {
  assert.equal(fairStars(0, 0), 0);
  assert.ok(fairStars(5, 1) < fairStars(4.6, 20));
  assert.ok(fairStars(5, 30) > 4.8);
});

test("the trade comes first, then the area, then trust", () => {
  const list = [
    { ...base, id: "painter-lekki", trades: ["painter"], areas: "Lekki" },
    { ...base, id: "sparky-ikeja", trades: ["electrician"], areas: "Ikeja", verified: true, stars: 4.9, reviews: 12, jobsDone: 12 },
    { ...base, id: "sparky-lekki", trades: ["electrician", "solar"], areas: "Lekki, Ajah" },
    { ...base, id: "sparky-lekki-rated", trades: ["electrician"], areas: "Lekki", stars: 4.7, reviews: 6, jobsDone: 6, verified: true },
  ];
  const r = rankArtisans(list, { trade: "electrician", place: "Admiralty Way, Lekki, Lagos" });
  assert.deepEqual(r.map((x) => x.id), ["sparky-lekki-rated", "sparky-lekki", "sparky-ikeja", "painter-lekki"]);
  assert.ok(r[0].reasons.includes("Works in your area"));
  assert.ok(r[0].reasons.includes("ID verified"));
  assert.equal(r[3].tradeMatch, false);
  // With no trade chosen, trust and area still order the list.
  const any = rankArtisans(list, { place: "Lekki" });
  assert.equal(any[0].id, "sparky-lekki-rated");
});
