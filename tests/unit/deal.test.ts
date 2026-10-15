import { test } from "node:test";
import assert from "node:assert/strict";
import { lagosToUtc, offerAcceptable, offerGapBps, overlaps, slotProblem, stageMoveProblem } from "../../src/lib/deal-rules";

test("stages move forward one step at a time and agreed or completed only through their own steps", () => {
  assert.equal(stageMoveProblem("ENQUIRY", "VIEWING", "OPEN", ""), null);
  assert.match(stageMoveProblem("ENQUIRY", "NEGOTIATION", "OPEN", "")!, /one stage/);
  assert.match(stageMoveProblem("NEGOTIATION", "AGREED", "OPEN", "")!, /accepted and approved/);
  assert.match(stageMoveProblem("OFFER", "AGREED", "OPEN", "")!, /accepted and approved/);
  assert.match(stageMoveProblem("LEGAL", "COMPLETED", "OPEN", "")!, /second person/);
  assert.equal(stageMoveProblem("AGREED", "LEGAL", "OPEN", ""), null);
  assert.match(stageMoveProblem("LEGAL", "NEGOTIATION", "OPEN", "because")!, /reopen/);
  assert.match(stageMoveProblem("OFFER", "VIEWING", "OPEN", "")!, /why/);
  assert.equal(stageMoveProblem("OFFER", "VIEWING", "OPEN", "Client wants another look"), null);
  assert.match(stageMoveProblem("OFFER", "NEGOTIATION", "ON_HOLD", "")!, /on hold/);
  assert.match(stageMoveProblem("OFFER", "OFFER", "OPEN", "")!, /already/);
});

test("Lagos appointment times convert to UTC and impossible dates are refused", () => {
  assert.equal(lagosToUtc("2026-11-02", "09:30").toISOString(), "2026-11-02T08:30:00.000Z");
  assert.equal(lagosToUtc("2026-11-02", "00:15").toISOString(), "2026-11-01T23:15:00.000Z");
  assert.throws(() => lagosToUtc("2026-02-30", "10:00"), /real date/);
  assert.throws(() => lagosToUtc("2026-11-02", "25:00"), /valid time/);
  assert.throws(() => lagosToUtc("", "10:00"), /date and time/);
});

test("overlapping slots clash but back-to-back ones do not, and slots are bounded", () => {
  const s = (a: string, b: string) => ({ startsAt: new Date(a), endsAt: new Date(b) });
  assert.equal(overlaps(s("2026-11-02T09:00Z", "2026-11-02T10:00Z"), s("2026-11-02T09:30Z", "2026-11-02T10:30Z")), true);
  assert.equal(overlaps(s("2026-11-02T09:00Z", "2026-11-02T10:00Z"), s("2026-11-02T10:00Z", "2026-11-02T11:00Z")), false);
  assert.equal(overlaps(s("2026-11-02T09:00Z", "2026-11-02T12:00Z"), s("2026-11-02T10:00Z", "2026-11-02T11:00Z")), true);
  const now = new Date("2026-11-01T12:00Z");
  assert.match(slotProblem(s("2026-11-02T09:00Z", "2026-11-02T09:05Z"), now)!, /10 minutes/);
  assert.match(slotProblem(s("2026-10-31T09:00Z", "2026-10-31T10:00Z"), now)!, /past/);
  assert.equal(slotProblem(s("2026-11-02T09:00Z", "2026-11-02T09:30Z"), now), null);
});

test("an offer is acceptable only while open and unexpired, and the gap to asking is in basis points", () => {
  const today = new Date("2026-11-02");
  assert.equal(offerAcceptable({ status: "OPEN", validUntil: null }, today), null);
  assert.equal(offerAcceptable({ status: "OPEN", validUntil: new Date("2026-11-02") }, today), null);
  assert.match(offerAcceptable({ status: "OPEN", validUntil: new Date("2026-11-01") }, today)!, /expired/);
  assert.match(offerAcceptable({ status: "COUNTERED", validUntil: null }, today)!, /open offer/);
  assert.equal(offerGapBps(10_000_000_00n, 9_000_000_00n), -1000);
  assert.equal(offerGapBps(10_000_000_00n, 10_000_000_00n), 0);
  assert.equal(offerGapBps(3n, 2n), -3333);
  assert.equal(offerGapBps(3n, 4n), 3333);
});
