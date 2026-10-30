/**
 * Phase 17v: music on reels. Only the platform administrator adds songs, each with its licence; agents choose a song, a start
 * point and volumes; the song is mixed into the clip where ffmpeg is installed and played alongside it where it is not; a
 * withdrawn song can no longer be chosen.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, withUser } from "../../src/lib/db";
import { saveAgentProfile } from "../../src/lib/services/community";
import { getReel, uploadReel } from "../../src/lib/services/reels";
import { addTrack, musicLibrary, setTrackActive, trackAudio } from "../../src/lib/services/music";
import { newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const SONG = readFileSync(join(process.cwd(), "prisma/demo-media/music/keys-to-home.mp3"));
const CLIP = readFileSync(join(process.cwd(), "prisma/demo-media/reels/reel-00.mp4"));
const meta = (o: Record<string, unknown> = {}) => ({ title: `Test Song ${randomUUID().slice(0, 4)}`, artist: "Test Artist", genre: "CHILL" as const, licenceName: "Test licence for the platform", creditRequired: true, confirmed: true as const, ...o });

test("only the administrator adds songs, each with a licence, and only real audio", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("musicx");
  await assert.rejects(addTrack(co.userId, meta(), { name: "s.mp3", type: "audio/mpeg", bytes: SONG }), /platform administrator/);
  await assert.rejects(addTrack(admin.id, meta({ confirmed: false }), { name: "s.mp3", type: "audio/mpeg", bytes: SONG }), /Confirm that the licence/);
  await assert.rejects(addTrack(admin.id, meta(), { name: "s.mp3", type: "audio/mpeg", bytes: CLIP }), /not that kind of audio/);
  await assert.rejects(addTrack(admin.id, meta(), { name: "s.mp4", type: "video/mp4", bytes: CLIP }), /MP3, M4A/);
  const t = await addTrack(admin.id, meta(), { name: "s.mp3", type: "audio/mpeg", bytes: SONG });
  assert.ok((await musicLibrary()).some((x) => x.id === t.id));
  assert.equal((await trackAudio(t.id))?.bytes.byteLength, SONG.byteLength);
});

test("an agent's reel carries the chosen song, mixed in or played alongside; a withdrawn song cannot be chosen", async () => {
  const admin = await newPlatformAdmin();
  const t = await addTrack(admin.id, meta(), { name: "s.mp3", type: "audio/mpeg", bytes: SONG });
  const co = await newCompany("musicr");
  await saveAgentProfile(co, { displayName: `Music Agent ${randomUUID().slice(0, 4)}`, headline: "", bio: "", listed: true, acceptsMessages: true });
  const reel = await uploadReel(co.userId, { caption: "With a song" }, { type: "video/mp4", bytes: CLIP }, { music: { trackId: t.id, start: "12", musicVolume: "90", originalVolume: "0" } });
  const card = (await getReel(reel.id, co.userId))!;
  assert.equal(card.music?.trackId, t.id);
  assert.equal(card.music?.startSec, 12);
  assert.equal(card.music?.volume, 90);
  assert.equal(card.music?.credit, true);
  const row = await withUser(co.userId, (tx) => tx.$queryRaw<{ music_mixed: boolean; size_bytes: number }[]>`SELECT music_mixed, size_bytes FROM reels WHERE id = ${reel.id}`);
  // Where ffmpeg is installed the stored clip now has the song in it (and so differs in size); otherwise the player plays it alongside.
  if (row[0].music_mixed) assert.notEqual(row[0].size_bytes, CLIP.byteLength);
  else assert.equal(row[0].size_bytes, CLIP.byteLength);
  assert.equal((await prisma.musicTrack.findUniqueOrThrow({ where: { id: t.id } })).uses, 1);

  await setTrackActive(admin.id, t.id, false);
  assert.ok(!(await musicLibrary()).some((x) => x.id === t.id));
  assert.equal(await trackAudio(t.id), null, "a withdrawn song is no longer served");
  await assert.rejects(uploadReel(co.userId, {}, { type: "video/mp4", bytes: CLIP }, { music: { trackId: t.id } }), /no longer in the music library/);
});
