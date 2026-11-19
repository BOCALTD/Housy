/**
 * Where reel videos and their pictures are kept. Three places, chosen by the platform administrator in Admin, Settings, Video
 * storage:
 * - "db": in the database (the fallback, and what older reels use). Fine for a small site; large clips make backups heavy.
 * - "disk": files on the server (MEDIA_DIR, default /var/lib/housy/media). Fast and simple for one server; back the folder up.
 * - "s3": an S3-compatible bucket (Amazon S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO), kept private: Housy
 *   streams the bytes to viewers itself, with byte ranges, so the bucket never needs to be public.
 * The keys are entered in the admin settings and stored encrypted; they are never shown again whole.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { prisma, withPlatformAdmin } from "./db";
import { logActivity } from "./audit";
import { openSecret, sealSecret } from "./totp";

export const MEDIA_PROVIDERS = ["db", "disk", "s3"] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

export type Range = { start: number; end: number };
export type MediaRead = { size: number; type: string; body: ReadableStream<Uint8Array>; range: Range | null };

export interface MediaDriver {
  name: "disk" | "s3";
  put(key: string, bytes: Uint8Array, type: string): Promise<void>;
  /** The object, or the asked-for byte range of it; null when it is not there. */
  get(key: string, range?: (size: number) => Range | null): Promise<MediaRead | null>;
  /** The whole object (small things: pictures, or a clip to work on). */
  read(key: string): Promise<Uint8Array | null>;
  del(key: string): Promise<void>;
}

/** Keys are made by Housy: letters, digits, dashes, dots and slashes, never climbing out of the folder. */
export function safeKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/._-]{0,200}$/i.test(key) || key.includes("..") || key.includes("//")) throw new Error("bad media key");
  return key;
}

// ---------- Disk ----------

export function diskDriver(root: string): MediaDriver {
  const base = resolve(root);
  const path = (key: string) => {
    const p = resolve(base, safeKey(key));
    if (!p.startsWith(base + sep)) throw new Error("bad media key");
    return p;
  };
  return {
    name: "disk",
    async put(key, bytes) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, p);
    },
    async get(key, range) {
      const p = path(key);
      const s = await stat(p).catch(() => null);
      if (!s?.isFile()) return null;
      const r = range ? range(s.size) : null;
      const stream = createReadStream(p, r ? { start: r.start, end: r.end } : {});
      return { size: s.size, type: "", body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, range: r };
    },
    async read(key) { return readFile(path(key)).then((b) => new Uint8Array(b)).catch(() => null); },
    async del(key) { await rm(path(key), { force: true }); },
  };
}

// ---------- S3-compatible ----------

export type S3Config = { endpoint: string; region: string; bucket: string; accessKey: string; secret: string };

export async function s3Driver(c: S3Config): Promise<MediaDriver> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: c.region || "auto", endpoint: c.endpoint || undefined, forcePathStyle: !!c.endpoint && !/amazonaws\.com/.test(c.endpoint),
    credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secret },
  });
  const missing = (e: unknown) => { const n = (e as { name?: string; $metadata?: { httpStatusCode?: number } }); return n.name === "NoSuchKey" || n.name === "NotFound" || n.$metadata?.httpStatusCode === 404; };
  return {
    name: "s3",
    async put(key, bytes, type) { await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: safeKey(key), Body: bytes, ContentType: type || "application/octet-stream" })); },
    async get(key, range) {
      try {
        let r: Range | null = null, size: number;
        if (range) {
          const h = await client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: safeKey(key) }));
          size = Number(h.ContentLength ?? 0);
          r = range(size);
        }
        const o = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: safeKey(key), Range: r ? `bytes=${r.start}-${r.end}` : undefined }));
        if (!range) size = Number(o.ContentLength ?? 0);
        const body = o.Body as unknown as { transformToWebStream(): ReadableStream<Uint8Array> };
        return { size: size!, type: o.ContentType ?? "", body: body.transformToWebStream(), range: r };
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async read(key) {
      try {
        const o = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: safeKey(key) }));
        return new Uint8Array(await (o.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async del(key) { await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: safeKey(key) })); },
  };
}

// ---------- Settings ----------

const K = { provider: "media_provider", endpoint: "media_s3_endpoint", region: "media_s3_region", bucket: "media_s3_bucket", accessKey: "media_s3_access_key", secret: "media_s3_secret" } as const;
const open = (v?: string) => { if (!v) return ""; try { return openSecret(v); } catch { return ""; } };
export const mediaDir = () => process.env.MEDIA_DIR || "/var/lib/housy/media";

