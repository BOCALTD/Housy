#!/usr/bin/env bash
# Gathers candidate free-licence clips (Mixkit and Pexels licences allow use in adverts) and contact sheets to choose from.
set -u
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
mkdir -p out/clips out/sheets
echo "source,query,url,page" > out/clips.csv
mix() { # mixkit
  q=$1; page="https://mixkit.co/free-stock-video/$q/"
  html=$(curl -sL -A "$UA" "$page"); echo "mixkit $q: $(echo "$html" | wc -c) bytes"
  echo "$html" | grep -oE 'https://assets\.mixkit\.co/videos/[0-9]+/[0-9]+-720\.mp4' | awk '!s[$0]++' | head -${2:-6} | while read u; do
    id=$(basename "$u" .mp4); f="out/clips/mixkit-$q-$id.mp4"
    curl -sL -A "$UA" -o "$f" "$u" && echo "mixkit,$q,$u,$page" >> out/clips.csv
  done
}
pex() {
  q=$1; page="https://www.pexels.com/search/videos/$q/?orientation=portrait"
  code=$(curl -sL -A "$UA" -o /tmp/p.html -w "%{http_code}" "$page"); echo "pexels $q: $code $(wc -c < /tmp/p.html)"
  grep -oE 'https://videos\.pexels\.com/video-files/[0-9]+/[^"?]+\.mp4' /tmp/p.html | grep -E '720|1080|hd' | awk -F/ '!s[$5]++' | head -${2:-6} | while read u; do
    f="out/clips/pexels-$q-$(echo $u | cut -d/ -f5).mp4"
    curl -sL -A "$UA" -o "$f" "$u" && echo "pexels,$q,$u,$page" >> out/clips.csv
  done
}
for q in real-estate house apartment city african family keys couple smartphone aerial luxury office lagos; do mix $q 6; done
for q in lagos nigeria abuja african%20family%20home house%20keys real%20estate%20agent apartment%20tour; do pex "$q" 6; done
# Contact sheet per clip: 4 frames.
for f in out/clips/*.mp4; do
  [ -s "$f" ] || { rm -f "$f"; continue; }
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" 2>/dev/null || echo 0)
  ffmpeg -v error -y -i "$f" -vf "fps=4/${d%.*}.0,scale=240:-2,tile=4x1" -frames:v 1 "out/sheets/$(basename "$f" .mp4).jpg" 2>/dev/null || true
  echo "$(basename $f),$d,$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$f")" >> out/info.csv
done
du -sh out/clips; ls out/clips | wc -l
