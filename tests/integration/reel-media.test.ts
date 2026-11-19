/**
 * Reel videos: sent in pieces (resuming, checked), posted, prepared by ffmpeg into an MP4 with a still picture, served with byte
 * ranges from the database or a server folder, and the storage settings checked before they are saved.
 */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../src/lib/db";
import { saveAgentProfile } from "../../src/lib/services/community";
import { reelMedia, uploadReel } from "../../src/lib/services/reels";
import { appendChunk, canPrepare, processReel, purgeUploads, startUpload, takeUpload, uploadStatus } from "../../src/lib/services/reel-media";
import { diskDriver, mediaDir, saveMediaConfig } from "../../src/lib/media-store";
import { system } from "../../src/lib/services/rewards";
import { newCompany, newPlatformAdmin } from "./helpers";

const DIR = mkdtempSync(join(tmpdir(), "housy-media-test-"));
process.env.MEDIA_DIR = DIR;
process.env.UPLOAD_TMP_DIR = join(DIR, "uploads");
after(async () => { await prisma.$disconnect(); await rm(DIR, { recursive: true, force: true }); });

const CLIP = new Uint8Array(readFileSync(join(process.cwd(), "prisma/demo-media/reels/reel-01.mp4")));
before(() => {});
const body = async (s: { body: ReadableStream<Uint8Array> | Uint8Array | null }) => (s.body instanceof Uint8Array ? s.body : new Uint8Array(await new Response(s.body).arrayBuffer()));

