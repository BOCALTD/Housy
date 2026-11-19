/**
 * Reel videos: sent in pieces, kept in the chosen storage, prepared for every phone, with a still picture.
 *
 * 1. Sending: the composer sends the clip in 2 MB pieces (POST /api/reels/uploads, then PUT each piece at its offset). A dropped
 *    connection resumes from what arrived. The pieces wait in a temporary file on the server, for a day at most.
 * 2. Keeping: when the reel is posted the clip goes straight into storage (database, server folder or S3-compatible bucket), so
 *    it plays at once.
 * 3. Preparing: in the background, ffmpeg turns it into an MP4 (H.264 and AAC, at most 1280 pixels on the long side, set to start
 *    playing before it has all downloaded), lays the chosen song under it, and takes a still picture. The prepared clip replaces
 *    the original. Without ffmpeg the clip is kept as sent (25 MB at most) and the player adds the song.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open as openFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { Tx } from "../db";
import { logActivity } from "../audit";
import { rateLimit } from "../ratelimit";
import { REEL_CHUNK_BYTES, REEL_MAX_SECONDS, REEL_STORED_MAX, REEL_UPLOAD_MAX, REEL_UPLOAD_TYPES, REEL_UPLOAD_MAX_RAW, sniffVideo } from "../social-rules";
import { currentMediaDriver, driverFor, parseRange, type MediaDriver } from "../media-store";
import { mixIntoClip } from "./music";
import { notify } from "./notifications";
import { system } from "./rewards";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const UPLOAD_DIR = () => process.env.UPLOAD_TMP_DIR || join(tmpdir(), "housy-uploads");
const UPLOAD_HOURS = 24;
const MAX_TRIES = 3;

let ffmpegChecked: { at: number; ok: boolean } | null = null;
/** Whether this server can prepare clips (ffmpeg and ffprobe installed). Checked once a minute. */
export async function canPrepare() {
  if (ffmpegChecked && Date.now() - ffmpegChecked.at < 60_000) return ffmpegChecked.ok;
  let ok = false;
  try { await run(FFMPEG, ["-hide_banner", "-version"], { timeout: 5000 }); await run(FFPROBE, ["-hide_banner", "-version"], { timeout: 5000 }); ok = true; } catch { ok = false; }
  ffmpegChecked = { at: Date.now(), ok };
  return ok;
}

export async function uploadLimits() {
  const prepare = await canPrepare();
  return { maxBytes: prepare ? REEL_UPLOAD_MAX : REEL_UPLOAD_MAX_RAW, chunkBytes: REEL_CHUNK_BYTES, prepares: prepare, maxSeconds: REEL_MAX_SECONDS };
}

const partPath = (id: string) => join(UPLOAD_DIR(), `${id}.part`);
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

// ---------- Sending in pieces ----------

/** Start sending a clip. */
export async function startUpload(userId: string, o: { type: string; size: number; name?: string }) {
  const lim = await uploadLimits();
  const types: readonly string[] = lim.prepares ? REEL_UPLOAD_TYPES : ["video/mp4", "video/webm"];
  if (!types.includes(o.type)) throw new Error(lim.prepares ? "Choose a video: MP4, MOV (from an iPhone) or WebM" : "Upload an MP4 or WebM video");
  if (!Number.isInteger(o.size) || o.size <= 0) throw new Error("The video is empty");
  if (o.size > lim.maxBytes) throw new Error(`Videos must be ${mb(lim.maxBytes)} or smaller. Trim the clip or record it at a lower quality.`);
  if (!(await rateLimit(`reel-upload:${userId}`, 20, 3600_000))) throw new Error("You have started many uploads in the last hour. Please wait a little and try again.");
  await mkdir(UPLOAD_DIR(), { recursive: true });
  const row = await system((tx) => tx.reelUpload.create({ data: { userId, mimeType: o.type, fileName: (o.name ?? "").slice(0, 120), totalBytes: o.size, expiresAt: new Date(Date.now() + UPLOAD_HOURS * 3600_000) } }));
  await writeFile(partPath(row.id), new Uint8Array(0));
  return { id: row.id, chunkBytes: lim.chunkBytes, received: 0, total: o.size };
}

async function mine(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const u = await system((tx) => tx.reelUpload.findUnique({ where: { id } }));
  return u && u.userId === userId ? u : null;
}

/** How much of a clip has arrived (to resume after a dropped connection). */
export async function uploadStatus(userId: string, id: string) {
  const u = await mine(userId, id);
  if (!u || u.usedAt || u.expiresAt < new Date()) return null;
  return { received: u.receivedBytes, total: u.totalBytes };
}

