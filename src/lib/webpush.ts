// Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID sender identification (RFC 8292),
// using only Node's built-in crypto. The push service (Google, Mozilla, Apple, Microsoft) only ever sees ciphertext.
import { createECDH, createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes, createCipheriv, hkdfSync } from "node:crypto";

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

/** A fresh VAPID key pair, as the base64url strings the environment file holds. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateKey: jwk.d };
}

/** The push services browsers use. Sending anywhere else is refused, so a crafted subscription cannot make the server call other hosts. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname)) && endpoint.length <= 1000;
  } catch { return false; }
}

/** Check the keys a browser handed over: a P-256 public point and a 16-byte secret. */
export function validSubscription(s: PushSubscriptionKeys): boolean {
  if (!allowedEndpoint(s.endpoint)) return false;
  try {
    const pub = unb64u(s.p256dh), auth = unb64u(s.auth);
    return pub.length === 65 && pub[0] === 4 && auth.length === 16;
  } catch { return false; }
}

/** Encrypt one message for one browser (a single aes128gcm record). */
export function encryptPayload(sub: { p256dh: string; auth: string }, plaintext: Buffer, opts: { salt?: Buffer; serverEcdh?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const ecdh = opts.serverEcdh ?? createECDH("prime256v1");
  if (!opts.serverEcdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

function vapidKeyObject(keys: VapidKeys) {
  const pub = unb64u(keys.publicKey);
  return createPrivateKey({ key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
}

/** The Authorization header that identifies this server to the push service. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = new Date()): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: keys.subject })));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign({ key: vapidKeyObject(keys), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** For tests: check a VAPID token's signature with the public key. */
export function verifyVapid(authorization: string, publicKey: string): boolean {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(authorization);
  if (!m) return false;
  const pub = unb64u(publicKey);
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
  const v = createVerify("SHA256");
  v.update(`${m[1]}.${m[2]}`);
  return m[4] === publicKey && v.verify({ key, dsaEncoding: "ieee-p1363" }, unb64u(m[3]));
}

export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY ?? "", privateKey = env.VAPID_PRIVATE_KEY ?? "";
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) return null;
  const subject = env.VAPID_SUBJECT && /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : `mailto:${env.SUPPORT_EMAIL || "support@example.invalid"}`;
  return { publicKey, privateKey, subject };
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };
export type PushResult = { status: number };
export type PushSender = (sub: PushSubscriptionKeys, msg: PushMessage) => Promise<PushResult>;

/** Send one message. 201 means accepted; 404 or 410 means the browser has dropped the subscription. */
export function makeSender(keys: VapidKeys, ttlSeconds = 24 * 3600): PushSender {
  return async (sub, msg) => {
    if (!validSubscription(sub)) return { status: 410 };
    const body = encryptPayload(sub, Buffer.from(JSON.stringify(msg)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: vapidAuthorization(sub.endpoint, keys), TTL: String(ttlSeconds), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Urgency: "normal" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status };
  };
}
