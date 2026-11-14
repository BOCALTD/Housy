import { test } from "node:test";
import assert from "node:assert/strict";
import { endOfLagosDay, fromLagosLocal, toLagosLocal, todayInLagos, zoneOffsetMinutes, zonedToUtc } from "../../src/lib/dates";
import { lagosToUtc } from "../../src/lib/deal-rules";
import { lagosHour, quietEndsAt } from "../../src/lib/notification-rules";
import { liveChatId, liveChatPlaceOf } from "../../src/lib/services/platform-config";
import { payoutRate } from "../../src/lib/verification-finance-rules";

test("wall-clock times are read and shown in any time zone, daylight saving included; Lagos when none is given", () => {
  assert.equal(zoneOffsetMinutes("Africa/Lagos", new Date("2026-07-01T12:00:00Z")), 60);
  assert.equal(zoneOffsetMinutes("America/New_York", new Date("2026-07-01T12:00:00Z")), -240, "summer time");
  assert.equal(zoneOffsetMinutes("America/New_York", new Date("2026-12-01T12:00:00Z")), -300, "winter time");
  assert.equal(zonedToUtc("2026-07-01T09:30", "America/New_York").toISOString(), "2026-07-01T13:30:00.000Z");
  assert.equal(zonedToUtc("2026-12-01T09:30", "Europe/London").toISOString(), "2026-12-01T09:30:00.000Z");
  assert.equal(fromLagosLocal("2026-12-01T09:30").toISOString(), "2026-12-01T08:30:00.000Z", "Lagos outside a request");
  assert.equal(fromLagosLocal("2026-12-01T09:30", "Asia/Dubai").toISOString(), "2026-12-01T05:30:00.000Z");
  assert.equal(toLagosLocal(new Date("2026-07-01T13:30:00Z"), "America/New_York"), "2026-07-01T09:30");
  assert.equal(endOfLagosDay("2026-05-03", "Europe/London").toISOString(), "2026-05-03T22:59:59.999Z", "midnight in London (summer)");
  assert.equal(endOfLagosDay("2026-05-03").toISOString(), "2026-05-03T22:59:59.999Z", "midnight in Lagos");
  assert.equal(todayInLagos(new Date("2026-12-01T03:00:00Z"), "America/Los_Angeles").toISOString().slice(0, 10), "2026-11-30");
  assert.equal(lagosToUtc("2026-12-01", "09:00", "Australia/Sydney").toISOString(), "2026-11-30T22:00:00.000Z");
  assert.equal(lagosToUtc("2026-12-01", "09:00").toISOString(), "2026-12-01T08:00:00.000Z");
});

test("quiet hours are kept in the person's own time zone", () => {
  const now = new Date("2026-12-01T03:00:00Z"); // 22:00 the day before in New York
  assert.equal(lagosHour(now, "America/New_York"), 22);
  assert.equal(lagosHour(now), 4, "Lagos when none is given");
  assert.equal(quietEndsAt(now, 7, "America/New_York").toISOString(), "2026-12-01T12:00:00.000Z", "7 a.m. in New York");
  assert.equal(quietEndsAt(now, 7).toISOString(), "2026-12-01T06:00:00.000Z", "7 a.m. in Lagos");
});

test("live chat widget IDs are read from what the administrator pastes, and the chat never shows on admin pages", () => {
  assert.equal(liveChatId("tawk", "https://tawk.to/chat/5f1a2b3c4d5e6f7a8b9c0d1e/1h2ij3kl4"), "5f1a2b3c4d5e6f7a8b9c0d1e/1h2ij3kl4");
  assert.equal(liveChatId("tawk", "5f1a2b3c4d5e6f7a8b9c0d1e"), null, "needs the widget part too");
  assert.equal(liveChatId("crisp", " 1A2B3C4D-1234-5678-9ABC-1234567890AB "), "1a2b3c4d-1234-5678-9abc-1234567890ab");
  assert.equal(liveChatId("tidio", "//code.tidio.co/abcdefghij0123456789abcdefghij01.js"), "abcdefghij0123456789abcdefghij01");
  assert.equal(liveChatId("intercom", "abc12def"), "abc12def");
  assert.equal(liveChatId("intercom", "<script>"), null);
  assert.equal(liveChatPlaceOf("/admin/settings"), null);
  assert.equal(liveChatPlaceOf("/app/leases"), "app");
  assert.equal(liveChatPlaceOf("/me/billing"), "me");
  assert.equal(liveChatPlaceOf("/properties/ABC"), "public");
});

test("a payout abroad states the rate it was made at", () => {
  assert.equal(payoutRate(158_025_000n, 100_000n, "USD"), "₦1,580.25 to 1 USD");
  assert.equal(payoutRate(200_000_000n, 99_700n, "GBP"), "₦2,006.01 to 1 GBP");
});