/** Add the next piece. A piece for a place already received is ignored (a retry), and the offset is always given back. */
export async function appendChunk(userId: string, id: string, offset: number, bytes: Uint8Array) {
  const u = await mine(userId, id);
  if (!u || u.usedAt || u.expiresAt < new Date()) throw new Error("This upload has expired. Choose the video again.");
  if (bytes.byteLength > REEL_CHUNK_BYTES) throw new Error("That piece is too large");
  if (offset !== u.receivedBytes) return { received: u.receivedBytes, total: u.totalBytes };
  if (offset + bytes.byteLength > u.totalBytes) throw new Error("More was sent than the video's size");
  if (offset === 0 && !sniffVideo(u.mimeType, bytes)) throw new Error("The file contents do not match its type");
  // Only one piece is written at a time: the row moves forward only from the offset this piece was written for.
  const claimed = await system((tx) => tx.reelUpload.updateMany({ where: { id, receivedBytes: offset }, data: { receivedBytes: offset + bytes.byteLength } }));
  if (claimed.count !== 1) { const now = await uploadStatus(userId, id); return { received: now?.received ?? offset, total: u.totalBytes }; }
  try {
    const f = await openFile(partPath(id), "r+").catch(async () => { await writeFile(partPath(id), new Uint8Array(0)); return openFile(partPath(id), "r+"); });
    try { await f.write(bytes, 0, bytes.byteLength, offset); } finally { await f.close(); }
  } catch (e) {
    await system((tx) => tx.reelUpload.updateMany({ where: { id, receivedBytes: offset + bytes.byteLength }, data: { receivedBytes: offset } }));
    throw e;
  }
  return { received: offset + bytes.byteLength, total: u.totalBytes };
}

/** Take a complete upload for a new reel (once). */
export async function takeUpload(userId: string, id: string) {
  const u = await mine(userId, id);
  if (!u || u.expiresAt < new Date()) throw new Error("This upload has expired. Choose the video again.");
  if (u.usedAt) throw new Error("This video has already been posted");
  if (u.receivedBytes !== u.totalBytes) throw new Error("The video has not finished uploading yet");
  const s = await stat(partPath(id)).catch(() => null);
  if (!s || s.size !== u.totalBytes) throw new Error("The video did not arrive in full. Choose it again.");
  const done = await system((tx) => tx.reelUpload.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } }));
  if (done.count !== 1) throw new Error("This video has already been posted");
  return {
    path: partPath(id), type: u.mimeType, size: u.totalBytes,
    discard: () => rm(partPath(id), { force: true }),
    /** Posting failed (a limit, a wrong property): keep the upload so the person can fix it and send again. */
    release: () => system((tx) => tx.reelUpload.updateMany({ where: { id }, data: { usedAt: null } })).then(() => {}),
  };
}

/** Remove uploads nobody finished or posted. */
export async function purgeUploads(now = new Date()) {
  const old = await system((tx) => tx.reelUpload.findMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: new Date(now.getTime() - 3600_000) } }] }, select: { id: true }, take: 500 }));
  for (const u of old) await rm(partPath(u.id), { force: true });
  if (old.length) await system((tx) => tx.reelUpload.deleteMany({ where: { id: { in: old.map((u) => u.id) } } }));
  return old.length;
}

// ---------- Keeping ----------

const ext = (type: string) => (type === "video/webm" ? "webm" : type === "video/quicktime" ? "mov" : "mp4");
const keyFor = (reelId: string, what: string) => `reels/${reelId}/${what}`;

/**
 * Put a new reel's clip where new media goes, before the reel is saved (so a slow bucket never holds a database transaction open).
 * For the database the bytes are written with the reel instead. Returns where it went and how to undo it if saving fails.
 */
export async function placeOriginal(reelId: string, type: string, bytes: Uint8Array) {
  const driver = await currentMediaDriver();
  if (!driver) return { storage: "db" as const, mediaKey: "", undo: async () => {} };
  const key = keyFor(reelId, `original-${Date.now().toString(36)}.${ext(type)}`);
  await driver.put(key, bytes, type);
  return { storage: driver.name, mediaKey: key, undo: () => driver.del(key).catch(() => {}) };
}

async function readClip(r: { id: string; storage: string; mediaKey: string }): Promise<Uint8Array | null> {
  if (r.storage === "db") {
    const m = await system((tx) => tx.reelMedia.findUnique({ where: { reelId: r.id } }));
    return m ? new Uint8Array(m.bytes) : null;
  }
  const d = await driverFor(r.storage);
  return d ? d.read(r.mediaKey) : null;
}

// ---------- Preparing ----------

type Probe = { seconds: number | null; width: number | null; height: number | null; hasAudio: boolean };
async function probe(path: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], { timeout: 30_000 });
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  const sec = Number(j.format?.duration);
  return { seconds: Number.isFinite(sec) ? sec : null, width: v?.width ?? null, height: v?.height ?? null, hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio") };
}

