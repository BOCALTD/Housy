import { test } from "node:test";
import assert from "node:assert/strict";
import { smsWorthy, termiiDriver, twilioDriver } from "../../src/lib/services/sms";

const fake = (status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []) =>
  (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

test("only important notices go by text", () => {
  assert.equal(smsWorthy("security.new_sign_in"), true);
  assert.equal(smsWorthy("inspection.confirmed"), true);
  assert.equal(smsWorthy("billing.failed"), true);
  assert.equal(smsWorthy("reel.liked"), false);
  assert.equal(smsWorthy("inspection.confirmedx"), false);
  assert.equal(smsWorthy("promo.offer"), false);
});

test("Termii: sends without the plus, reads the message id, and treats bad keys as final", async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const ok = await termiiDriver("k", "Housy", fake(200, { message_id: "m1", code: "ok" }, seen)).send("+2348031234567", "Hello");
  assert.deepEqual(ok, { ok: true, id: "m1" });
  const sent = JSON.parse(String(seen[0].init!.body));
  assert.equal(sent.to, "2348031234567");
  assert.equal(sent.from, "Housy");
  const bad = await termiiDriver("k", "Housy", fake(401, { message: "Invalid key" })).send("+2348031234567", "Hi");
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.permanent, true);
  const down = await termiiDriver("k", "Housy", fake(503, {})).send("+2348031234567", "Hi");
  assert.equal(!down.ok && down.permanent, false, "a provider outage is retried");
  const thrown = await termiiDriver("k", "Housy", (async () => { throw new Error("offline"); }) as unknown as typeof fetch).send("+234", "Hi");
  assert.equal(!thrown.ok && thrown.permanent, false);
});

test("Twilio: basic auth, a phone number or a messaging service, and final errors for bad numbers", async () => {
  const seen: { url?: string; init?: RequestInit }[] = [];
  const sid = "AC" + "0".repeat(32);
  const ok = await twilioDriver(sid, "tok", "+15005550006", fake(201, { sid: "SM1" }, seen)).send("+2348031234567", "Hello");
  assert.deepEqual(ok, { ok: true, id: "SM1" });
  assert.match(String(seen[0].url), new RegExp(`/Accounts/${sid}/Messages.json$`));
  assert.equal((seen[0].init!.headers as Record<string, string>).Authorization, `Basic ${Buffer.from(`${sid}:tok`).toString("base64")}`);
  assert.equal(new URLSearchParams(String(seen[0].init!.body)).get("From"), "+15005550006");
  await twilioDriver(sid, "tok", "MG" + "a".repeat(32), fake(201, { sid: "SM2" }, seen)).send("+2348031234567", "Hi");
  assert.equal(new URLSearchParams(String(seen[1].init!.body)).get("MessagingServiceSid"), "MG" + "a".repeat(32));
  const unsub = await twilioDriver(sid, "tok", "+15005550006", fake(409, { code: 21610, message: "unsubscribed" })).send("+2348031234567", "Hi");
  assert.equal(!unsub.ok && unsub.permanent, true);
  const busy = await twilioDriver(sid, "tok", "+15005550006", fake(429, { code: 20429 })).send("+2348031234567", "Hi");
  assert.equal(!busy.ok && busy.permanent, false);
});
