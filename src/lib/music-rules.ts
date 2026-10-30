/**
 * Music on reels: a library of tracks the platform holds a licence for, chosen by agents when they post. Pure rules: what an
 * audio file may be, the settings an agent picks, and the ffmpeg command that lays the track under the clip.
 */
export const MUSIC_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg"] as const;
export type MusicType = (typeof MUSIC_TYPES)[number];
export const MUSIC_MAX_BYTES = 4 * 1024 * 1024;
export const MUSIC_GENRES = { AFROBEATS: "Afrobeats", HIGHLIFE: "Highlife", AMAPIANO: "Amapiano", GOSPEL: "Gospel", CHILL: "Chill", ACOUSTIC: "Acoustic", CORPORATE: "Corporate", CINEMATIC: "Cinematic", UPBEAT: "Upbeat" } as const;
export type Genre = keyof typeof MUSIC_GENRES;

/** The file's first bytes must match an audio format, whatever the browser said it was. */
export function sniffAudio(type: string, b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (type === "audio/mpeg") return (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0); // "ID3" or an MPEG frame
  if (type === "audio/mp4") return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // "ftyp"
  if (type === "audio/aac") return b[0] === 0xff && (b[1] & 0xf6) === 0xf0; // ADTS
  if (type === "audio/ogg") return b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53; // "OggS"
  return false;
}
/** Browsers name the same formats differently. */
export function musicType(declared: string, fileName = ""): MusicType | null {
  const t = declared.toLowerCase();
  if (t === "audio/mpeg" || t === "audio/mp3" || /\.mp3$/i.test(fileName)) return "audio/mpeg";
  if (t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a" || /\.m4a$/i.test(fileName)) return "audio/mp4";
  if (t === "audio/aac" || t === "audio/x-aac" || /\.aac$/i.test(fileName)) return "audio/aac";
  if (t === "audio/ogg" || /\.(ogg|oga|opus)$/i.test(fileName)) return "audio/ogg";
  return null;
}

export type MusicChoice = { trackId: string; startSec: number; musicVolume: number; originalVolume: number };

/** What the agent picked, checked: a start point inside the track and volumes from 0 to 100. Null when no music was chosen. */
export function cleanChoice(raw: { trackId?: string; start?: string; musicVolume?: string; originalVolume?: string }, trackSeconds: number | null): MusicChoice | null {
  const trackId = (raw.trackId ?? "").trim();
  if (!trackId) return null;
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const vol = (v: string | undefined, d: number) => Math.round(Math.max(0, Math.min(100, n(v, d))));
  const maxStart = trackSeconds && trackSeconds > 5 ? trackSeconds - 5 : 0;
  return { trackId, startSec: Math.round(Math.max(0, Math.min(maxStart, n(raw.start, 0))) * 10) / 10, musicVolume: vol(raw.musicVolume, 80), originalVolume: vol(raw.originalVolume, 40) };
}

/**
 * The ffmpeg arguments that put the track under the clip: the track from the chosen point, faded in and out, at the chosen
 * volume, mixed with the clip's own sound (if it has any) at its volume. The picture is copied as it is, never re-encoded.
 */
export function mixArgs(o: { video: string; audio: string; out: string; container: "mp4" | "webm"; clipSeconds: number; clipHasAudio: boolean; choice: MusicChoice }): string[] {
  const { startSec, musicVolume, originalVolume } = o.choice;
  const d = Math.max(1, o.clipSeconds);
  const fadeOut = Math.max(0, d - 1.2).toFixed(2);
  const music = `[1:a]atrim=start=${startSec.toFixed(2)},asetpts=PTS-STARTPTS,volume=${(musicVolume / 100).toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${fadeOut}:d=1.2[m]`;
  const graph = o.clipHasAudio && originalVolume > 0
    ? `${music};[0:a]volume=${(originalVolume / 100).toFixed(2)}[o];[o][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    : `${music};[m]anull[a]`;
  return [
    "-y", "-loglevel", "error", "-i", o.video, "-i", o.audio, "-filter_complex", graph,
    "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
    ...(o.container === "webm" ? ["-c:a", "libopus", "-b:a", "96k"] : ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
    "-t", d.toFixed(2), "-shortest", o.out,
  ];
}

export const durationLabel = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