/** ffmpeg settings for a clip every phone plays: H.264 and AAC in MP4, long side at most 1280, ready to play while downloading. */
export function transcodeArgs(input: string, output: string, maxSeconds = REEL_MAX_SECONDS): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-t", String(maxSeconds),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))',fps=fps='min(source_fps,30)',format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "2500k", "-bufsize", "5000k", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", output,
  ];
}

/** A still picture from about a second in (or the middle of a very short clip), 720 pixels wide at most. */
export function posterArgs(input: string, output: string, seconds: number | null): string[] {
  const at = seconds && seconds < 2 ? seconds / 2 : 1;
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", at.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "3", output];
}

/** Prepare one reel's clip. Safe to call more than once: only one run takes it. */
export async function processReel(reelId: string): Promise<"ready" | "failed" | "skipped"> {
  const claimed = await system((tx) => tx.reel.updateMany({
    where: { id: reelId, OR: [{ processing: "queued" }, { processing: "processing", processStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } }], processTries: { lt: MAX_TRIES } },
    data: { processing: "processing", processStartedAt: new Date(), processTries: { increment: 1 } },
  }));
  if (claimed.count !== 1) return "skipped";
  const reel = await system((tx) => tx.reel.findUniqueOrThrow({ where: { id: reelId } }));
  const dir = await mkdtemp(join(tmpdir(), "reel-prep-"));
  try {
    const original = await readClip(reel);
    if (!original) throw new Error("The clip is missing from storage");
    const input = join(dir, `in.${ext(reel.mimeType)}`);
    await writeFile(input, original);
    if (!(await canPrepare())) {
      // Kept as sent; the player adds any song.
      await system((tx) => tx.reel.update({ where: { id: reelId }, data: { processing: "ready", processError: "", musicPending: false } }));
      return "ready";
    }
    const p = await probe(input);
    if (!p.width || !p.height) throw new Error("not a video this server can read");
    if (p.seconds && p.seconds > REEL_MAX_SECONDS + 1) await tellAuthor(reel, `Your reel is longer than ${REEL_MAX_SECONDS / 60} minutes, so only the first ${REEL_MAX_SECONDS / 60} minutes are kept.`);
    const out = join(dir, "out.mp4");
    await run(FFMPEG, transcodeArgs(input, out), { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 });
    let clip = new Uint8Array(await readFile(out));
    let mixed = reel.musicMixed;
    if (reel.musicPending && reel.musicTrackId) {
      const m = await mixIntoClip({ type: "video/mp4", bytes: clip }, { trackId: reel.musicTrackId, startSec: reel.musicStartSec, musicVolume: reel.musicVolume, originalVolume: reel.originalVolume }).catch(() => null);
      if (m) { clip = new Uint8Array(m); mixed = true; }
    }
    if (clip.byteLength > REEL_STORED_MAX) throw new Error("the prepared clip is too large");
    const outPath = join(dir, "ready.mp4");
    await writeFile(outPath, clip);
    const shot = join(dir, "poster.jpg");
    let poster: Uint8Array | null = null;
    try {
      await run(FFMPEG, posterArgs(outPath, shot, p.seconds), { timeout: 60_000 });
      poster = new Uint8Array(await sharp(await readFile(shot)).rotate().resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer());
    } catch { poster = null; }
    const info = await probe(outPath).catch(() => p);

    // Write the prepared clip where the original was kept, then switch the reel to it, then remove the original.
    const driver = await driverFor(reel.storage).catch(() => null);
    const stamp = Date.now().toString(36);
    let mediaKey = reel.mediaKey, posterKey = reel.posterKey;
    if (driver) {
      mediaKey = keyFor(reelId, `clip-${stamp}.mp4`);
      await driver.put(mediaKey, clip, "video/mp4");
      if (poster) { posterKey = keyFor(reelId, `poster-${stamp}.jpg`); await driver.put(posterKey, poster, "image/jpeg"); }
    }
    await system(async (tx) => {
      if (!driver) {
        await tx.reelMedia.update({ where: { reelId }, data: { bytes: Buffer.from(clip) } });
        if (poster) await tx.reelPoster.upsert({ where: { reelId }, create: { reelId, bytes: Buffer.from(poster) }, update: { bytes: Buffer.from(poster) } });
      }
      await tx.reel.update({ where: { id: reelId }, data: {
        mimeType: "video/mp4", sizeBytes: clip.byteLength, mediaKey, posterKey: driver ? posterKey : poster ? "db" : "", processing: "ready", processError: "",
        durationSec: info.seconds ?? p.seconds, width: info.width ?? p.width, height: info.height ?? p.height, musicMixed: mixed, musicPending: false,
      } });
      await logActivity(tx, { companyId: reel.companyId, actorId: null, entityType: "reel", entityId: reelId, action: "reel.prepared", detail: { bytes: clip.byteLength, from: reel.sizeBytes, storage: reel.storage, poster: !!poster } });
    });
    if (driver) {
      if (reel.mediaKey && reel.mediaKey !== mediaKey) await driver.del(reel.mediaKey).catch(() => {});
      if (reel.posterKey && reel.posterKey !== posterKey) await driver.del(reel.posterKey).catch(() => {});
    }
    return "ready";
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    const last = reel.processTries + 1 >= MAX_TRIES;
    await system((tx) => tx.reel.update({ where: { id: reelId }, data: { processing: last ? "failed" : "queued", processError: msg } }));
    if (last) await tellAuthor(reel, "Your reel could not be prepared for every phone. It is kept as you sent it; if it does not play, record it again in MP4.");
    console.error("reel prepare failed", reelId, msg);
    return "failed";
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function tellAuthor(reel: { id: string; authorId: string }, body: string) {
  await system((tx) => notify(tx, reel.authorId, { kind: "reel.prepared", title: "About your reel", body, link: "/reels/mine", dedupeKey: `reel-prep:${reel.id}:${body.length}` })).catch(() => {});
}

/** Scheduled: prepare queued clips and retry stuck ones; tidy unfinished uploads. */
export async function processPendingReels(limit = 3) {
  const due = await system((tx) => tx.reel.findMany({
    where: { processTries: { lt: MAX_TRIES }, OR: [{ processing: "queued" }, { processing: "processing", processStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } }] },
    orderBy: { createdAt: "asc" }, take: limit, select: { id: true },
  }));
  const out = { ready: 0, failed: 0 };
  for (const r of due) { const x = await processReel(r.id); if (x === "ready") out.ready++; if (x === "failed") out.failed++; }
  return { ...out, uploadsRemoved: await purgeUploads() };
}