export async function mediaConfig() {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: Object.values(K) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const provider = (MEDIA_PROVIDERS as readonly string[]).includes(v(K.provider)) ? (v(K.provider) as MediaProvider) : "db";
  return { provider, s3: { endpoint: v(K.endpoint), region: v(K.region), bucket: v(K.bucket), accessKey: v(K.accessKey), secret: open(v(K.secret)) } };
}

export async function mediaConfigForAdmin() {
  const c = await mediaConfig();
  return { provider: c.provider, dir: mediaDir(), endpoint: c.s3.endpoint, region: c.s3.region, bucket: c.s3.bucket, accessKey: c.s3.accessKey, secretTail: c.s3.secret ? `…${c.s3.secret.slice(-4)}` : "" };
}

let cached: { at: number; key: string; driver: MediaDriver | null } | null = null;

/** The driver new media is written to; null means the database. A driver for reading older media is got by its name. */
export async function currentMediaDriver(): Promise<MediaDriver | null> {
  const c = await mediaConfig();
  const sig = JSON.stringify(c);
  if (cached && cached.key === sig && Date.now() - cached.at < 60_000) return cached.driver;
  const driver = c.provider === "disk" ? diskDriver(mediaDir()) : c.provider === "s3" && c.s3.bucket && c.s3.accessKey && c.s3.secret ? await s3Driver(c.s3) : null;
  cached = { at: Date.now(), key: sig, driver };
  return driver;
}

/** The driver that holds media written under a given storage name (older media stays where it was written). */
export async function driverFor(storage: string): Promise<MediaDriver | null> {
  if (storage === "disk") return diskDriver(mediaDir());
  if (storage === "s3") {
    const c = await mediaConfig();
    if (!c.s3.bucket || !c.s3.accessKey || !c.s3.secret) throw new Error("Video storage is not set up");
    return s3Driver(c.s3);
  }
  return null;
}

const schema = z.object({
  provider: z.enum(MEDIA_PROVIDERS),
  endpoint: z.string().trim().max(200).default(""),
  region: z.string().trim().max(40).default(""),
  bucket: z.string().trim().max(63).default(""),
  accessKey: z.string().trim().max(128).default(""),
  secret: z.string().trim().max(256).default(""),
});

/** Save where new videos go. The place is tried (write, read back, delete) before it is saved. */
export async function saveMediaConfig(adminId: string, raw: z.input<typeof schema>, test: (d: MediaDriver) => Promise<void> = checkDriver) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const d = schema.parse(raw);
  const cur = await mediaConfig();
  const secret = d.secret || cur.s3.secret;
  if (d.provider === "s3") {
    if (d.endpoint && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(d.endpoint)) throw new Error("Enter the storage address as https:// and the host only, such as https://<account>.r2.cloudflarestorage.com");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(d.bucket)) throw new Error("Enter the bucket name (lower-case letters, digits, dots and dashes)");
    if (!d.accessKey) throw new Error("Enter the access key ID");
    if (!secret) throw new Error("Enter the secret access key");
    if (!d.endpoint && !d.region) throw new Error("Enter the region (Amazon S3), or the storage address for other providers");
  }
  const driver = d.provider === "disk" ? diskDriver(mediaDir()) : d.provider === "s3" ? await s3Driver({ endpoint: d.endpoint.replace(/\/$/, ""), region: d.region, bucket: d.bucket, accessKey: d.accessKey, secret }) : null;
  if (driver) {
    try { await test(driver); }
    catch { throw new Error(d.provider === "disk" ? `Housy cannot write to ${mediaDir()} on the server. Create the folder and let the housy user write to it, or set MEDIA_DIR.` : "Housy could not write to that bucket with these details. Check the address, bucket, region and keys, and that the key may read, write and delete."); }
  }
  const entries: [string, string][] = [[K.provider, d.provider], [K.endpoint, d.endpoint.replace(/\/$/, "")], [K.region, d.region], [K.bucket, d.bucket], [K.accessKey, d.accessKey]];
  if (d.secret) entries.push([K.secret, sealSecret(d.secret)]);
  await withPlatformAdmin(adminId, async (tx) => {
    for (const [key, value] of entries) await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: adminId }, update: { value, updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "media", action: "settings.media", detail: { provider: d.provider, bucket: d.bucket } });
  });
  cached = null;
}

async function checkDriver(d: MediaDriver) {
  const key = `check/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = new TextEncoder().encode("housy storage check");
  await d.put(key, body, "text/plain");
  const back = await d.read(key);
  await d.del(key);
  if (!back || back.byteLength !== body.byteLength) throw new Error("read back failed");
}

// ---------- Byte ranges ----------

/** The byte range a browser asked for (iPhones ask before they play), or null for the whole file; "bad" when it cannot be met. */
export function parseRange(header: string | null, size: number): Range | null | "bad" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  const start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return "bad";
  return { start, end };
}
