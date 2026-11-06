import urllib.request, re
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
pages = {"32043": "young-woman-walking-and-talking-on-the-phone", "32006": "woman-texting-on-her-smart-phone", "32005": "young-woman-checking-smart-phone-while-walking", "32008": "confident-woman-texting-and-walking", "32007": "young-confident-woman-looking-into-camera", "32003": "beautiful-confident-woman-outdoors"}
for vid, slug in pages.items():
    u = f"https://mixkit.co/free-stock-video/{slug}-{vid}/"
    try:
        t = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40).read().decode("utf8", "replace")
        urls = sorted(set(re.findall(r'https://assets\.mixkit\.co/[^"\' ]+?\.mp4', t)))
        sizes = re.findall(r'(\d{3,4}x\d{3,4})', t)[:6]
        print(vid, "OK", len(t), urls[:10], sizes, re.findall(r'download[^"]{0,80}', t)[:6])
    except Exception as e: print(vid, "ERR", e)
    for v in ("1080", "2160", "4k", "hd-ready", "full-hd"):
        for pat in (f"https://assets.mixkit.co/videos/{vid}/{vid}-{v}.mp4", f"https://assets.mixkit.co/videos/download/mixkit-{slug}-{vid}-{v}.mp4", f"https://assets.mixkit.co/videos/download/mixkit-{slug}-{vid}.mp4"):
            try:
                r = urllib.request.urlopen(urllib.request.Request(pat, headers=UA, method="HEAD"), timeout=30); print("  HEAD", r.status, r.headers.get("Content-Length"), pat)
            except Exception as e: print("  HEAD fail", str(e)[:30], pat)
