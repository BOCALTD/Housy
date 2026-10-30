"use client";

import { useEffect, useRef, useState } from "react";

/** A play and stop button for a song in the music library, with how far through it is. */
export function TrackListen({ id, title }: { id: string; title: string }) {
  const a = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  const [pct, setPct] = useState(0);
  useEffect(() => () => { a.current?.pause(); }, []);
  function toggle() {
    if (!a.current) {
      const el = new Audio(`/music/${id}/audio`);
      el.ontimeupdate = () => setPct(el.duration ? (el.currentTime / el.duration) * 100 : 0);
      el.onended = () => { setOn(false); setPct(0); };
      a.current = el;
    }
    if (on) { a.current.pause(); setOn(false); } else { void a.current.play().catch(() => setOn(false)); setOn(true); }
  }
  return (
    <span className="listen">
      <button type="button" className="track-play" onClick={toggle} aria-pressed={on} aria-label={`${on ? "Stop" : "Listen to"} ${title}`}>
        {on ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>}
      </button>
      <span className="listen-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
    </span>
  );
}
