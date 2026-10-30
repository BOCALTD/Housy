import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanChoice, durationLabel, mixArgs, musicType, sniffAudio } from "../../src/lib/music-rules";

test("only real audio files are accepted, whatever they claim to be", () => {
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(sniffAudio("audio/mpeg", id3));
  assert.ok(sniffAudio("audio/ogg", ogg));
  assert.ok(!sniffAudio("audio/mpeg", ogg));
  assert.equal(musicType("audio/x-m4a"), "audio/mp4");
  assert.equal(musicType("", "song.mp3"), "audio/mpeg");
  assert.equal(musicType("video/mp4"), null);
});

test("the agent's choice is kept inside the track and volumes inside 0 to 100", () => {
  assert.equal(cleanChoice({ trackId: "" }, 120), null);
  assert.deepEqual(cleanChoice({ trackId: "t", start: "200", musicVolume: "150", originalVolume: "-4" }, 120), { trackId: "t", startSec: 115, musicVolume: 100, originalVolume: 0 });
  assert.deepEqual(cleanChoice({ trackId: "t", start: "abc" }, null), { trackId: "t", startSec: 0, musicVolume: 80, originalVolume: 40 });
  assert.equal(durationLabel(95), "1:35");
});

test("the mix copies the picture and lays the track under the clip's own sound", () => {
  const a = mixArgs({ video: "in.mp4", audio: "song.mp3", out: "out.mp4", container: "mp4", clipSeconds: 15, clipHasAudio: true, choice: { trackId: "t", startSec: 12.5, musicVolume: 80, originalVolume: 30 } });
  const graph = a[a.indexOf("-filter_complex") + 1];
  assert.match(graph, /atrim=start=12\.50/);
  assert.match(graph, /volume=0\.80/);
  assert.match(graph, /\[0:a\]volume=0\.30/);
  assert.match(graph, /amix=inputs=2/);
  assert.match(graph, /afade=t=out:st=13\.80/);
  assert.deepEqual(a.slice(a.indexOf("-c:v"), a.indexOf("-c:v") + 2), ["-c:v", "copy"]);
  const silent = mixArgs({ video: "in.webm", audio: "s.ogg", out: "o.webm", container: "webm", clipSeconds: 10, clipHasAudio: false, choice: { trackId: "t", startSec: 0, musicVolume: 100, originalVolume: 40 } });
  assert.ok(!silent.join(" ").includes("amix"));
  assert.ok(silent.includes("libopus"));
});
