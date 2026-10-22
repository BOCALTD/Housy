import { test } from "node:test";
import assert from "node:assert/strict";
import { icsCalendar, icsEscape, icsFold } from "../../src/lib/ics";
import { bookingEvent } from "../../src/lib/inspection-calendar";

const now = new Date("2026-10-22T10:00:00Z");
const booking = {
  id: "11111111-2222-3333-4444-555555555555", ref: "INS-ABC123", status: "CONFIRMED", scheduledAt: new Date("2026-10-25T09:00:00Z"), durationMinutes: 45,
  meetingPoint: "Estate gate, Palm Grove", rescheduleCount: 2, updatedAt: now, requesterName: "Seyi",
};
const listing = { title: "3-bed flat, Lekki; with BQ", city: "Lekki", state: "Lagos" };

test("text is escaped and long lines are folded at 75 bytes without splitting characters", () => {
  assert.equal(icsEscape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const folded = icsFold("DESCRIPTION:" + "₦".repeat(60));
  for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), "DESCRIPTION:" + "₦".repeat(60));
});

test("a confirmed inspection becomes one event with the right times, place, reminder and update counter", () => {
  const e = bookingEvent(booking, listing, "REQUESTER", { origin: "https://example.test", meetingWith: "Ada Demo" })!;
  const ics = icsCalendar("Inspection", [e], now);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /DTSTART:20261025T090000Z/);
  assert.match(ics, /DTEND:20261025T094500Z/);
  assert.match(ics, /UID:11111111-2222-3333-4444-555555555555@housy-inspections/);
  assert.match(ics, /SEQUENCE:2/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /SUMMARY:Property inspection: 3-bed flat\\, Lekki\\; with BQ/);
  assert.match(ics.replace(/\r\n /g, ""), /Meeting you: Ada Demo/);
  assert.match(ics.replace(/\r\n /g, ""), /never pay money at an inspection/);
  assert.match(ics.replace(/\r\n /g, ""), /URL:https:\/\/example.test\/me\/inspections\/INS-ABC123/);
  assert.ok(!ics.split("\r\n").some((l) => Buffer.byteLength(l, "utf8") > 75));
});

test("staff see the visitor's name but not their phone, and a link to the booking", () => {
  const e = bookingEvent(booking, listing, "STAFF", { origin: "https://example.test" })!;
  assert.match(e.title, /^Inspection INS-ABC123:/);
  assert.match(e.description!, /Visitor: Seyi/);
  assert.equal(e.url, "https://example.test/app/bookings/11111111-2222-3333-4444-555555555555");
});

test("an unconfirmed request has no event; a cancelled one is marked cancelled with no reminder", () => {
  assert.equal(bookingEvent({ ...booking, status: "REQUESTED" }, listing, "REQUESTER", { origin: "x" }), null);
  assert.equal(bookingEvent({ ...booking, scheduledAt: null }, listing, "REQUESTER", { origin: "x" }), null);
  const ics = icsCalendar("x", [bookingEvent({ ...booking, status: "CANCELLED" }, listing, "REQUESTER", { origin: "x" })!], now);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SUMMARY:Cancelled: /);
  assert.doesNotMatch(ics, /VALARM/);
});
