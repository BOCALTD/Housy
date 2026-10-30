/**
 * Builds the demonstration songs for the reel music library: short original instrumentals synthesised with ffmpeg (no samples,
 * no one else's recordings), so they are free to use on the platform. Run with `npx tsx scripts/make-demo-music.ts`.
 * Real music should come from a licensed library, added by the platform administrator at /admin/music.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "prisma/demo-media/music");
mkdirSync(OUT, { recursive: true });

type Song = { file: string; bpm: number; seconds: number; chords: number[][]; bass: number[]; swing: number };
const n = (semis: number) => 220 * Math.pow(2, semis / 12); // semitones from A3

// Chord tones as semitones from A3; one chord per bar.
const SONGS: Song[] = [
  { file: "lagos-sunset.mp3", bpm: 102, seconds: 40, swing: 0.0, chords: [[3, 7, 10], [-2, 2, 5], [0, 3, 7], [-4, 0, 3]], bass: [-21, -26, -24, -28] },
  { file: "island-breeze.mp3", bpm: 112, seconds: 40, swing: 0.08, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], bass: [-24, -19, -17, -19] },
  { file: "keys-to-home.mp3", bpm: 84, seconds: 40, swing: 0.0, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [2, 5, 9, 12], [-5, -1, 2, 5]], bass: [-24, -27, -22, -29] },
  { file: "open-house.mp3", bpm: 120, seconds: 40, swing: 0.0, chords: [[2, 5, 9], [0, 3, 7], [-2, 2, 5], [0, 3, 7]], bass: [-22, -24, -26, -24] },
];

for (const s of SONGS) {
  const beat = 60 / s.bpm, bar = beat * 4;
  const chordAt = (list: number[][]) => list.map((c, i) => `between(mod(t,${(bar * list.length).toFixed(4)}),${(bar * i).toFixed(4)},${(bar * (i + 1)).toFixed(4)})*(${c.map((x) => `sin(2*PI*${n(x).toFixed(3)}*t)`).join("+")})/${c.length}`).join("+");
  const bassAt = s.bass.map((x, i) => `between(mod(t,${(bar * s.bass.length).toFixed(4)}),${(bar * i).toFixed(4)},${(bar * (i + 1)).toFixed(4)})*sin(2*PI*${n(x).toFixed(3)}*t)`).join("+");
  // Pads swell on each beat; the bass pulses on the off-beat; a kick on every beat and a shaker on the eighths.
  const pad = `0.22*(${chordAt(s.chords)})*(0.6+0.4*exp(-3*mod(t,${beat.toFixed(4)})))`;
  const bass = `0.30*(${bassAt})*exp(-6*mod(t+${(beat / 2).toFixed(4)},${beat.toFixed(4)}))`;
  const kick = `0.55*sin(2*PI*(50+90*exp(-30*mod(t,${beat.toFixed(4)})))*mod(t,${beat.toFixed(4)}))*exp(-9*mod(t,${beat.toFixed(4)}))`;
  const shaker = `0.05*(random(0)*2-1)*exp(-40*mod(t+${(s.swing * beat).toFixed(4)},${(beat / 2).toFixed(4)}))`;
  const expr = `${pad}+${bass}+${kick}+${shaker}`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=44100:d=${s.seconds}`,
    "-af", `afade=t=in:d=1.5,afade=t=out:st=${s.seconds - 2.5}:d=2.5,acompressor=threshold=0.3:ratio=3,alimiter=limit=0.9,aresample=44100`,
    "-ac", "2", "-c:a", "libmp3lame", "-b:a", "96k", join(OUT, s.file)]);
  console.log("made", s.file);
}
