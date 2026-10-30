/**
 * The platform's music library and laying a track under a reel. Only the platform administrator adds tracks, and only with the
 * licence that allows agents to use them in reels. Mixing uses ffmpeg on the server; where it is not installed, or the mix would
 * be too large, the clip is kept as it is and the player plays the track alongside it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { prisma, withPublic } from "../db";
import { logActivity } from "../audit";
import { system } from "./rewards";
import { REEL_MAX_BYTES } from "../social-rules";
import { MUSIC_GENRES, MUSIC_MAX_BYTES, mixArgs, musicType, sniffAudio, type Genre, type MusicChoice } from "../music-rules";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

async function adminOnly(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can manage the music library");
}

/** Length and whether there is sound, from ffprobe; nulls when ffprobe is not installed. */
async function probe(path: string): Promise<{ seconds: number | null; hasAudio: boolean | null }> {
  try {
    const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path], { timeout: 15_000 });
    const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
    const s = Number(j.format?.duration);
    return { seconds: Number.isFinite(s) ? s : null, hasAudio: (j.streams ?? []).some((x) => x.codec_type === "audio") };
  } catch { return { seconds: null, hasAudio: null }; }
}

const trackSchema = z.object({
  title: z.string().trim().min(1, "Give the track's title").max(120),
  artist: z.string().trim().min(1, "Give the artist or composer").max(120),
  genre: z.enum(Object.keys(MUSIC_GENRES) as [Genre, ...Genre[]], { error: "Choose a style" }),
  licenceName: z.string().trim().min(3, "Name the licence, for example 'Pixabay Content Licence' or 'Bought from AudioJungle, standard licence'").max(160),
  licenceSource: z.string().trim().max(300).default("").refine((u) => u === "" || /^https:\/\//.test(u), "The licence link must start with https://"),
  licenceNote: z.string().trim().max(1000).default(""),
  creditRequired: z.boolean().default(false),
  confirmed: z.literal(true, { error: "Confirm that the licence allows people to use this track in reels on the platform" }),
});

export async function addTrack(adminId: string, raw: z.input<typeof trackSchema>, file: { name: string; type: string; bytes: Uint8Array }) {
  await adminOnly(adminId);
  const d = trackSchema.parse(raw);
  const type = musicType(file.type, file.name);
  if (!type) throw new Error("Upload an MP3, M4A, AAC or OGG audio file");
  if (file.bytes.byteLength === 0) throw new Error("The file is empty");
  if (file.bytes.byteLength > MUSIC_MAX_BYTES) throw new Error("Tracks must be 4 MB or smaller. Export at 128 kbps, or trim it to the part people will use.");
  if (!sniffAudio(type, file.bytes)) throw new Error("The file contents are not that kind of audio");
  const dir = await mkdtemp(join(tmpdir(), "track-"));
  let seconds: number | null = null;
  try { const p = join(dir, "t"); await writeFile(p, file.bytes); seconds = (await probe(p)).seconds; } finally { await rm(dir, { recursive: true, force: true }); }
  return system(async (tx) => {
    const t = await tx.musicTrack.create({ data: { title: d.title, artist: d.artist, genre: d.genre, durationSec: seconds, mimeType: type, sizeBytes: file.bytes.byteLength, licenceName: d.licenceName, licenceSource: d.licenceSource, licenceNote: d.licenceNote, creditRequired: d.creditRequired, createdById: adminId } });
    await tx.musicMedia.create({ data: { trackId: t.id, bytes: Buffer.from(file.bytes) } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "music_track", entityId: t.id, action: "music.added", detail: { title: d.title, artist: d.artist, licence: d.licenceName } });
    return t;
  });
}

export async function setTrackActive(adminId: string, id: string, active: boolean) {
  await adminOnly(adminId);
  await system(async (tx) => {
    await tx.musicTrack.update({ where: { id }, data: { active } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "music_track", entityId: id, action: active ? "music.restored" : "music.withdrawn", detail: {} });
  });
}

/** Tracks agents can choose from, newest and most used first. */
export async function musicLibrary() {
  return withPublic((tx) => tx.musicTrack.findMany({ where: { active: true }, orderBy: [{ uses: "desc" }, { createdAt: "desc" }], take: 200, select: { id: true, title: true, artist: true, genre: true, durationSec: true, licenceName: true, creditRequired: true } }));
}

/** Every track, for the administrator, with how often each is used. */
export async function musicForAdmin(adminId: string) {
  await adminOnly(adminId);
  return system((tx) => tx.musicTrack.findMany({ orderBy: { createdAt: "desc" }, take: 500 }));
}

export async function trackAudio(id: string) {
  return withPublic(async (tx) => {
    const t = await tx.musicTrack.findFirst({ where: { id, active: true }, select: { mimeType: true } });
    const m = t ? await tx.musicMedia.findUnique({ where: { trackId: id } }) : null;
    return t && m ? { type: t.mimeType, bytes: Buffer.from(m.bytes) } : null;
  });
}

/**
 * Lay the chosen track under a clip. Returns the mixed clip when ffmpeg is available and the result fits the reel size limit;
 * otherwise returns null and the clip is stored as it is, with the player adding the track.
 */
export async function mixIntoClip(clip: { type: string; bytes: Uint8Array }, choice: MusicChoice): Promise<Uint8Array | null> {
  const audio = await trackAudio(choice.trackId);
  if (!audio) throw new Error("That track is no longer in the music library. Choose another.");
  const dir = await mkdtemp(join(tmpdir(), "reel-mix-"));
  try {
    const ext = clip.type === "video/webm" ? "webm" : "mp4";
    const video = join(dir, `in.${ext}`), track = join(dir, "track"), out = join(dir, `out.${ext}`);
    await writeFile(video, clip.bytes); await writeFile(track, audio.bytes);
    const p = await probe(video);
    if (p.seconds === null || p.hasAudio === null) return null; // no ffprobe here: the player will mix
    await run(FFMPEG, mixArgs({ video, audio: track, out, container: ext, clipSeconds: p.seconds, clipHasAudio: p.hasAudio, choice }), { timeout: 45_000 });
    const mixed = new Uint8Array(await readFile(out));
    return mixed.byteLength > 0 && mixed.byteLength <= REEL_MAX_BYTES ? mixed : null;
  } catch (e) {
    console.error("reel mix failed; the player will play the track alongside", e);
    return null;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
