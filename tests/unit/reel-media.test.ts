import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskDriver, parseRange, safeKey } from "../../src/lib/media-store";
import { posterArgs, transcodeArgs } from "../../src/lib/services/reel-media";
import { sniffVideo } from "../../src/lib/social-rules";

test("byte ranges as phones ask for them", () => {
  assert.equal(parseRange(null, 100), null);
  assert.equal(parseRange("bytes=-", 100), null);
  assert.deepEqual(parseRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseRange("bytes=10-", 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.equal(parseRange("bytes=100-", 100), "bad");
  assert.equal(parseRange("bytes=5-2", 100), "bad");
});

test("media keys never leave the folder", () => {
  assert.equal(safeKey("reels/abc/clip-1.mp4"), "reels/abc/clip-1.mp4");
  for (const k of ["../etc/passwd", "/abs", "reels//x", "reels/../../x", "a b", ""]) assert.throws(() => safeKey(k));
});

test("the server folder keeps, serves ranges of, and removes media", async () => {
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  try {
    const d = diskDriver(dir);
    await d.put("reels/r1/clip.mp4", new TextEncoder().encode("0123456789"), "video/mp4");
    assert.equal(new TextDecoder().decode((await d.read("reels/r1/clip.mp4"))!), "0123456789");
    const part = await d.get("reels/r1/clip.mp4", (size) => ({ start: 2, end: Math.min(4, size - 1) }));
    assert.equal(part!.size, 10);
    assert.equal(new TextDecoder().decode(new Uint8Array(await new Response(part!.body).arrayBuffer())), "234");
    await d.del("reels/r1/clip.mp4");
    assert.equal(await d.read("reels/r1/clip.mp4"), null);
    assert.equal(await d.get("reels/r1/clip.mp4"), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("clips are prepared as MP4 every phone plays, ready to stream, with a picture", () => {
  const a = transcodeArgs("in.mov", "out.mp4");
  for (const x of ["libx264", "aac", "+faststart", "yuv420p"]) assert.ok(a.join(" ").includes(x), x);
  assert.equal(a[a.indexOf("-t") + 1], "120");
  assert.equal(a.at(-1), "out.mp4");
  const p = posterArgs("out.mp4", "p.jpg", 0.8);
  assert.equal(p[p.indexOf("-ss") + 1], "0.40");
  assert.equal(posterArgs("o", "p", 30)[posterArgs("o", "p", 30).indexOf("-ss") + 1], "1.00");
});

test("iPhone MOV files are recognised", () => {
  const ftyp = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0]);
  assert.equal(sniffVideo("video/quicktime", ftyp), true);
  assert.equal(sniffVideo("video/quicktime", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0])), false);
});
