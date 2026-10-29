import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH, LADDER, afterFailure, lockHours, stateOf, waitText, type Guard } from "../../src/lib/login-lock-rules";

const H = 3_600_000;

test("locks last 4 hours, then 3 hours longer each time, up to 22; the round after that closes the account", () => {
  assert.deepEqual(LADDER, [4, 7, 10, 13, 16, 19, 22]);
  assert.equal(lockHours(1), 4); assert.equal(lockHours(7), 22); assert.equal(lockHours(8), null);
});

test("three wrong passwords lock the account; every round after a lock goes up the ladder until the ban", () => {
  let g: Guard = FRESH;
  let now = new Date("2026-11-01T08:00:00Z");
  const seen: string[] = [];
  for (let round = 1; round <= 8; round++) {
    for (let k = 1; k <= 3; k++) {
      assert.equal(stateOf(g, now).kind, "open");
      const r = afterFailure(g, now);
      g = r.guard;
      if (k < 3) { assert.equal(r.event, "counted"); assert.equal(r.triesLeft, 3 - k); }
      else seen.push(r.event === "locked" ? `${r.hours}h` : r.event);
    }
    const s = stateOf(g, now);
    if (round < 8) {
      assert.equal(s.kind, "locked");
      assert.equal((s as { until: Date }).until.getTime() - now.getTime(), lockHours(round)! * H);
      // Still locked a minute before the end, open again at the end.
      assert.equal(stateOf(g, new Date(now.getTime() + lockHours(round)! * H - 60_000)).kind, "locked");
      now = new Date(now.getTime() + lockHours(round)! * H);
    } else assert.equal(s.kind, "banned");
  }
  assert.deepEqual(seen, ["4h", "7h", "10h", "13h", "16h", "19h", "22h", "banned"]);
  assert.equal(stateOf(g, new Date("2030-01-01")).kind, "banned", "a ban does not wear off");
});

test("the wait reads in hours and minutes", () => {
  const now = new Date("2026-11-01T08:00:00Z");
  assert.equal(waitText(new Date(now.getTime() + 4 * H), now), "4 h");
  assert.equal(waitText(new Date(now.getTime() + 3 * H + 59 * 60_000 + 1), now), "4 h");
  assert.equal(waitText(new Date(now.getTime() + 45 * 60_000), now), "45 min");
  assert.equal(waitText(new Date(now.getTime() + 90 * 60_000), now), "1 h 30 min");
});
