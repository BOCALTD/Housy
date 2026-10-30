/**
 * Builds the demonstration property reels (vertical MP4 clips) from the demonstration photos with ffmpeg: each photo slowly
 * zooms and pans, crossfades into the next, with the property's name, price and area on screen. Run once when the catalogue
 * changes: npx tsx scripts/make-demo-reels.ts. The clips are committed in prisma/demo-media/reels.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEMO_LISTINGS } from "../src/lib/demo-catalogue-data";

const ROOT = process.cwd();
const FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf";
const FONT2 = "/usr/share/fonts/opentype/inter/Inter-Medium.otf";
const W = 720, H = 1280, SEC = 3.2, FADE = 0.6, FPS = 30;
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%").replace(/,/g, "\\,");
const naira = (p: string, period?: unknown) => `₦${p}${period === "NIGHT" ? " a night" : period === "YEAR" ? " a year" : period === "MONTH" ? " a month" : ""}`;
function wrap(s: string, n: number) { const out: string[] = []; let line = ""; for (const w of s.split(" ")) { if ((line + " " + w).trim().length > n) { out.push(line.trim()); line = w; } else line += " " + w; } if (line.trim()) out.push(line.trim()); return out; }

DEMO_LISTINGS.forEach((l, i) => {
  if (!l.reel) return;
  const out = join(ROOT, "prisma/demo-media/reels", `reel-${String(i).padStart(2, "0")}.mp4`);
  const pics = l.photos.slice(0, 4).map(([f]) => join(ROOT, "prisma/demo-media/photos", `${f}.jpg`));
  const inputs = pics.flatMap((p) => ["-loop", "1", "-t", String(SEC + FADE), "-i", p]);
  const frames = Math.round((SEC + FADE) * FPS);
  const zoom = pics.map((_, k) => {
    const dir = k % 2 === 0 ? "zoom+0.0009" : "if(eq(on,0),1.18,zoom-0.0009)";
    return `[${k}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${dir}':x='iw/2-(iw/zoom/2)${k % 2 ? "-" : "+"}on*0.6':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1[v${k}]`;
  });
  let chain = "[v0]";
  const fades: string[] = [];
  for (let k = 1; k < pics.length; k++) {
    const label = k === pics.length - 1 ? "[slides]" : `[x${k}]`;
    fades.push(`${chain}[v${k}]xfade=transition=fade:duration=${FADE}:offset=${(SEC * k).toFixed(2)}${label}`);
    chain = label;
  }
  const title = wrap(String(l.listing.title), 26);
  const lines = [
    ...title.map((t, k) => `drawtext=fontfile=${FONT}:text='${esc(t)}':fontcolor=white:fontsize=44:x=48:y=h-${330 - k * 56}:shadowcolor=black@0.6:shadowx=2:shadowy=2`),
    `drawtext=fontfile=${FONT}:text='${esc(naira(String(l.listing.price), l.listing.pricePeriod))}':fontcolor=0xFBB017:fontsize=48:x=48:y=h-${330 - title.length * 56 - 14}:shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    `drawtext=fontfile=${FONT2}:text='${esc(l.area === l.city ? `${l.area}, ${l.state}` : `${l.area}, ${l.city}`)}':fontcolor=white@0.92:fontsize=32:x=48:y=h-${330 - title.length * 56 - 80}`,
    `drawbox=x=40:y=60:w=250:h=58:color=0xFBB017@0.95:t=fill`,
    `drawtext=fontfile=${FONT}:text='PROPERTY REEL':fontcolor=0x1F2125:fontsize=26:x=58:y=76`,
    `drawtext=fontfile=${FONT2}:text='Sample video':fontcolor=white@0.8:fontsize=24:x=w-tw-40:y=78`,
  ];
  const total = SEC * pics.length + FADE;
  const graph = [...zoom, ...(pics.length > 1 ? fades : ["[v0]copy[slides]"]),
    `[slides]drawbox=x=0:y=ih-460:w=iw:h=460:color=black@0.45:t=fill,${lines.join(",")},format=yuv420p[out]`].join(";");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[out]", "-t", total.toFixed(2), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-profile:v", "main", "-movflags", "+faststart", "-an", out], { stdio: "inherit" });
  console.log(out.replace(ROOT + "/", ""), Math.round(statSync(out).size / 1024), "KB");
  if (!existsSync(out)) throw new Error("no output");
});
