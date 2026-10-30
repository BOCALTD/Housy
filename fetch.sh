#!/usr/bin/env bash
set -u
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
mkdir -p out/music out/pages
echo "tag,url" > out/music.csv
for tag in corporate inspirational upbeat motivational happy africa cinematic; do
  for page in "https://mixkit.co/free-stock-music/tag/$tag/" "https://mixkit.co/free-stock-music/$tag/"; do
    code=$(curl -sL -A "$UA" -o "out/pages/$tag.html" -w "%{http_code}" "$page"); echo "$page $code $(wc -c < out/pages/$tag.html)"
    [ "$code" = 200 ] && break
  done
  grep -oE 'https://assets\.mixkit\.co/(music/[0-9]+/[0-9]+\.mp3|music/preview/[a-z0-9-]+\.mp3)' "out/pages/$tag.html" | awk '!s[$0]++' | head -8 | while read u; do
    f="out/music/$tag-$(basename $u)"; curl -sL -A "$UA" -o "$f" "$u" && echo "$tag,$u" >> out/music.csv
  done
done
for f in out/music/*.mp3; do echo "$(basename $f),$(ffprobe -v error -show_entries format=duration -of csv=p=0 $f)" >> out/info.csv; done
cat out/info.csv | head -60
