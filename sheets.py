"""Contact sheets: for each clip 4 frames in a row with its id and title; 10 clips to a page."""
import json, subprocess, os, urllib.request, concurrent.futures as cf
from PIL import Image, ImageDraw, ImageFont
UA = {"User-Agent": "Mozilla/5.0"}
idx = json.load(open("out/index.json"))
os.makedirs("tmp", exist_ok=True); os.makedirs("out/rows", exist_ok=True)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
def one(c):
    vid = c["id"]; f = f"tmp/{vid}.mp4"
    for size in ("360", "720"):
        try:
            data = urllib.request.urlopen(urllib.request.Request(f"https://assets.mixkit.co/videos/{vid}/{vid}-{size}.mp4", headers=UA), timeout=60).read()
            open(f, "wb").write(data); break
        except Exception: pass
    if not os.path.exists(f): return None
    try:
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout.strip() or 0)
        wh = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], capture_output=True, text=True).stdout.strip()
        frames = []
        for k in range(4):
            o = f"tmp/{vid}-{k}.jpg"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(d * (k + .5) / 4), "-i", f, "-frames:v", "1", "-vf", "scale=-2:180", o])
            if os.path.exists(o): frames.append(Image.open(o).convert("RGB"))
        os.remove(f)
        if not frames: return None
        w = sum(i.width for i in frames)
        row = Image.new("RGB", (max(w, 600), 210), "black"); x = 0
        for i in frames: row.paste(i, (x, 30)); x += i.width
        ImageDraw.Draw(row).text((6, 4), f'{vid}  {d:.0f}s  {wh}  [{c["q"]}] {c["title"][:60]}', fill="yellow", font=font)
        row.save(f"out/rows/{vid}.jpg", quality=80)
        c.update({"dur": round(d, 1), "wh": wh}); return c
    except Exception as e:
        print("err", vid, e); return None
with cf.ThreadPoolExecutor(8) as ex: done = [r for r in ex.map(one, idx) if r]
json.dump(done, open("out/clips.json", "w"), indent=0)
# Pages of 10 rows.
done.sort(key=lambda c: int(c["id"]))
for p in range(0, len(done), 10):
    rows = [Image.open(f'out/rows/{c["id"]}.jpg') for c in done[p:p + 10]]
    W = max(r.width for r in rows); page = Image.new("RGB", (W, 210 * len(rows)), "black")
    for i, r in enumerate(rows): page.paste(r, (0, 210 * i))
    page.save(f"out/page-{p // 10:03d}.jpg", quality=70)
print(len(done), "clips")