// ---------- Serving ----------

export type Served = { status: number; headers: Record<string, string>; body: ReadableStream<Uint8Array> | Uint8Array | null };

function fromBytes(bytes: Uint8Array, type: string, rangeHeader: string | null, cache: string): Served {
  const size = bytes.byteLength;
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  const r = parseRange(rangeHeader, size);
  if (r === "bad") return { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` }, body: null };
  if (!r) return { status: 200, headers: { ...base, "Content-Length": String(size) }, body: bytes };
  return { status: 206, headers: { ...base, "Content-Range": `bytes ${r.start}-${r.end}/${size}`, "Content-Length": String(r.end - r.start + 1) }, body: bytes.subarray(r.start, r.end + 1) };
}

async function fromDriver(d: MediaDriver, key: string, type: string, rangeHeader: string | null, cache: string): Promise<Served | null> {
  let bad = false;
  const got = await d.get(key, rangeHeader ? (size) => { const r = parseRange(rangeHeader, size); if (r === "bad") { bad = true; return { start: 0, end: 0 }; } return r; } : undefined);
  if (!got) return null;
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  if (bad) { await got.body.cancel().catch(() => {}); return { status: 416, headers: { ...base, "Content-Range": `bytes */${got.size}` }, body: null }; }
  if (!got.range) return { status: 200, headers: { ...base, "Content-Length": String(got.size) }, body: got.body };
  return { status: 206, headers: { ...base, "Content-Range": `bytes ${got.range.start}-${got.range.end}/${got.size}`, "Content-Length": String(got.range.end - got.range.start + 1) }, body: got.body };
}

/** The clip (or its still picture) for a reel the viewer may see, in the asked-for range. */
export async function serveReel(reel: { id: string; storage: string; mediaKey: string; posterKey: string; mimeType: string }, what: "video" | "poster", rangeHeader: string | null, read: Tx): Promise<Served | null> {
  const cache = "private, max-age=300";
  if (what === "video") {
    if (reel.storage === "db") {
      const m = await read.reelMedia.findUnique({ where: { reelId: reel.id } });
      return m ? fromBytes(new Uint8Array(m.bytes), reel.mimeType, rangeHeader, cache) : null;
    }
    const d = await driverFor(reel.storage);
    return d ? fromDriver(d, reel.mediaKey, reel.mimeType, rangeHeader, cache) : null;
  }
  if (!reel.posterKey) return null;
  if (reel.storage === "db" || reel.posterKey === "db") {
    const p = await read.reelPoster.findUnique({ where: { reelId: reel.id } });
    return p ? fromBytes(new Uint8Array(p.bytes), "image/jpeg", null, "private, max-age=86400") : null;
  }
  const d = await driverFor(reel.storage);
  return d ? fromDriver(d, reel.posterKey, "image/jpeg", null, "private, max-age=86400") : null;
}

/** Read an upload's file (for posting); kept here so the temporary folder stays this module's business. */
export async function readUploadFile(path: string) { return new Uint8Array(await readFile(path)); }
