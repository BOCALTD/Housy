import { test } from "node:test";
import assert from "node:assert/strict";
import { noticeDue, openDuringMaintenance, phaseOf, windowProblem } from "../../src/lib/site-maintenance-rules";

const H = 3_600_000;
const now = new Date("2027-01-10T10:00:00Z");
const win = (startH: number, endH: number, notified = false, emergency = false) => ({ start: new Date(now.getTime() + startH * H), end: new Date(now.getTime() + endH * H), message: "", notifiedAt: notified ? now : null, emergency });

test("a window is scheduled, then in its 24-hour notice, then on, then over", () => {
  assert.equal(phaseOf(null, now), "none");
  assert.equal(phaseOf(win(30, 32), now), "scheduled");
  assert.equal(phaseOf(win(23, 25), now), "notice");
  assert.equal(phaseOf(win(-1, 2), now), "active");
  assert.equal(phaseOf(win(-3, -1), now), "over");
});

test("the notice goes out once, 24 hours before (at once for an emergency)", () => {
  assert.equal(noticeDue(win(30, 32), now), false);
  assert.equal(noticeDue(win(24, 26), now), true);
  assert.equal(noticeDue(win(23, 25, true), now), false, "only once");
  assert.equal(noticeDue(win(2, 4, false, true), now), true);
});

test("a window needs a day's notice unless it is an emergency, ends after it starts and lasts at most 72 hours", () => {
  assert.match(windowProblem(new Date(now.getTime() + 5 * H), new Date(now.getTime() + 6 * H), now, false)!, /24 hours/);
  assert.equal(windowProblem(new Date(now.getTime() + 5 * H), new Date(now.getTime() + 6 * H), now, true), null);
  assert.equal(windowProblem(new Date(now.getTime() + 25 * H), new Date(now.getTime() + 27 * H), now, false), null);
  assert.match(windowProblem(new Date(now.getTime() + 25 * H), new Date(now.getTime() + 25 * H), now, false)!, /end after/);
  assert.match(windowProblem(new Date(now.getTime() + 25 * H), new Date(now.getTime() + 100 * H), now, false)!, /72 hours/);
  assert.match(windowProblem(new Date(NaN), new Date(now.getTime()), now, false)!, /Enter when/);
});

test("administrators' pages, signing in and every /api address stay open during maintenance", () => {
  for (const p of ["/admin", "/admin/settings", "/login", "/auth/login", "/api/webhooks/paystack", "/api/cron/billing", "/api/health", "/legal/terms"]) assert.ok(openDuringMaintenance(p), p);
  for (const p of ["/", "/app", "/me", "/properties/ABC", "/pay/xyz", "/administrator", "/loginx"]) assert.equal(openDuringMaintenance(p), false, p);
});
