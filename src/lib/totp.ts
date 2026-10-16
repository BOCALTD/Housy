import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Time-based one-time codes (RFC 6238) for two-step sign-in, with the secret kept encrypted at rest. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a valid secret");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));
export const STEP_SECONDS = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code for one time step. `digits` is 6 for authenticator apps; the RFC test vectors use 8. */
export function codeFor(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

/** The step a submitted code belongs to (this one or one either side, for clock drift), or null. A step at or before `lastStep` is refused so a code works once. */
export function verifyCode(secret: string, submitted: string, nowMs: number, lastStep: number | bigint | null = null): number | null {
  const code = submitted.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && BigInt(step) <= BigInt(lastStep)) continue;
    const want = Buffer.from(codeFor(secret, step)), got = Buffer.from(code);
    if (want.length === got.length && timingSafeEqual(want, got)) return step;
  }
  return null;
}

export function otpauthUri(secret: string, email: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---- encryption of the stored secret (AES-256-GCM) ----
const keyFrom = (env: NodeJS.ProcessEnv) => createHash("sha256").update(env.MFA_ENCRYPTION_KEY || env.APP_DB_PASSWORD || "development-only-secret").digest();

export function sealSecret(secret: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", keyFrom(env), iv);
  const enc = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function openSecret(sealed: string, env: NodeJS.ProcessEnv = process.env): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("The stored secret is unreadable");
  const d = createDecipheriv("aes-256-gcm", keyFrom(env), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** Ten single-use recovery codes like "k3m9-x2pq-7hfd". */
export function newRecoveryCodes(n = 10): string[] {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(12); let s = "";
    for (let i = 0; i < 12; i++) s += A[b[i] % A.length];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
}
export const normaliseRecovery = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecovery = (c: string) => createHash("sha256").update(normaliseRecovery(c)).digest("hex");