async function agent(label: string) {
  const co = await newCompany(label);
  await saveAgentProfile(co, { displayName: `${label} Agent ${Math.random().toString(36).slice(2, 6)}`, headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  return co;
}

/** Send a clip in pieces the way the composer does, with one piece sent twice (a retry). */
async function sendInPieces(userId: string, bytes: Uint8Array) {
  const up = await startUpload(userId, { type: "video/mp4", size: bytes.byteLength, name: "clip.mp4" });
  const step = 256 * 1024;
  let offset = 0;
  while (offset < bytes.byteLength) {
    const piece = bytes.subarray(offset, offset + step);
    const r = await appendChunk(userId, up.id, offset, piece);
    if (offset === 0) assert.equal((await appendChunk(userId, up.id, 0, piece)).received, r.received, "a repeated piece is ignored");
    offset = r.received;
  }
  return up.id;
}

test("a clip sent in pieces is checked, resumable, posted once, and prepared with a picture", async () => {
  const co = await agent("reelup");
  const other = await agent("reelother");
  await assert.rejects(startUpload(co.userId, { type: "image/png", size: 10 }), /video/);
  await assert.rejects(startUpload(co.userId, { type: "video/mp4", size: 500 * 1024 * 1024 }), /or smaller/);
  const bad = await startUpload(co.userId, { type: "video/mp4", size: 20 });
  await assert.rejects(appendChunk(co.userId, bad.id, 0, new Uint8Array(20)), /do not match/);

  const id = await sendInPieces(co.userId, CLIP);
  assert.deepEqual(await uploadStatus(co.userId, id), { received: CLIP.byteLength, total: CLIP.byteLength });
  assert.equal(await uploadStatus(other.userId, id), null, "someone else cannot see or use it");
  await assert.rejects(takeUpload(other.userId, id), /expired/);

  // A refused post (wrong property) keeps the upload for another try.
  await assert.rejects(uploadReel(co.userId, { caption: "Bad", listingId: "00000000-0000-0000-0000-000000000000" }, { uploadId: id }), /published properties/);
  const reel = await uploadReel(co.userId, { caption: "Sent in pieces" }, { uploadId: id });
  await assert.rejects(uploadReel(co.userId, { caption: "Again" }, { uploadId: id }), /already been posted/);
  assert.equal(reel.processing, "queued");
  assert.equal(reel.sizeBytes, CLIP.byteLength);

  // It plays as sent straight away, with ranges.
  const first = (await reelMedia(reel.id, co.userId, "video", "bytes=0-99"))!;
  assert.equal(first.status, 206);
  assert.equal(first.headers["Content-Range"], `bytes 0-99/${CLIP.byteLength}`);
  assert.equal((await body(first)).byteLength, 100);
  assert.equal(await reelMedia(reel.id, other.userId, "video", null), null, "not public until checked");

  const result = await processReel(reel.id);
  assert.equal(await processReel(reel.id), "skipped", "only one run prepares it");
  const row = await system((tx) => tx.reel.findUniqueOrThrow({ where: { id: reel.id } }));
  if (await canPrepare()) {
    assert.equal(result, "ready");
    assert.equal(row.processing, "ready");
    assert.equal(row.mimeType, "video/mp4");
    assert.ok(row.width && row.height && Math.max(row.width, row.height) <= 1280);
    assert.ok(row.durationSec && row.durationSec > 0);
    const poster = (await reelMedia(reel.id, co.userId, "poster", null))!;
    assert.equal(poster.headers["Content-Type"], "image/jpeg");
    const jpg = await body(poster);
    assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
    const whole = await body((await reelMedia(reel.id, co.userId, "video", null))!);
    assert.equal(whole.byteLength, row.sizeBytes);
    assert.equal(String.fromCharCode(...whole.subarray(4, 8)), "ftyp");
  } else {
    assert.equal(row.processing, "ready", "kept as sent where ffmpeg is missing");
  }
  assert.equal(await purgeUploads(new Date(Date.now() + 2 * 864e5)) >= 1, true);
});

test("a clip kept in a server folder is prepared there and the original removed", async () => {
  const co = await agent("reeldisk");
  const reel = await uploadReel(co.userId, { caption: "On disk" }, { type: "video/mp4", bytes: CLIP.subarray(0, Math.min(CLIP.byteLength, 4 * 1024 * 1024)) });
  // Move it to the server folder as if the folder had been chosen when it was posted.
  const d = diskDriver(mediaDir());
  const key = `reels/${reel.id}/original-test.mp4`;
  await d.put(key, CLIP, "video/mp4");
  await system(async (tx) => { await tx.reel.update({ where: { id: reel.id }, data: { storage: "disk", mediaKey: key, sizeBytes: CLIP.byteLength } }); await tx.reelMedia.delete({ where: { reelId: reel.id } }); });
  const tail = (await reelMedia(reel.id, co.userId, "video", "bytes=-10"))!;
  assert.equal(tail.status, 206);
  assert.equal((await body(tail)).byteLength, 10);
  assert.equal((await reelMedia(reel.id, co.userId, "video", `bytes=${CLIP.byteLength}-`))!.status, 416);
  await processReel(reel.id);
  const row = await system((tx) => tx.reel.findUniqueOrThrow({ where: { id: reel.id } }));
  if (await canPrepare()) {
    assert.notEqual(row.mediaKey, key);
    assert.equal(await d.read(key), null, "the original is removed once the prepared clip is in place");
    assert.ok(await d.read(row.mediaKey));
    assert.ok(row.posterKey.startsWith(`reels/${reel.id}/poster-`));
    assert.equal((await reelMedia(reel.id, co.userId, "poster", null))!.status, 200);
  }
});

test("video storage settings: administrator only, checked before saving", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("mediaset");
  await assert.rejects(saveMediaConfig(co.userId, { provider: "db" }), /platform administrator/);
  await assert.rejects(saveMediaConfig(admin.id, { provider: "s3", bucket: "Bad_Bucket", accessKey: "k", secret: "s", region: "eu-west-2" }), /bucket name/);
  await assert.rejects(saveMediaConfig(admin.id, { provider: "s3", endpoint: "http://insecure.example", bucket: "housy", accessKey: "k", secret: "s" }), /https/);
  await assert.rejects(saveMediaConfig(admin.id, { provider: "s3", endpoint: "https://s3.example.com", bucket: "housy", accessKey: "k", secret: "s" }, async () => { throw new Error("denied"); }), /could not write to that bucket/);
  const saved = await prisma.platformSetting.findUnique({ where: { key: "media_provider" } });
  assert.notEqual(saved?.value, "s3", "a failed check saves nothing");
});
