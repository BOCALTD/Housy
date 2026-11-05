import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, timeLabel } from "../../src/lib/chat-shape";

test("chat day separators and times read like a phone chat (Lagos time)", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(dayLabel("2026-11-05T06:00:00Z", now), "Today");
  assert.equal(dayLabel("2026-11-04T20:00:00Z", now), "Yesterday");
  assert.equal(dayLabel("2026-11-02T10:00:00Z", now), "Monday");
  assert.match(dayLabel("2026-09-15T10:00:00Z", now), /15 September/);
  assert.match(dayLabel("2025-09-15T10:00:00Z", now), /2025/);
  assert.equal(timeLabel("2026-11-05T13:05:00Z"), "14:05");
});
