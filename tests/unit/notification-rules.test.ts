import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_EMAIL_CAP, DEFAULT_PREFS, backoff, categoryOf, decide, dedupeKeyFor, inQuiet, lagosHour, quietEndsAt, readUnsub, signUnsub, unsubScopeFor } from "../../src/lib/notification-rules";

const at = (h: number) => new Date(Date.UTC(2026, 9, 16, h - 1, 30)); // h:30 in Lagos

test("categories keep security apart from optional mail", () => {
  assert.equal(categoryOf("security.password"), "ESSENTIAL");
  assert.equal(categoryOf("reward.restricted"), "ESSENTIAL");
  assert.equal(categoryOf("promo"), "PROMOTIONAL");
  assert.equal(categoryOf("message.new"), "ACTIVITY");
  assert.equal(unsubScopeFor("ESSENTIAL", "security"), null, "essential mail has no unsubscribe");
  assert.equal(unsubScopeFor("ACTIVITY", "alert.property"), "ALERTS");
});

test("quiet hours, including past midnight", () => {
  assert.equal(lagosHour(new Date("2026-10-16T21:30:00Z")), 22);
  assert.ok(inQuiet(23, 22, 7) && inQuiet(3, 22, 7) && !inQuiet(7, 22, 7) && !inQuiet(12, 22, 7));
  assert.ok(inQuiet(13, 12, 14) && !inQuiet(14, 12, 14));
  assert.equal(inQuiet(3, null, null), false);
  assert.equal(quietEndsAt(new Date("2026-10-16T21:30:00Z"), 7).toISOString(), "2026-10-17T06:00:00.000Z");
  assert.equal(quietEndsAt(new Date("2026-10-16T03:00:00Z"), 7).toISOString(), "2026-10-16T06:00:00.000Z");
});

test("decisions: essential always goes, optional follows the person's wishes", () => {
  const base = { kind: "message.new", category: "ACTIVITY" as const, pref: DEFAULT_PREFS, now: at(12), sentLast24h: 0, hasAddress: true };
  assert.equal(decide(base).action, "SEND");
  assert.equal(decide({ ...base, hasAddress: false }).action, "SKIP");
  assert.equal(decide({ ...base, pref: { ...DEFAULT_PREFS, emailActivity: false } }).action, "SKIP");
  assert.equal(decide({ ...base, kind: "alert.property", pref: { ...DEFAULT_PREFS, emailActivity: false } }).action, "SEND", "alerts have their own switch");
  assert.equal(decide({ ...base, kind: "alert.property", pref: { ...DEFAULT_PREFS, emailAlerts: false } }).action, "SKIP");
  assert.equal(decide({ ...base, category: "PROMOTIONAL", kind: "promo" }).action, "SKIP", "promotional mail needs an explicit opt-in");
  assert.equal(decide({ ...base, category: "PROMOTIONAL", kind: "promo", pref: { ...DEFAULT_PREFS, emailPromotional: true } }).action, "SEND");
  const quiet = { ...DEFAULT_PREFS, quietStart: 22, quietEnd: 7 };
  assert.equal(decide({ ...base, now: at(23), pref: quiet }).action, "DEFER");
  assert.equal(decide({ ...base, now: at(23), pref: quiet, category: "ESSENTIAL", kind: "security" }).action, "SEND", "security ignores quiet hours");
  assert.equal(decide({ ...base, pref: { ...DEFAULT_PREFS, digest: "DAILY" } }).action, "HOLD");
  assert.equal(decide({ ...base, sentLast24h: DAILY_EMAIL_CAP }).action, "HOLD", "overload waits for the digest");
  assert.equal(decide({ ...base, sentLast24h: 99, category: "ESSENTIAL", kind: "security" }).action, "SEND");
});

test("the same event on the same day is one email; retries back off", () => {
  const d = new Date("2026-10-16T10:00:00Z");
  assert.equal(dedupeKeyFor("u", "message.new", "/messages/1", d), dedupeKeyFor("u", "message.new", "/messages/1", new Date("2026-10-16T18:00:00Z")));
  assert.notEqual(dedupeKeyFor("u", "message.new", "/messages/1", d), dedupeKeyFor("u", "message.new", "/messages/2", d));
  assert.notEqual(dedupeKeyFor("u", "message.new", "/messages/1", d), dedupeKeyFor("v", "message.new", "/messages/1", d));
  assert.equal(dedupeKeyFor("u", "k", "r", d, "listing:1"), dedupeKeyFor("u", "x", "y", new Date("2027-01-01"), "listing:1"));
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => backoff(n) / 60000), [1, 5, 30, 120, 720, 720]);
});

