"use client";

import { useState } from "react";
import { shareAction } from "@/app/reels/actions";

/** Shares the link with the phone's share sheet when there is one, otherwise copies it. The share is counted once per person. */
export default function ShareReel({ id, count, signedIn }: { id: string; count: number; signedIn: boolean }) {
  const [n, setN] = useState(count);
  const [msg, setMsg] = useState("");
  async function go() {
    const url = `${window.location.origin}/reels/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: "Property reel", url });
      else { await navigator.clipboard.writeText(url); setMsg("Link copied"); }
    } catch { return; }
    if (signedIn) { try { setN(await shareAction(id)); } catch { /* counting is best effort */ } }
  }
  return <span className="row" style={{ gap: 6 }}><button type="button" className="btn small" onClick={go}>Share ({n})</button>{msg ? <span className="small muted" role="status">{msg}</span> : null}</span>;
}
