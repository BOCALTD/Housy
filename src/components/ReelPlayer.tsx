"use client";

import { useRef, useState } from "react";

type Music = { trackId: string; mixed: boolean; startSec: number; volume: number; originalVolume: number } | null;

/** The clip is only loaded when someone presses play, so a page of reels stays light on a phone connection. A song that is not mixed into the clip plays alongside it. */
export default function ReelPlayer({ id, label, music = null }: { id: string; label: string; music?: Music }) {
  const [on, setOn] = useState(false);
  const song = useRef<HTMLAudioElement>(null);
  const side = music && !music.mixed ? music : null;
  if (!on) {
    return (
      <button type="button" className="reel-play" onClick={() => setOn(true)} aria-label={`Play reel: ${label}`}>
        <span aria-hidden="true" className="reel-play-icon">▶</span>
        <span>Play reel</span>
      </button>
    );
  }
  const sync = (v: HTMLVideoElement, ev: "play" | "pause" | "time") => {
    const a = song.current; if (!a || !side) return;
    const want = side.startSec + v.currentTime;
    if (ev === "pause") return a.pause();
    if (ev === "play") { a.volume = side.volume / 100; v.volume = side.originalVolume / 100; a.currentTime = want; void a.play().catch(() => {}); return; }
    if (!v.paused && Math.abs(a.currentTime - want) > 0.35) a.currentTime = want;
  };
  return (
    <>
      <video className="reel-video" controls autoPlay playsInline src={`/reels/${id}/video`} aria-label={label}
        onPlay={(e) => sync(e.currentTarget, "play")} onPause={(e) => sync(e.currentTarget, "pause")} onTimeUpdate={(e) => sync(e.currentTarget, "time")}
        onVolumeChange={(e) => { if (song.current) song.current.muted = e.currentTarget.muted; }} />
      {side ? <audio ref={song} src={`/music/${side.trackId}/audio`} preload="auto" /> : null}
    </>
  );
}
