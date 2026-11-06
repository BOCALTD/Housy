"""Downloads the chosen Mixkit clips at the best size offered, and (when a Pexels key is set) searches Pexels for Lagos footage."""
import os, sys, json, subprocess, urllib.request, urllib.parse, concurrent.futures as cf
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}
os.makedirs("out/clips", exist_ok=True)
MIX = open("mixkit.txt").read().split()
def mix(vid):
    for size in ("2160", "1080", "720"):
        u = f"https://assets.mixkit.co/videos/{vid}/{vid}-{size}.mp4"
        try:
            data = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120).read()
            if len(data) > 100000:
                f = f"out/clips/mixkit-{vid}.mp4"; open(f, "wb").write(data); return f"{vid} {size} {len(data)//1024}KB"
        except Exception: pass
    return f"{vid} FAILED"
with cf.ThreadPoolExecutor(6) as ex:
    for r in ex.map(mix, MIX): print(r, flush=True)
key = os.environ.get("PEXELS_API_KEY", "")
if not key: print("no Pexels key; skipped"); sys.exit(0)
os.makedirs("out/pexels", exist_ok=True)
found = []
for q in open("pexels.txt").read().strip().split("\n"):
    for page in (1, 2):
        u = "https://api.pexels.com/videos/search?" + urllib.parse.urlencode({"query": q, "per_page": 40, "page": page})
        try: d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={**UA, "Authorization": key}), timeout=60).read())
        except Exception as e: print("pexels fail", q, e); continue
        for v in d.get("videos", []):
            files = sorted([f for f in v["video_files"] if f.get("height")], key=lambda f: f["height"])
            small = next((f for f in files if f["height"] >= 360), files[0] if files else None)
            big = [f for f in files if 1080 <= max(f["width"], f["height"]) <= 1920] or files[-1:]
            if small: found.append({"id": v["id"], "q": q, "url": v["url"], "user": v["user"]["name"], "w": v["width"], "h": v["height"], "dur": v["duration"], "small": small["link"], "big": big[-1]["link"] if big else small["link"]})
        print(q, page, len(found), flush=True)
seen = {}; [seen.setdefault(f["id"], f) for f in found]
json.dump(list(seen.values()), open("out/pexels/index.json", "w"), indent=0)
