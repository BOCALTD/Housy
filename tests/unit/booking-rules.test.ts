import { test } from "node:test";
import assert from "node:assert/strict";
import { canMove, checkPing, checkRequestedTime, deadlineFor, defaultSeverity, dueForReminder, nextSteps, overdue, overlaps, sessionLive } from "../../src/lib/booking-rules";

const now = new Date("2026-10-22T10:00:00Z");
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);

test("booking steps follow the agreed order, and the person who asked can only cancel", () => {
  assert.ok(canMove("REQUESTED", "CONFIRMED", "COMPANY"));
  assert.ok(!canMove("REQUESTED", "COMPLETED", "COMPANY"), "cannot skip to completed");
  assert.ok(!canMove("CONFIRMED", "IN_PROGRESS", "COMPANY"), "must arrive first");
  assert.ok(canMove("CONFIRMED", "EN_ROUTE", "COMPANY") && canMove("EN_ROUTE", "ARRIVED", "COMPANY") && canMove("ARRIVED", "IN_PROGRESS", "COMPANY") && canMove("IN_PROGRESS", "COMPLETED", "COMPANY"));
  assert.ok(!canMove("COMPLETED", "CANCELLED", "COMPANY"), "finished is finished");
  assert.ok(canMove("RESCHEDULED", "CONFIRMED", "COMPANY"));
  assert.ok(canMove("CONFIRMED", "CANCELLED", "REQUESTER"));
  assert.ok(!canMove("REQUESTED", "CONFIRMED", "REQUESTER"));
  assert.ok(!canMove("ARRIVED", "CANCELLED", "REQUESTER"), "once the agent is there, the company records the outcome");
  assert.deepEqual(nextSteps("REQUESTED", "REQUESTER"), ["CANCELLED"]);
});

test("times: notice, limits, clashes and reminders", () => {
  assert.equal(checkRequestedTime(at(0.5), now), "Choose a time at least an hour from now");
  assert.equal(checkRequestedTime(at(3), now), null);
  assert.match(checkRequestedTime(at(24 * 100), now)!, /within the next/);
  assert.ok(checkRequestedTime(new Date("nonsense"), now));
  assert.ok(overlaps({ start: at(0), minutes: 60 }, { start: at(1), minutes: 30 }), "needs travel time between");
  assert.ok(!overlaps({ start: at(0), minutes: 60 }, { start: at(1.5), minutes: 30 }));
  assert.ok(dueForReminder({ status: "CONFIRMED", scheduledAt: at(20), remindedAt: null }, now));
  assert.ok(!dueForReminder({ status: "CONFIRMED", scheduledAt: at(20), remindedAt: now }, now));
  assert.ok(!dueForReminder({ status: "CONFIRMED", scheduledAt: at(48), remindedAt: null }, now));
  assert.ok(!dueForReminder({ status: "REQUESTED", scheduledAt: at(20), remindedAt: null }, now));
});

test("safety sessions stop on their own and reject nonsense", () => {
  assert.ok(sessionLive({ endedAt: null, expectedEndAt: at(-1) }, now), "still inside the two-hour grace");
  assert.ok(!sessionLive({ endedAt: null, expectedEndAt: at(-3) }, now), "never continues indefinitely");
  assert.ok(!sessionLive({ endedAt: now, expectedEndAt: at(1) }, now));
  assert.equal(checkPing({ lat: 6.45, lng: 3.39, accuracy: 20 }), null);
  assert.ok(checkPing({ lat: 95, lng: 3 }));
  assert.ok(checkPing({ lat: NaN, lng: 3 }));
});

test("cases: severity, deadlines and overdue", () => {
  assert.equal(defaultSeverity("INSPECTION_SAFETY"), "HIGH");
  assert.equal(defaultSeverity("OTHER"), "LOW");
  assert.equal(deadlineFor("CRITICAL", now).toISOString(), at(24).toISOString());
  assert.ok(overdue({ status: "OPEN", dueAt: at(-1) }, now));
  assert.ok(!overdue({ status: "ACTION_TAKEN", dueAt: at(-1) }, now));
});
