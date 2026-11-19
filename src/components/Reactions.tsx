"use client";

import { useState } from "react";
import { toast } from "sonner";
import { reactAction, shareStateAction } from "@/app/reaction-actions";
import type { Summary, Value } from "@/lib/services/reactions";
import { showUndo } from "./Toasts";
import ShareButton from "./ShareButton";
import type { ShareKind } from "@/lib/share-rules";

const Thumb = ({ down }: { down?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7" />
  </svg>
);

/**
 * Like, dislike and share for a property, reel or banner. One reaction each (tap again to clear it). Sharing goes through the share
 * window; once shared, "Shared · Take back" removes it from the count and from your list. Every change offers Undo.
 */
export function Reactions({ kind, id, initial, signedIn, share, compact = false, noLike = false }: {
  kind: "LISTING" | "REEL" | "BANNER"; id: string; initial: Summary; signedIn: boolean; compact?: boolean;
  /** Leave out the like button (the reel rail has its own heart). */
  noLike?: boolean;
  /** The share window's details; leave out for no share button (the reel rail has its own). */
  share?: { kind: ShareKind; path: string; title: string; text: string; photos?: string[] };
}) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const signIn = () => toast.message("Sign in to like, dislike or keep track of shares.", { action: { label: "Sign in", onClick: () => { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; } } });

  async function react(v: "LIKE" | "DISLIKE") {
    if (!signedIn) return signIn();
    if (busy) return;
    const before = s.mine;
    const next: Value = before === v ? null : v;
    // Shown at once; put back if the server says no.
    setS((x) => ({ ...x, mine: next, likes: x.likes + (next === "LIKE" ? 1 : 0) - (before === "LIKE" ? 1 : 0), dislikes: x.dislikes + (next === "DISLIKE" ? 1 : 0) - (before === "DISLIKE" ? 1 : 0) }));
    setBusy(true);
    const r = await reactAction(kind, id, next);
    setBusy(false);
    if (!r.ok) { setS(s); toast.error(r.error); return; }
    setS(r.summary);
    const what = next === "LIKE" ? "Liked" : next === "DISLIKE" ? "Disliked" : before === "LIKE" ? "Like removed" : "Dislike removed";
    showUndo(what, async () => {
      const u = await reactAction(kind, id, before);
      if (u.ok) setS(u.summary);
      return u.ok ? { ok: true as const, message: "Undone." } : { ok: false as const, error: u.error };
    });
  }

  async function shared(on: boolean, quiet = false) {
    if (!signedIn) { if (!quiet) signIn(); return; }
    const before = s.shared;
    if (before === on) return;
    const r = await shareStateAction(kind, id, on);
    if (!r.ok) { if (!quiet) toast.error(r.error); return; }
    setS(r.summary);
    showUndo(on ? "Added to what you shared" : "Share taken back", async () => {
      const u = await shareStateAction(kind, id, before);
      if (u.ok) setS(u.summary);
      return u.ok ? { ok: true as const, message: "Undone." } : { ok: false as const, error: u.error };
    });
  }

  return (
    <div className={`reactions-bar${compact ? " compact" : ""}`} role="group" aria-label="Like, dislike or share">
      {noLike ? null : <button type="button" className={`btn react${s.mine === "LIKE" ? " on" : ""}`} aria-pressed={s.mine === "LIKE"} onClick={() => void react("LIKE")} aria-label={`Like, ${s.likes}`}>
        <Thumb /><span>{s.likes}</span>
      </button>}
      <button type="button" className={`btn react${s.mine === "DISLIKE" ? " on down" : ""}`} aria-pressed={s.mine === "DISLIKE"} onClick={() => void react("DISLIKE")} aria-label={`Dislike, ${s.dislikes}`}>
        <Thumb down /><span>{s.dislikes}</span>
      </button>
      {share ? <ShareButton kind={share.kind} path={share.path} title={share.title} text={share.text} photos={share.photos} signedIn={signedIn} small={compact} onShared={() => void shared(true, true)} /> : null}
      {s.shared ? (
        <span className="shared-chip">Shared{s.shares > 1 ? ` · ${s.shares} people` : ""} <button type="button" className="linklike" onClick={() => void shared(false)}>Take back</button></span>
      ) : kind === "REEL" ? null : s.shares > 0 ? <span className="small muted">{s.shares} {s.shares === 1 ? "share" : "shares"}</span> : null}
    </div>
  );
}
