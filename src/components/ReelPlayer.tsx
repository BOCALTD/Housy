"use client";

import { useState } from "react";

/** The clip is only loaded when someone presses play, so a page of reels stays light on a phone connection. */
export default function ReelPlayer({ id, label }: { id: string; label: string }) {
  const [on, setOn] = useState(false);
  if (!on) {
    return (
      <button type="button" className="reel-play" onClick={() => setOn(true)} aria-label={`Play reel: ${label}`}>
        <span aria-hidden="true" className="reel-play-icon">▶</span>
        <span>Play reel</span>
      </button>
    );
  }
  return <video className="reel-video" controls autoPlay playsInline src={`/reels/${id}/video`} aria-label={label} />;
}
