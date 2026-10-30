"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ShareButton from "@/components/ShareButton";
import { shareText } from "@/lib/share-rules";
import { PLATFORM_NAME } from "@/lib/labels";
import type { ReelCard } from "@/lib/services/reels";
import { commentOn, commentsPage, followAgent, likeReel, morePage, reportReel, saveReel, watched } from "@/app/reels/live-actions";

type Tab = "foryou" | "following" | "trending";
type Comment = { id: string; authorName: string; body: string; createdAt: Date | string };
type Sheet = null | { kind: "signin"; verb: string; reelId: string } | { kind: "comments"; reel: ReelCard } | { kind: "more"; reel: ReelCard };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "A";
const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}m` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
const ago = (d: Date | string) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const Heart = ({ on }: { on: boolean }) => <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.4 7.7 3.6 4.5 7 4.5c2 0 3.5 1.2 5 3 1.5-1.8 3-3 5-3 3.4 0 5.6 3.2 4.3 6.6-1.8 4.8-9.3 9.4-9.3 9.4Z" /></svg>;
const Bubble = () => <svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.1A8.5 8.5 0 1 1 20.5 12Z" /></svg>;
const Mark = ({ on }: { on: boolean }) => <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2v-17Z" /></svg>;
const Dots = () => <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
const Sound = ({ off }: { off: boolean }) => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />{off ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>;

/**
 * Reels as a full-screen vertical feed: swipe or scroll up for the next one. Anyone can watch; liking, saving, commenting,
 * sharing and following ask a visitor to sign in or create an account first. Each clip is fetched once: the next one starts
 * loading in the background, and clips already watched play again from the browser and the app's cache without downloading.
 */
export function ReelFeed({ initial, pages, tab, signedIn, canPost }: { initial: ReelCard[]; pages: number; tab: Tab; signedIn: boolean; canPost: boolean }) {
  const [rows, setRows] = useState(initial);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(pages);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const loaded = useRef(new Set<number>([0, 1]));
  const box = useRef<HTMLDivElement>(null);
  const vids = useRef(new Map<number, HTMLVideoElement>());
  const loading = useRef(false);
  const tap = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null }>({ t: 0, timer: null });

  // The feed fills the screen below the site header, whatever its height on this device.
  useEffect(() => {
    const set = () => { const h = (document.querySelector("header.top") as HTMLElement | null)?.offsetHeight ?? 64; box.current?.style.setProperty("--rf-top", `${h}px`); };
    set(); window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  // Whichever reel is mostly on screen is the one playing.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number((e.target as HTMLElement).dataset.i));
    }, { root: el, threshold: [0.6] });
    el.querySelectorAll<HTMLElement>(".rf-slide").forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [rows.length]);

  useEffect(() => {
    // Load this one and the next two in the background; nothing is ever unloaded, so going back never downloads again.
    for (const i of [active - 1, active, active + 1, active + 2]) if (i >= 0 && i < rows.length) loaded.current.add(i);
    setPaused(false); setProgress(0);
    vids.current.forEach((v, i) => {
      if (i === active) { v.currentTime = v.currentTime || 0; v.play().catch(() => { /* autoplay with sound blocked: stays paused until a tap */ }); }
      else v.pause();
    });
    const r = rows[active];
    const timer = r && signedIn ? setTimeout(() => void watched(r.id, 3), 3000) : null;
    // Near the end, fetch the next page.
    if (active >= rows.length - 2 && page + 1 < total && !loading.current) {
      loading.current = true;
      morePage(tab, page + 1).then((m) => {
        setRows((old) => [...old, ...m.rows.filter((x) => !old.some((o) => o.id === x.id))]);
        setPage(m.page); setTotal(m.pages);
      }).catch(() => {}).finally(() => { loading.current = false; });
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [active, rows, page, total, tab, signedIn]);

  useEffect(() => { vids.current.forEach((v) => { v.muted = muted; }); }, [muted]);

  const go = useCallback((d: number) => {
    const el = box.current; if (!el) return;
    const next = Math.max(0, Math.min(rows.length - 1, active + d));
    el.querySelector<HTMLElement>(`.rf-slide[data-i="${next}"]`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active, rows.length]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement)?.closest("input, textarea, select, dialog")) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(1); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(-1); }
      if (e.key === "m") setMuted((m) => !m);
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  function togglePlay() {
    const v = vids.current.get(active); if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  }
  const patch = (id: string, p: Partial<ReelCard>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const needSignIn = (verb: string, reelId: string) => setSheet({ kind: "signin", verb, reelId });

  async function like(r: ReelCard, fromTap = false) {
    if (!signedIn) return needSignIn("like reels", r.id);
    if (fromTap) { setBurst(r.id); setTimeout(() => setBurst(null), 700); if (r.liked) return; }
    patch(r.id, { liked: !r.liked, likes: r.likes + (r.liked ? -1 : 1) });
    const out = await likeReel(r.id);
    if (!out.ok) { patch(r.id, { liked: r.liked, likes: r.likes }); if (out.signIn) needSignIn("like reels", r.id); else toast.error(out.error ?? "That did not work"); }
    else patch(r.id, { liked: out.liked, likes: out.count });
  }
  async function save(r: ReelCard) {
    if (!signedIn) return needSignIn("save reels", r.id);
    patch(r.id, { saved: !r.saved });
    const out = await saveReel(r.id);
    if (!out.ok) { patch(r.id, { saved: r.saved }); toast.error(out.error ?? "That did not work"); }
    else toast.success(out.saved ? "Saved to your reels" : "Removed from your saved reels");
  }
  async function followIt(r: ReelCard) {
    if (!signedIn) return needSignIn("follow agents", r.id);
    const on = !r.following;
    setRows((rs) => rs.map((x) => (x.authorId === r.authorId ? { ...x, following: on } : x)));
    const out = await followAgent(r.authorId, on);
    if (!out.ok) { setRows((rs) => rs.map((x) => (x.authorId === r.authorId ? { ...x, following: !on } : x))); toast.error(out.error ?? "That did not work"); }
    else toast.success(on ? `Following ${r.authorName}` : `Stopped following ${r.authorName}`);
  }

  function onTap(r: ReelCard) {
    const now = Date.now();
    if (now - tap.current.t < 280) { if (tap.current.timer) clearTimeout(tap.current.timer); tap.current = { t: 0, timer: null }; void like(r, true); return; }
    tap.current.t = now;
    tap.current.timer = setTimeout(() => { togglePlay(); tap.current.timer = null; }, 280);
  }

  if (!rows.length) {
    return (
      <div className="rf rf-empty" ref={box}>
        <div className="rf-empty-inner">
          <p>{tab === "following" ? "Follow agents and their reels will show here." : "No reels yet."}</p>
          {canPost ? <Link className="btn primary" href="/reels/new">Post the first reel</Link> : <Link className="btn" href="/">Browse properties</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="rf" ref={box} aria-roledescription="reels feed" aria-label="Property reels">
      {rows.map((r, i) => {
        const near = loaded.current.has(i);
        return (
          <section key={r.id} className="rf-slide" data-i={i} aria-label={`Reel ${i + 1} of ${rows.length}${r.caption ? `: ${r.caption}` : ""}`}>
            <video
              ref={(v) => { if (v) vids.current.set(i, v); else vids.current.delete(i); }}
              className="rf-video" src={near ? `/reels/${r.id}/video` : undefined} preload={i === active || i === active + 1 ? "auto" : "metadata"}
              muted={muted} loop playsInline aria-label={r.caption || "Property reel"}
              onTimeUpdate={(e) => { if (i === active) { const v = e.currentTarget; setProgress(v.duration ? v.currentTime / v.duration : 0); } }}
            />
            <button type="button" className="rf-tap" aria-label={paused && i === active ? "Play" : "Pause or play. Double tap to like"} onClick={() => onTap(r)} />
            {paused && i === active ? <span className="rf-paused" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg></span> : null}
            {burst === r.id ? <span className="rf-burst" aria-hidden="true"><Heart on /></span> : null}

            <div className="rf-rail">
              <div className="rf-avatar-wrap">
                <Link className="rf-avatar" href={`/agents/${r.authorId}`} aria-label={`${r.authorName}'s profile`}>{initials(r.authorName)}</Link>
                {!r.mine && !r.following ? <button type="button" className="rf-follow" onClick={() => followIt(r)} aria-label={`Follow ${r.authorName}`}><span aria-hidden="true">+</span></button> : null}
              </div>
              <button type="button" className={`rf-act${r.liked ? " on" : ""}`} onClick={() => like(r)} aria-pressed={r.liked} aria-label={`${r.liked ? "Unlike" : "Like"}, ${r.likes} likes`}>
                <span className="rf-ico"><Heart on={r.liked} /></span><span className="rf-n">{short(r.likes)}</span>
              </button>
              <button type="button" className="rf-act" onClick={() => setSheet({ kind: "comments", reel: r })} aria-label={`Comments, ${r.comments}`}>
                <span className="rf-ico"><Bubble /></span><span className="rf-n">{short(r.comments)}</span>
              </button>
              {signedIn ? (
                <ShareButton kind="reel" rail path={`/reels/${r.id}`} reelId={r.id} count={r.shares} signedIn video={`/reels/${r.id}/video`}
                  title={r.caption || r.listingTitle || "Property reel"}
                  text={shareText("reel", { title: r.caption || r.listingTitle || `A property reel by ${r.authorName}`, place: r.city, by: r.companyName ? `${r.authorName}, ${r.companyName}` : r.authorName }, PLATFORM_NAME)} />
              ) : (
                <button type="button" className="rf-act" onClick={() => needSignIn("share reels", r.id)} aria-label={`Share, ${r.shares} shares`}>
                  <span className="rf-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3 11 14M22 3l-7 19-4-8-8-4 19-7Z" /></svg></span><span className="rf-n">{short(r.shares)}</span>
                </button>
              )}
              <button type="button" className={`rf-act${r.saved ? " on" : ""}`} onClick={() => save(r)} aria-pressed={r.saved} aria-label={r.saved ? "Saved. Remove from saved" : "Save"}>
                <span className="rf-ico"><Mark on={r.saved} /></span>
              </button>
              <button type="button" className="rf-act" onClick={() => setSheet({ kind: "more", reel: r })} aria-label="More">
                <span className="rf-ico"><Dots /></span>
              </button>
            </div>

            <div className="rf-info">
              <div className="rf-who">
                <Link className="rf-name" href={`/agents/${r.authorId}`}><strong>{r.authorName}</strong></Link>
                {r.companyName ? <span className="rf-co">{r.companyName}</span> : null}
              </div>
              {r.caption ? <Caption text={r.caption} /> : null}
              <div className="rf-meta">
                {r.city ? <span className="rf-chip"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 19 9.5C19 14.7 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></svg>{r.city}</span> : null}
                {r.listingRef ? <Link className="rf-chip rf-chip-prop" href={`/properties/${r.listingRef}`}>See the property</Link> : null}
                {r.why[0] ? <span className="rf-why">{r.why[0]}</span> : null}
              </div>
            </div>
            {i === active ? <div className="rf-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div> : null}
          </section>
        );
      })}

      <div className="rf-top">
        <button type="button" className="rf-mute rf-top-left" onClick={() => setMuted((m) => !m)} aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Turn sound off"}><Sound off={muted} /></button>
        {canPost ? <Link className="rf-post rf-top-right" href="/reels/new" aria-label="Post a reel">+</Link> : null}
      </div>

      {sheet ? <SheetView sheet={sheet} signedIn={signedIn} onClose={() => setSheet(null)} onCommented={(id) => patch(id, { comments: (rows.find((x) => x.id === id)?.comments ?? 0) + 1 })} onSignIn={(verb, id) => setSheet({ kind: "signin", verb, reelId: id })} /> : null}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 90;
  if (!long) return <p className="rf-caption">{text}</p>;
  return (
    <button type="button" className="rf-caption rf-caption-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      {open ? text : `${text.slice(0, 88).trimEnd()}…`} <span className="rf-more-word">{open ? "less" : "more"}</span>
    </button>
  );
}

