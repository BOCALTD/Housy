/**
 * Phase 13a: the notification core. Queueing and duplicate suppression, personal settings, quiet hours, daily limits and digests,
 * essential versus optional mail, retries and dead letters, unsubscribe links, and a provider that is not connected.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { notify } from "../../src/lib/services/notifications";
import { applyUnsubscribe, deliveryStats, failureList, getPrefs, processOutbox, retryEmails, savePrefs, unsubscribeUrl } from "../../src/lib/services/delivery";
import { DAILY_EMAIL_CAP } from "../../src/lib/notification-rules";
import type { EmailDriver, Outgoing, SendResult } from "../../src/lib/email-drivers";
import { newPlatformAdmin, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
let adminOnce: ReturnType<typeof newPlatformAdmin> | null = null;
const ADMIN = () => (adminOnce ??= newPlatformAdmin());

async function person(label = "mail") {
  const email = `${label}-${uid()}@example.test`.toLowerCase();
  const id = (await registerSeeker({ name: `${label} Person ${uid()}`, email, password: PASSWORD })).userId;
  // The welcome email is not what these tests are about.
  const admin = await ADMIN();
  await withPlatformAdmin(admin.id, (tx) => tx.emailOutbox.updateMany({ where: { userId: id }, data: { status: "SKIPPED", skipReason: "test" } }));
  return { id, email };
}
const send = (userId: string, kind: string, title: string, link = `/x/${uid()}`) => withPlatformAdmin("system", (tx) => notify(tx, userId, { kind, title, body: "body text", link }));

function fake(behave: (m: Outgoing, n: number) => SendResult | Promise<SendResult> = (_m, n) => ({ ok: true, id: `m${n}` })) {
  const calls: Outgoing[] = [];
  const driver: EmailDriver = { name: "fake", async send(m) { calls.push(m); return behave(m, calls.length); } };
  return { driver, calls, to: (email: string) => calls.filter((c) => c.to === email) };
}
const rowsOf = (userId: string) => withPlatformAdmin("system", (tx) => tx.emailOutbox.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }));

test("with no provider connected nothing is sent and nothing is marked as sent", async () => {
  const p = await person();
  await send(p.id, "message.new", "New message");
  const r = await processOutbox({ driver: null });
  assert.equal(r.configured, false);
  assert.ok(r.waiting >= 1);
  assert.equal((await rowsOf(p.id)).filter((x) => x.status === "SKIPPED").length, 1, "only the welcome flushed in setup");
  assert.equal((await rowsOf(p.id)).filter((x) => x.status === "QUEUED").length, 1);
  const admin = await ADMIN();
  assert.equal((await deliveryStats(admin.id)).configured, false);
});

test("a notice is queued once per event per day; the in-app notice always appears", async () => {
  const p = await person();
  await send(p.id, "message.new", "New message", "/messages/abc");
  await send(p.id, "message.new", "New message", "/messages/abc");
  await send(p.id, "message.new", "New message", "/messages/def");
  assert.equal((await rowsOf(p.id)).filter((x) => x.status === "QUEUED").length, 2, "the repeat was dropped");
  assert.equal((await withUser(p.id, (tx) => tx.notification.count({ where: { userId: p.id } }))), 3, "all three are in the app");
  const admin = await ADMIN();
  assert.ok(((await deliveryStats(admin.id)).outcomes.DEDUPED ?? 0) >= 1);
});

test("sending: personal, with the right unsubscribe handling, and a duplicate run cannot send twice", async () => {
  const p = await person("Ada");
  await send(p.id, "message.new", "New message from Tunde", "/messages/1");
  await send(p.id, "security.password", "Your password was changed", "/me");
  const f = fake();
  const [a, b] = await Promise.all([processOutbox({ driver: f.driver }), processOutbox({ driver: f.driver })]);
  const mine = f.to(p.email);
  assert.equal(mine.length, 2, "each email went out once even with two runs at the same time");
  assert.ok(a.sent + b.sent >= 2);
  const msg = mine.find((m) => /New message/.test(m.subject))!;
  assert.match(msg.text, /Hello Ada,/);
  assert.match(msg.text, /\/unsubscribe\?t=/);
  assert.ok(msg.headers?.["List-Unsubscribe"]?.includes("/unsubscribe?t="));
  const sec = mine.find((m) => /password/.test(m.subject))!;
  assert.ok(!/unsubscribe/.test(sec.text) && !sec.headers?.["List-Unsubscribe"], "security mail has no unsubscribe");
  const rows = await rowsOf(p.id);
  assert.equal(rows.filter((r) => r.status === "SENT").length, 2);
  assert.ok(rows.every((r) => r.status !== "SENT" || (r.provider === "fake" && r.providerMessageId)));
});

test("personal choices: optional mail is skipped when switched off; promotions need an opt-in; security always goes", async () => {
  const p = await person();
  await savePrefs(p.id, { emailActivity: false, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: "" as never, quietEnd: "" as never, areas: " Lekki, lekki , Ikeja " });
  assert.deepEqual((await getPrefs(p.id)).areas, ["lekki", "ikeja"]);
  await send(p.id, "message.new", "Chat", "/m/1");
  await send(p.id, "promo", "Big sale", "/p/1");
  await send(p.id, "billing", "Your invoice", "/b/1");
  const f = fake();
  await processOutbox({ driver: f.driver });
  assert.deepEqual(f.to(p.email).map((m) => m.subject), ["Your invoice"]);
  const rows = await rowsOf(p.id);
  assert.equal(rows.filter((r) => r.status === "SKIPPED" && r.skipReason !== "test").length, 2);
  // Opting in to promotions works, and is never preselected.
  assert.equal((await getPrefs((await person()).id)).emailPromotional, false);
  await savePrefs(p.id, { emailActivity: true, emailAlerts: true, emailPromotional: true, digest: "INSTANT", quietStart: "" as never, quietEnd: "" as never, areas: "" });
  await send(p.id, "promo", "Another sale", "/p/2");
  const g = fake();
  await processOutbox({ driver: g.driver });
  assert.deepEqual(g.to(p.email).map((m) => m.subject), ["Another sale"]);
  await assert.rejects(savePrefs(p.id, { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: "22" as never, quietEnd: "" as never, areas: "" }), /both/);
  await assert.rejects(savePrefs(p.id, { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: "7" as never, quietEnd: "7" as never, areas: "" }), /same time/);
});

test("quiet hours hold optional mail until they end, but never security mail", async () => {
  const p = await person();
  await savePrefs(p.id, { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: "22" as never, quietEnd: "7" as never, areas: "" });
  await send(p.id, "message.new", "Late chat", "/m/late");
  await send(p.id, "security.signin", "New sign-in", "/s/late");
  // The next 22:30 UTC, which is 23:30 in Lagos.
  const night = new Date();
  night.setUTCHours(22, 30, 0, 0);
  if (night.getTime() <= Date.now() + 1000) night.setUTCDate(night.getUTCDate() + 1);
  const f = fake();
  const r = await processOutbox({ driver: f.driver, now: night });
  assert.ok(r.deferred >= 1);
  assert.deepEqual(f.to(p.email).map((m) => m.subject), ["New sign-in"]);
  const wait = (await rowsOf(p.id)).find((r2) => r2.kind === "message.new")!;
  assert.equal(wait.status, "QUEUED");
  assert.ok(wait.nextAttemptAt.getTime() > Date.now());
  // After the quiet period it goes.
  const morning = new Date(wait.nextAttemptAt.getTime() + 60_000);
  const g = fake();
  await processOutbox({ driver: g.driver, now: morning });
  assert.deepEqual(g.to(p.email).map((m) => m.subject), ["Late chat"]);
});

test("overload: after the daily limit the rest wait and arrive as one digest, not a flood", async () => {
  const p = await person();
  const total = DAILY_EMAIL_CAP + 9;
  for (let i = 0; i < total; i++) await send(p.id, "message.new", `Chat ${i}`, `/m/${i}`);
  const f = fake();
  const r = await processOutbox({ driver: f.driver });
  const mine = f.to(p.email);
  assert.equal(mine.filter((m) => !/update/.test(m.subject)).length, DAILY_EMAIL_CAP);
  const digests = mine.filter((m) => /updates? for you/.test(m.subject));
  assert.equal(digests.length, 1, "one digest carries the rest");
  assert.ok(digests[0].text.includes("Chat"));
  assert.ok(r.held >= 9 && r.digests >= 1);
  const rows = await rowsOf(p.id);
  assert.equal(rows.filter((x) => x.status === "DIGESTED").length, 9);
  // A later run does not send another digest straight away.
  await send(p.id, "message.new", "One more", "/m/more");
  const g = fake();
  await processOutbox({ driver: g.driver });
  assert.equal(g.to(p.email).length, 0, "still over the limit and the digest is not due again yet");
  assert.ok(mine.length <= DAILY_EMAIL_CAP + 1);
});

test("a person who chose a daily digest gets one email, not many", async () => {
  const p = await person();
  await savePrefs(p.id, { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "DAILY", quietStart: "" as never, quietEnd: "" as never, areas: "" });
  for (let i = 0; i < 4; i++) await send(p.id, "collab.task", `Task ${i}`, `/c/${i}`);
  await send(p.id, "reward.restricted", "Rewards paused", "/rewards");
  const f = fake();
  await processOutbox({ driver: f.driver });
  const subjects = f.to(p.email).map((m) => m.subject);
  assert.equal(subjects.length, 2);
  assert.ok(subjects.includes("Rewards paused"), "essential mail is never batched");
  assert.ok(subjects.some((s) => /4 updates/.test(s)));
});

test("failures are retried with delays, give up after five tries, and can be retried by the administrator", async () => {
  const admin = await ADMIN();
  const p = await person();
  await send(p.id, "message.new", "Will fail", "/f/1");
  let now = new Date();
  const bad = fake(() => ({ ok: false, permanent: false, error: "503 provider unavailable" }));
  let r = await processOutbox({ driver: bad.driver, now });
  assert.ok(r.retrying >= 1);
  let row = (await rowsOf(p.id)).find((x) => x.kind === "message.new")!;
  assert.equal(row.status, "FAILED");
  assert.equal(row.attempts, 1);
  assert.match(row.lastError, /503/);
  assert.ok(row.nextAttemptAt.getTime() > now.getTime());
  // Too soon: not tried again.
  const before = bad.to(p.email).length;
  await processOutbox({ driver: bad.driver, now: new Date(now.getTime() + 10_000) });
  assert.equal(bad.to(p.email).length, before);
  assert.ok((await failureList(admin.id)).rows.some((x) => x.id === row.id), "the administrator can see it");
  // Keep failing until it gives up.
  for (let i = 0; i < 4; i++) { now = new Date(now.getTime() + 13 * 3600_000); await processOutbox({ driver: bad.driver, now }); }
  row = (await rowsOf(p.id)).find((x) => x.kind === "message.new")!;
  assert.equal(row.status, "DEAD");
  assert.equal(row.attempts, 5);
  await processOutbox({ driver: bad.driver, now: new Date(now.getTime() + 99 * 3600_000) });
  assert.equal((await rowsOf(p.id)).find((x) => x.kind === "message.new")!.attempts, 5, "a dead email is not tried again by itself");
  // The administrator retries it, and this time it works.
  assert.equal(await retryEmails(admin.id, [row.id]), 1);
  await assert.rejects(retryEmails(p.id, "DEAD"), /Only the platform administrator/);
  const good = fake();
  await processOutbox({ driver: good.driver });
  assert.equal(good.to(p.email).length, 1);
  assert.equal((await rowsOf(p.id)).find((x) => x.kind === "message.new")!.status, "SENT");
});

test("a refusal that cannot be fixed by trying again goes straight to the dead list", async () => {
  const p = await person();
  await send(p.id, "message.new", "Bad address", "/f/2");
  const f = fake(() => ({ ok: false, permanent: true, error: "422 invalid recipient" }));
  const r = await processOutbox({ driver: f.driver });
  assert.ok(r.dead >= 1);
  assert.equal((await rowsOf(p.id)).find((x) => x.kind === "message.new")!.status, "DEAD");
  assert.equal(f.to(p.email).length, 1);
});

test("unsubscribe links work for the right scope only and cannot be forged", async () => {
  const p = await person();
  assert.equal(await applyUnsubscribe("not-a-token"), null);
  assert.equal(await applyUnsubscribe(`${Buffer.from(`${p.id}|ALL_OPTIONAL`).toString("base64url")}.forged`), null);
  assert.equal((await getPrefs(p.id)).emailActivity, true);
  const url = unsubscribeUrl(p.id, "ACTIVITY");
  assert.equal(await applyUnsubscribe(new URL(url).searchParams.get("t")!), "ACTIVITY");
  const prefs = await getPrefs(p.id);
  assert.equal(prefs.emailActivity, false);
  assert.equal(prefs.emailAlerts, true, "other switches are untouched");
  await send(p.id, "message.new", "Muted chat", "/m/mute");
  await send(p.id, "security.password", "Password changed", "/me");
  const f = fake();
  await processOutbox({ driver: f.driver });
  assert.deepEqual(f.to(p.email).map((m) => m.subject), ["Password changed"]);
  assert.equal(await applyUnsubscribe(new URL(unsubscribeUrl(p.id, "ALL_OPTIONAL")).searchParams.get("t")!), "ALL_OPTIONAL");
  assert.equal((await getPrefs(p.id)).emailAlerts, false);
});

test("administrator figures add up", async () => {
  const admin = await ADMIN();
  const s = await deliveryStats(admin.id);
  assert.ok(s.total > 0 && s.sent > 0);
  assert.ok(s.byTemplate.length > 0 && s.perDay.length > 0);
  assert.ok(s.successRate == null || (s.successRate >= 0 && s.successRate <= 1));
  await assert.rejects(deliveryStats((await person()).id), /Only the platform administrator/);
});
