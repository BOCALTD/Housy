import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { allowedEndpoint, encryptPayload, generateVapidKeys, validSubscription, vapidAuthorization, vapidFromEnv, verifyVapid } from "../../src/lib/webpush";

/** What a browser does on receiving a push: decrypt with its own private key and auth secret (RFC 8291). */
function browserDecrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("a message encrypted for a browser can be read only with that browser's keys", () => {
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const auth = randomBytes(16);
  const sub = { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const msg = JSON.stringify({ title: "Inspection confirmed ₦", body: "Saturday 10:00", url: "/me/inspections/INS-1" });
  const body = encryptPayload(sub, Buffer.from(msg));
  assert.equal(browserDecrypt(body, ua, auth), msg);
  const other = createECDH("prime256v1"); other.generateKeys();
  assert.throws(() => browserDecrypt(body, other, auth));
  assert.throws(() => browserDecrypt(body, ua, randomBytes(16)));
});

test("VAPID: generated keys sign a token the public key verifies, scoped to the push service", () => {
  const k = generateVapidKeys();
  const keys = { ...k, subject: "mailto:ops@example.test" };
  const h = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, new Date("2026-10-22T10:00:00Z"));
  assert.ok(verifyVapid(h, k.publicKey));
  const claims = JSON.parse(Buffer.from(h.split(" t=")[1].split(".")[1], "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:ops@example.test");
  assert.equal(claims.exp, Math.floor(Date.parse("2026-10-22T10:00:00Z") / 1000) + 12 * 3600);
  assert.ok(!verifyVapid(h, generateVapidKeys().publicKey));
  assert.deepEqual(vapidFromEnv({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, SUPPORT_EMAIL: "help@x.test" }), { publicKey: k.publicKey, privateKey: k.privateKey, subject: "mailto:help@x.test" });
  assert.equal(vapidFromEnv({}), null);
});

test("only real push services are accepted as endpoints", () => {
  for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/QX", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.ok(allowedEndpoint(ok), ok);
  for (const bad of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.test/x", "https://evilpush.apple.com.attacker.test/x", "https://fcm.googleapis.com:8443/x", "not a url"]) assert.ok(!allowedEndpoint(bad), bad);
  const ua = createECDH("prime256v1"); ua.generateKeys();
  assert.ok(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: ua.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") }));
  assert.ok(!validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "short", auth: randomBytes(16).toString("base64url") }));
});
