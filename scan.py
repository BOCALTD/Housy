"""Lists Mixkit free-licence clips for many searches (id, title, search) so a consistent cast can be chosen."""
import re, sys, json, urllib.request, html, time
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
Q = sys.argv[1:]
seen = {}
for q in Q:
    for page in (1, 2):
        url = f"https://mixkit.co/free-stock-video/{q}/" + (f"?page={page}" if page > 1 else "")
        try:
            t = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf8", "replace")
        except Exception as e:
            print("fail", q, page, e, file=sys.stderr); continue
        if q == Q[0] and page == 1: open("out/sample.html", "w").write(t)
        # Each card: the preview video then the title.
        for m in re.finditer(r'videos/(\d+)/\1-(?:360|720)\.mp4', t):
            vid = m.group(1)
            if vid in seen: continue
            tm = re.search(r'__title[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)', t[m.end(): m.end() + 4000])
            seen[vid] = {"id": vid, "q": q, "title": html.unescape(tm.group(1).strip()) if tm else ""}
        print(q, page, len(seen), file=sys.stderr)
        time.sleep(.5)
json.dump(list(seen.values()), open("out/index.json", "w"), indent=0)
