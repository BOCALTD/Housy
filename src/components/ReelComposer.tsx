"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MUSIC_GENRES, durationLabel } from "@/lib/music-rules";

type Track = { id: string; title: string; artist: string; genre: string; durationSec: number | null; licenceName: string; creditRequired: boolean };

/**
 * Posting a reel: choose the clip, then (optionally) a song from the platform's licensed library, where in the song to start,
 * and how loud the song and the clip's own sound are. A preview plays them together before anything is uploaded.
 */
export function ReelComposer({ tracks }: { tracks: Track[] }) {
  const [clip, setClip] = useState<{ url: string; seconds: number } | null>(null);
  const [trackId, setTrackId] = useState("");
  const [genre, setGenre] = useState("");
  const [q, setQ] = useState("");
  const [start, setStart] = useState(0);
  const [musicVol, setMusicVol] = useState(80);
  const [origVol, setOrigVol] = useState(40);
  const [listening, setListening] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const sample = useRef<HTMLAudioElement | null>(null);
  const song = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = tracks.find((t) => t.id === trackId) ?? null;
  const maxStart = track?.durationSec ? Math.max(0, Math.floor(track.durationSec - Math.max(5, clip?.seconds ?? 15))) : 0;

  const shown = useMemo(() => tracks.filter((t) => (!genre || t.genre === genre) && (!q || `${t.title} ${t.artist}`.toLowerCase().includes(q.toLowerCase()))), [tracks, genre, q]);
  const genres = useMemo(() => [...new Set(tracks.map((t) => t.genre))], [tracks]);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);
  useEffect(() => { setStart((s) => Math.min(s, maxStart)); }, [maxStart]);
  useEffect(() => () => { sample.current?.pause(); }, []);

  function pickFile(f: File | undefined) {
    stopPreview();
    if (!f) { setClip(null); return; }
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => setClip({ url, seconds: Number.isFinite(v.duration) ? v.duration : 15 });
    v.onerror = () => setClip({ url, seconds: 15 });
    v.src = url;
  }
  function listen(t: Track) {
    if (listening === t.id) { sample.current?.pause(); setListening(null); return; }
    sample.current?.pause();
    const a = new Audio(`/music/${t.id}/audio`);
    a.volume = 0.8; a.onended = () => setListening(null);
    void a.play().catch(() => setListening(null));
    sample.current = a; setListening(t.id);
  }
  function stopPreview() { video.current?.pause(); song.current?.pause(); setPreviewing(false); }
  function preview() {
    const v = video.current, s = song.current;
    if (!v) return;
    if (previewing) return stopPreview();
    sample.current?.pause(); setListening(null);
    v.currentTime = 0; v.volume = track ? origVol / 100 : 1; v.muted = false;
    if (s && track) { s.currentTime = start; s.volume = musicVol / 100; void s.play().catch(() => {}); }
    void v.play().catch(() => {});
    setPreviewing(true);
  }
  useEffect(() => { if (video.current) video.current.volume = track ? origVol / 100 : 1; if (song.current) song.current.volume = musicVol / 100; }, [origVol, musicVol, track]);

  return (
    <div className="stack composer">
      <label className="field">Video
        <input type="file" name="video" accept="video/mp4,video/webm" required onChange={(e) => pickFile(e.target.files?.[0])} />
        <small>MP4 or WebM, up to 4 MB (roughly 10 to 20 seconds). Only film what you own or have permission to show; do not show people&apos;s faces or documents without consent.</small>
      </label>

      <fieldset className="composer-music">
        <legend>Music <span className="muted small">(optional)</span></legend>
        {tracks.length === 0 ? <p className="small muted">The platform has not added songs to its music library yet. You can post without music, or with your clip&apos;s own sound.</p> : (
          <>
            <p className="small muted">Songs from the platform&apos;s licensed library. Other music cannot be added, because using songs without a licence breaks copyright.</p>
            <div className="composer-filter">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs" aria-label="Search songs" />
              <div className="music-chips" role="group" aria-label="Style">
                <button type="button" className={`music-chip${genre === "" ? " on" : ""}`} aria-pressed={genre === ""} onClick={() => setGenre("")}>All</button>
                {genres.map((g) => <button key={g} type="button" className={`music-chip${genre === g ? " on" : ""}`} aria-pressed={genre === g} onClick={() => setGenre(g)}>{MUSIC_GENRES[g as keyof typeof MUSIC_GENRES] ?? g}</button>)}
              </div>
            </div>
            <ul className="tracks" aria-label="Songs">
              <li className={trackId === "" ? "on" : ""}>
                <label className="track-pick"><input type="radio" name="musicPick" checked={trackId === ""} onChange={() => setTrackId("")} /><span><strong>No music</strong><small>Keep the clip&apos;s own sound</small></span></label>
              </li>
              {shown.map((t) => (
                <li key={t.id} className={trackId === t.id ? "on" : ""}>
                  <button type="button" className="track-play" onClick={() => listen(t)} aria-pressed={listening === t.id} aria-label={`${listening === t.id ? "Stop" : "Listen to"} ${t.title}`}>
                    {listening === t.id ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>}
                  </button>
                  <label className="track-pick"><input type="radio" name="musicPick" checked={trackId === t.id} onChange={() => setTrackId(t.id)} />
                    <span><strong>{t.title}</strong><small>{t.artist} · {MUSIC_GENRES[t.genre as keyof typeof MUSIC_GENRES] ?? t.genre}{t.durationSec ? ` · ${durationLabel(t.durationSec)}` : ""}</small></span>
                  </label>
                </li>
              ))}
              {shown.length === 0 ? <li className="small muted">No songs match.</li> : null}
            </ul>
          </>
        )}
        {track ? (
          <div className="stack composer-mix">
            <label className="field">Start the song at {durationLabel(start)}
              <input type="range" min={0} max={maxStart} step={1} value={start} onChange={(e) => { setStart(Number(e.target.value)); stopPreview(); }} disabled={maxStart === 0} aria-valuetext={durationLabel(start)} />
            </label>
            <div className="two">
              <label className="field">Song volume {musicVol}%<input type="range" min={0} max={100} step={5} value={musicVol} onChange={(e) => setMusicVol(Number(e.target.value))} /></label>
              <label className="field">Your clip&apos;s sound {origVol}%<input type="range" min={0} max={100} step={5} value={origVol} onChange={(e) => setOrigVol(Number(e.target.value))} /></label>
            </div>
            {track.creditRequired ? <p className="small muted">This song is credited on your reel: {track.title} by {track.artist}.</p> : null}
            <audio ref={song} src={`/music/${track.id}/audio`} preload="auto" hidden />
          </div>
        ) : null}
        <input type="hidden" name="musicTrackId" value={trackId} />
        <input type="hidden" name="musicStart" value={start} />
        <input type="hidden" name="musicVolume" value={musicVol} />
        <input type="hidden" name="originalVolume" value={origVol} />
      </fieldset>

      {clip ? (
        <div className="composer-preview">
          <video ref={video} src={clip.url} playsInline onEnded={stopPreview} aria-label="Your clip" />
          <button type="button" className="btn" onClick={preview}>{previewing ? "Stop the preview" : track ? "Preview with the song" : "Preview"}</button>
        </div>
      ) : null}
    </div>
  );
}
