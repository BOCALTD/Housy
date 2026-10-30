import { test } from "node:test";
import assert from "node:assert/strict";
import { quietReason } from "../../src/lib/follow-up-rules";

const now = new Date("2026-10-30T10:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 864e5);
const base = { status: "CONTACTED", timeline: "UNKNOWN", createdAt: ago(40), lastContactAt: ago(3), openFollowUp: false };

test("leads that have gone quiet are suggested, with the reason", () => {
  assert.equal(quietReason(base, now), null);
  assert.deepEqual(quietReason({ ...base, lastContactAt: ago(15) }, now), { level: "medium", days: 15, reason: "No contact for 15 days." });
  assert.equal(quietReason({ ...base, status: "QUALIFIED", lastContactAt: ago(20) }, now)?.level, "high");
  assert.equal(quietReason({ ...base, timeline: "IMMEDIATE", lastContactAt: ago(8) }, now)?.reason, "Wants to move now, but no contact for 8 days.");
  assert.equal(quietReason({ ...base, status: "NEW", lastContactAt: null, createdAt: ago(4) }, now)?.level, "high");
  assert.equal(quietReason({ ...base, status: "NEW", lastContactAt: null, createdAt: ago(0.5) }, now), null);
});

test("a planned follow-up or a closed lead is never suggested", () => {
  assert.equal(quietReason({ ...base, lastContactAt: ago(60), openFollowUp: true }, now), null);
  assert.equal(quietReason({ ...base, status: "LOST", lastContactAt: ago(60) }, now), null);
  assert.equal(quietReason({ ...base, status: "CONVERTED", lastContactAt: ago(60) }, now), null);
});