function SheetView({ sheet, signedIn, onClose, onCommented, onSignIn }: { sheet: NonNullable<Sheet>; signedIn: boolean; onClose: () => void; onCommented: (id: string) => void; onSignIn: (verb: string, id: string) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [cPage, setCPage] = useState({ page: 0, pages: 1, total: 0 });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const reelId = sheet.kind === "signin" ? sheet.reelId : sheet.reel.id;
  const back = `/reels?r=${encodeURIComponent(reelId)}`;

  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    if (sheet.kind !== "comments") return;
    commentsPage(sheet.reel.id, 0).then((c) => { setComments(c.rows); setCPage({ page: c.page, pages: c.pages, total: c.total }); }).catch(() => setComments([]));
  }, [sheet]);

  async function more() {
    if (sheet.kind !== "comments") return;
    const c = await commentsPage(sheet.reel.id, cPage.page + 1);
    setComments((old) => [...(old ?? []), ...c.rows]); setCPage({ page: c.page, pages: c.pages, total: c.total });
  }
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (sheet.kind !== "comments" || !body.trim()) return;
    setBusy(true);
    const out = await commentOn(sheet.reel.id, body);
    setBusy(false);
    if (!out.ok) { if (out.signIn) onSignIn("comment", sheet.reel.id); else toast.error(out.error ?? "That did not work"); return; }
    setComments((old) => [out.comment, ...(old ?? [])]); setBody(""); onCommented(sheet.reel.id);
  }
  async function report(e: React.FormEvent) {
    e.preventDefault();
    if (sheet.kind !== "more") return;
    const out = await reportReel(sheet.reel.id, reason);
    if (!out.ok) { if (out.signIn) onSignIn("report a reel", sheet.reel.id); else toast.error(out.error ?? "That did not work"); return; }
    toast.success("Thank you. The platform team will look at it."); onClose();
  }

  const title = sheet.kind === "signin" ? `Join to ${sheet.verb}` : sheet.kind === "comments" ? `Comments${cPage.total ? ` (${cPage.total})` : ""}` : "More";
  return (
    <div className="rf-sheet-back" onClick={onClose}>
      <div className="rf-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="rf-sheet-head">
          <span className="rf-grip" aria-hidden="true" />
          <h2>{title}</h2>
          <button ref={first} type="button" className="rf-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {sheet.kind === "signin" ? (
          <div className="stack rf-sheet-body">
            <p className="muted">Watching is free for everyone. To like, comment, share, save and follow agents, sign in or create a free account. It takes a minute.</p>
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(back)}`}>Sign in</Link>
            <Link className="btn" href={`/join?as=personal&next=${encodeURIComponent(back)}`}>Create a free account</Link>
          </div>
        ) : null}

        {sheet.kind === "comments" ? (
          <div className="rf-sheet-body rf-comments">
            {comments === null ? <p className="muted small">Loading…</p> : comments.length === 0 ? <p className="muted small">No comments yet. {signedIn ? "Be the first." : ""}</p> : (
              <ul>{comments.map((c) => <li key={c.id}><span className="rf-c-av" aria-hidden="true">{initials(c.authorName)}</span><div><strong>{c.authorName}</strong> <span className="muted small">{ago(c.createdAt)}</span><p>{c.body}</p></div></li>)}</ul>
            )}
            {cPage.page + 1 < cPage.pages ? <button type="button" className="btn small" onClick={more}>More comments</button> : null}
            {signedIn ? (
              <form className="rf-c-form" onSubmit={post}>
                <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} placeholder="Add a comment" aria-label="Your comment" />
                <button className="btn primary" type="submit" disabled={busy || !body.trim()}>Post</button>
              </form>
            ) : <button type="button" className="btn primary" onClick={() => onSignIn("comment", sheet.reel.id)}>Sign in to comment</button>}
          </div>
        ) : null}

        {sheet.kind === "more" ? (
          <div className="stack rf-sheet-body">
            {sheet.reel.listingRef ? <Link className="btn" href={`/properties/${sheet.reel.listingRef}`}>See the property{sheet.reel.listingTitle ? `: ${sheet.reel.listingTitle}` : ""}</Link> : null}
            <Link className="btn" href={`/agents/${sheet.reel.authorId}`}>{sheet.reel.authorName}&apos;s profile</Link>
            <Link className="btn" href={`/reels/${sheet.reel.id}`}>Open this reel on its own page</Link>
            {signedIn && !sheet.reel.mine ? (
              <form className="stack" onSubmit={report}>
                <label className="field">Report this reel<input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} placeholder="What is wrong?" /></label>
                <button className="btn" type="submit">Send report</button>
              </form>
            ) : null}
            {!signedIn ? <button type="button" className="btn" onClick={() => onSignIn("report a reel", sheet.reel.id)}>Report this reel</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
