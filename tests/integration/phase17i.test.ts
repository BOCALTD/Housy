/**
 * Phase 17i: push notifications. Devices belong to their person, notices are queued with every notification (never promotions),
 * and the sending job delivers, retries, and forgets devices the browser has dropped.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { notify } from "../../src/lib/services/notifications";
import { addDevice, myDevices, processPushQueue, removeDevice, sendTestPush } from "../../src/lib/services/push";
import type { PushMessage, PushSubscriptionKeys } from "../../src/lib/webpush";

after(() => prisma.$disconnect());

async function person(label: string) {
  const { userId } = await registerSeeker({ name: `${label} Person`, email: `${label}-${randomUUID().slice(0, 8)}@example.test`, password: "integration-test-pw" });
  return userId;
}
function browser() {
  const ua = createECDH("prime256v1"); ua.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, p256dh: ua.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url"), label: "Test · Chrome" };
}
const queued = (userId: string) => withPlatformAdmin("system", (tx) => tx.pushOutbox.findMany({ where: { userId } }));

test("devices are private to their person, and a browser moves to whoever signs in on it", async () => {
  const a = await person("push-a"), b = await person("push-b");
  await assert.rejects(addDevice(a, { ...browser(), endpoint: "https://evil.example/collect" }), /not accepted/);
  await assert.rejects(addDevice(a, { ...browser(), p256dh: "x".repeat(87) }), /not accepted/);
  const dev = browser();
  await addDevice(a, dev);
  await addDevice(a, dev); // the same browser again replaces, not duplicates
  assert.equal((await myDevices(a)).length, 1);
  assert.equal((await myDevices(b)).length, 0);
  assert.equal(await withUser(b, (tx) => tx.pushSubscription.count()), 0, "another person cannot read it");
  await addDevice(b, dev);
  assert.equal((await myDevices(a)).length, 0, "the browser now belongs to b");
  assert.equal((await myDevices(b)).length, 1);
  await removeDevice(b, dev.endpoint);
  assert.equal((await myDevices(b)).length, 0);
  // People cannot read the queue.
  assert.equal(await withUser(a, (tx) => tx.pushOutbox.count()), 0);
});

test("the job sends to every device, never sends promotions, forgets dropped devices and retries failures", async () => {
  const u = await person("push-job");
  const phone = browser(), laptop = browser();
  await addDevice(u, phone);
  await addDevice(u, laptop);
  await withUser(u, (tx) => notify(tx, u, { kind: "inspection.confirmed", title: "Inspection confirmed", body: "Saturday 10:00", link: "/me/inspections/INS-1", email: false }));
  await withUser(u, (tx) => notify(tx, u, { kind: "promo.weekend", title: "Big weekend offer", email: false }));
  assert.deepEqual((await queued(u)).map((q) => q.title), ["Inspection confirmed"], "promotions are not queued");

  const got: { to: string; msg: PushMessage }[] = [];
  const statusFor = new Map<string, number>([[phone.endpoint, 201], [laptop.endpoint, 410]]);
  const sender = async (s: PushSubscriptionKeys, msg: PushMessage) => { got.push({ to: s.endpoint, msg }); return { status: statusFor.get(s.endpoint) ?? 201 }; };
  await processPushQueue(sender);
  const mine = got.filter((g) => g.to === phone.endpoint || g.to === laptop.endpoint);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine[0].msg, { title: "Inspection confirmed", body: "Saturday 10:00", url: "/me/inspections/INS-1", tag: "inspection.confirmed" });
  assert.deepEqual((await myDevices(u)).map((d) => d.endpoint), [phone.endpoint], "the dropped laptop is forgotten");
  assert.ok((await myDevices(u))[0].lastSuccessAt);
  assert.ok((await queued(u))[0].sentAt);

  // A temporary failure is retried, and given up after five tries.
  await withUser(u, (tx) => notify(tx, u, { kind: "message.new", title: "New message", link: "https://evil.example/x", email: false }));
  const failing = async (s: PushSubscriptionKeys, msg: PushMessage) => { if (s.endpoint === phone.endpoint) got.push({ to: s.endpoint, msg }); return { status: 503 }; };
  await processPushQueue(failing);
  const row = (await queued(u)).find((q) => q.title === "New message")!;
  assert.equal(row.sentAt, null);
  assert.equal(row.attempts, 1);
  assert.equal(got[got.length - 1].msg.url, "/me/notifications", "only links inside the site are used");
  for (let i = 0; i < 5; i++) await processPushQueue(failing);
  assert.equal((await queued(u)).find((q) => q.title === "New message"), undefined, "dropped after five tries");
});

test("a person with no device gets nothing queued for long, and nothing is sent without keys", async () => {
  const u = await person("push-none");
  await withUser(u, (tx) => notify(tx, u, { kind: "review.new", title: "New review", email: false }));
  assert.equal((await queued(u)).length, 1);
  await processPushQueue(async () => ({ status: 201 }));
  assert.equal((await queued(u)).length, 0, "no device: the message is dropped");
  const prev = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const s = await processPushQueue(null);
  assert.equal(s.configured, false);
  await addDevice(u, browser());
  await assert.rejects(sendTestPush(u), /not set up/);
  assert.deepEqual(await sendTestPush(u, async () => ({ status: 201 })), { devices: 1, delivered: 1 });
  if (prev.pub) process.env.VAPID_PUBLIC_KEY = prev.pub;
  if (prev.priv) process.env.VAPID_PRIVATE_KEY = prev.priv;
});
