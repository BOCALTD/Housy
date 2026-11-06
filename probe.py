import urllib.request, re, time, sys, json
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"}
urls = sys.argv[1:]
res = {}
for u in urls:
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40); t = r.read().decode("utf8", "replace"); code = r.status
    except urllib.error.HTTPError as e: t = ""; code = e.code
    except Exception as e: t = ""; code = str(e)[:60]
    ids = set(re.findall(r'videos/(\d+)/\1-(?:360|720)\.mp4', t))
    pex = set(re.findall(r'videos\.pexels\.com/video-files/(\d+)/', t))
    res[u] = [code, len(t), len(ids), len(pex)]
    print(u, code, len(t), "mixkit", len(ids), "pexels", len(pex), flush=True)
    time.sleep(2)
json.dump(res, open("out/probe.json", "w"), indent=1)