test("unsubscribe links cannot be forged or changed", () => {
  const t = signUnsub("secret", "user-1", "ACTIVITY");
  assert.deepEqual(readUnsub("secret", t), { userId: "user-1", scope: "ACTIVITY" });
  assert.equal(readUnsub("other", t), null);
  const [body, sig] = t.split(".");
  const forged = Buffer.from("user-2|ACTIVITY").toString("base64url");
  assert.equal(readUnsub("secret", `${forged}.${sig}`), null);
  assert.equal(readUnsub("secret", "junk"), null);
  assert.equal(body.length > 0, true);
});

import { renderEmail, safeLink } from "../../src/lib/email-templates";
import { resendDriver } from "../../src/lib/email-drivers";

const layout = { baseUrl: "https://example.test", platform: "Platform", recipientName: "Ada", unsubscribeUrl: "https://example.test/unsubscribe?t=x", settingsUrl: "https://example.test/me/notification-settings" };

test("templates escape their values, block bad links and keep subjects on one line", () => {
  const r = renderEmail("generic", { title: "Hi\r\nBcc: x@y.z", body: "<script>alert(1)</script>", link: "javascript:alert(1)" }, layout);
  assert.ok(!/[\r\n]/.test(r.subject));
  assert.ok(!r.html.includes("<script>") && r.html.includes("&lt;script&gt;"));
  assert.ok(!r.html.includes("javascript:") && !r.text.includes("javascript:"));
  assert.equal(safeLink("https://a.test/", "/x"), "https://a.test/x");
  assert.equal(safeLink("https://a.test", "//evil.test"), null);
  const ok = renderEmail("generic", { title: "T", body: "B", link: "/messages/1" }, layout);
  assert.ok(ok.text.includes("https://example.test/messages/1"));
});

test("optional mail carries an unsubscribe link; essential mail explains why it has none", () => {
  assert.ok(renderEmail("generic", { title: "T" }, layout).text.includes("/unsubscribe?t=x"));
  const ess = renderEmail("security_notice", { title: "Password changed", body: "Your password was changed." }, { ...layout, unsubscribeUrl: null });
  assert.ok(!ess.text.includes("unsubscribe") && /cannot be switched off/.test(ess.text));
});

test("every named template renders", () => {
  const samples: Record<string, Record<string, unknown>> = {
    welcome: { name: "Ada" }, enquiry_received: { listing: "2 bed flat", from: "Tunde", message: "Is it available?" },
    property_alert: { title: "3 bed duplex", city: "Lekki", priceKobo: 5_000_000_00, bedrooms: 3, link: "/properties/P1", reason: "Matches your saved search" },
    availability_alert: { title: "Flat", change: "Now available", link: "/properties/P1" }, new_agent: { name: "Ola", city: "Ikeja" },
    rent_reminder: { property: "Flat 3", due: "1 Nov", amountKobo: 120_000_00 }, inspection_scheduled: { property: "Block A", when: "2 Nov" },
    review_request: { agent: "Ada", about: "your purchase", link: "/reviews/write?invite=t" }, security_notice: { title: "New sign-in" },
    digest: { items: [{ title: "A", body: "b", link: "/x" }, { title: "C" }] },
  };
  for (const [name, vars] of Object.entries(samples)) { const r = renderEmail(name, vars, layout); assert.ok(r.subject.length > 0 && r.text.length > 20 && r.html.includes("<html>"), name); }
  assert.ok(renderEmail("property_alert", samples.property_alert, layout).text.includes("₦5,000,000"));
});

test("the Resend driver reports success, retryable and permanent failures", async () => {
  const msg = { to: "a@b.test", subject: "s", text: "t", html: "<p>t</p>" };
  const mk = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.deepEqual(await resendDriver("k", "from@x.test", mk(200, { id: "m1" })).send(msg), { ok: true, id: "m1" });
  const bad = await resendDriver("k", "f@x.test", mk(422, { message: "invalid to" })).send(msg);
  assert.ok(!bad.ok && bad.permanent);
  const busy = await resendDriver("k", "f@x.test", mk(429, {})).send(msg);
  assert.ok(!busy.ok && !busy.permanent);
  const down = await resendDriver("k", "f@x.test", mk(503, {})).send(msg);
  assert.ok(!down.ok && !down.permanent);
  const net = await resendDriver("k", "f@x.test", (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch).send(msg);
  assert.ok(!net.ok && !net.permanent && /socket/.test(net.error));
});
