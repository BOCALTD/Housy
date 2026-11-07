"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ThreadComment } from "@/lib/comment-rules";

/**
 * Comments, the same wherever people comment (reels, workspaces): like a comment, reply to it, delete your own, report
 * someone else's. Replying highlights the comment being answered, names it above the box, and puts the reply under it.
 */
type Out<T> = ({ ok: true } & T) | { ok: false; signIn?: true; error?: string };
export type ThreadActions = {
  post: (body: string, replyTo: string | null) => Promise<Out<{ comment: ThreadComment }>>;
  like: (id: string) => Promise<Out<{ liked: boolean; likes: number }>>;
  remove?: (id: string) => Promise<Out<{ deleted: number }>>;
  report?: (id: string, reason: string) => Promise<Out<object>>;
};

const initials = (s: string) => s.replace(/\[[^\]]*\]/g, " ").split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "•";
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}
/** "@Ada thanks" shows the name in bold, so it is clear who is being answered. */
function Body({ text }: { text: string }) {
  const m = /^(@[\p{L}\p{N}_-]+)(\s[\s\S]*)?$/u.exec(text);
  return m ? <p className="ct-body"><strong className="ct-at">{m[1]}</strong>{m[2] ?? ""}</p> : <p className="ct-body">{text}</p>;
}
const Heart = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
);

export function CommentThread({ initial, total: total0, signedIn, onSignIn, actions, maxLength = 500, placeholder = "Add a comment", hasMore, onMore, onCount, emptyText = "No comments yet.", rules }: {
  initial: ThreadComment[]; total: number; signedIn: boolean; onSignIn?: () => void; actions: ThreadActions; maxLength?: number; placeholder?: string;
  hasMore?: boolean; onMore?: () => Promise<ThreadComment[]>; onCount?: (delta: number) => void; emptyText?: string; rules?: string;
}) {
  const [list, setList] = useState(initial);
  const [total, setTotal] = useState(total0);
  const [replyTo, setReplyTo] = useState<{ id: string; root: string; name: string } | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setList(initial); }, [initial]);
  useEffect(() => { setTotal(total0); }, [total0]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1800); return () => clearTimeout(t); }, [flash]);
  useEffect(() => { if (!confirmDel) return; const t = setTimeout(() => setConfirmDel(null), 4000); return () => clearTimeout(t); }, [confirmDel]);

  const scrollTo = (id: string) => requestAnimationFrame(() => root.current?.querySelector(`[data-cid="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  const needSignIn = () => { if (onSignIn) onSignIn(); else toast("Sign in to take part."); };
  const update = (id: string, f: (c: ThreadComment) => ThreadComment) => setList((l) => l.map((c) => (c.id === id ? f(c) : { ...c, replies: c.replies.map((r) => (r.id === id ? f(r) : r)) })));

  function startReply(c: ThreadComment) {
    if (!signedIn) return needSignIn();
    const rootId = c.parentId ?? c.id;
    setReplyTo({ id: c.id, root: rootId, name: c.authorName });
    setOpen((o) => new Set(o).add(rootId));
    scrollTo(c.id);
    setTimeout(() => box.current?.focus(), 60);
  }
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn) return needSignIn();
    const text = body.trim(); if (!text || busy) return;
    setBusy(true);
    const out = await actions.post(text, replyTo?.id ?? null).catch(() => ({ ok: false as const, error: "That did not send. Check your connection and try again." }));
    setBusy(false);
    if (!out.ok) { if (out.signIn) needSignIn(); else toast.error(out.error ?? "That did not work"); return; }
    const c = out.comment;
    if (c.parentId) { setList((l) => l.map((t) => (t.id === c.parentId ? { ...t, replies: [...t.replies, c] } : t))); setOpen((o) => new Set(o).add(c.parentId!)); }
    else setList((l) => [c, ...l]);
    setTotal((n) => n + 1); onCount?.(1);
    setBody(""); setReplyTo(null); setFlash(c.id); scrollTo(c.id);
  }
  async function like(c: ThreadComment) {
    if (!signedIn) return needSignIn();
    update(c.id, (x) => ({ ...x, liked: !x.liked, likes: x.likes + (x.liked ? -1 : 1) }));
    const out = await actions.like(c.id).catch(() => ({ ok: false as const, error: "That did not work" }));
    if (!out.ok) { update(c.id, (x) => ({ ...x, liked: c.liked, likes: c.likes })); if (out.signIn) needSignIn(); else toast.error(out.error ?? "That did not work"); return; }
    update(c.id, (x) => ({ ...x, liked: out.liked, likes: out.likes }));
  }
  async function remove(c: ThreadComment) {
    if (!actions.remove) return;
    if (confirmDel !== c.id) { setConfirmDel(c.id); return; }
    setConfirmDel(null);
    const out = await actions.remove(c.id);
    if (!out.ok) { toast.error(out.error ?? "That did not work"); return; }
    setList((l) => (c.parentId ? l.map((t) => (t.id === c.parentId ? { ...t, replies: t.replies.filter((r) => r.id !== c.id) } : t)) : l.filter((t) => t.id !== c.id)));
    setTotal((n) => Math.max(0, n - out.deleted)); onCount?.(-out.deleted);
    if (replyTo && (replyTo.id === c.id || replyTo.root === c.id)) setReplyTo(null);
    toast.success("Comment deleted.");
  }
  async function report(e: React.FormEvent, c: ThreadComment) {
    e.preventDefault();
    if (!actions.report) return;
    const out = await actions.report(c.id, reason);
    if (!out.ok) { if (out.signIn) needSignIn(); else toast.error(out.error ?? "That did not work"); return; }
    setReporting(null); setReason(""); toast.success("Thank you. The platform team will look at it.");
  }
  async function more() {
    if (!onMore) return;
    const rows = await onMore().catch(() => []);
    setList((l) => [...l, ...rows.filter((r) => !l.some((x) => x.id === r.id))]);
  }

  const item = (c: ThreadComment, isReply: boolean) => {
    const target = replyTo?.id === c.id;
    return (
      <li key={c.id} data-cid={c.id} className={`ct-item${isReply ? " ct-reply" : ""}${target ? " is-target" : ""}${flash === c.id ? " is-new" : ""}`}>
        <span className="ct-av" aria-hidden="true">{initials(c.authorName)}</span>
        <div className="ct-main">
          <p className="ct-head"><strong>{c.authorName}</strong> <time className="ct-time" dateTime={c.createdAt} suppressHydrationWarning>{ago(c.createdAt)}</time>{target ? <span className="ct-tag">Replying</span> : null}</p>
          <Body text={c.body} />
          <div className="ct-acts">
            <button type="button" className={`ct-btn ct-like${c.liked ? " on" : ""}`} onClick={() => void like(c)} aria-pressed={c.liked} aria-label={`${c.liked ? "Unlike" : "Like"} ${c.authorName}'s comment${c.likes ? `, ${c.likes} likes` : ""}`}>
              <Heart on={c.liked} /><span>{c.likes || ""}</span>
            </button>
            <button type="button" className="ct-btn" onClick={() => startReply(c)} aria-label={`Reply to ${c.authorName}`}>Reply</button>
            {c.mine && actions.remove ? <button type="button" className={`ct-btn${confirmDel === c.id ? " danger" : ""}`} onClick={() => void remove(c)}>{confirmDel === c.id ? "Tap again to delete" : "Delete"}</button> : null}
            {!c.mine && signedIn && actions.report ? <button type="button" className="ct-btn" onClick={() => setReporting(reporting === c.id ? null : c.id)} aria-expanded={reporting === c.id}>Report</button> : null}
          </div>
          {reporting === c.id ? (
            <form className="ct-report" onSubmit={(e) => void report(e, c)}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} placeholder="What is wrong with this comment?" aria-label="Why you are reporting this comment" />
              <button className="btn small" type="submit">Send</button>
            </form>
          ) : null}
          {!isReply && c.replies.length ? (
            open.has(c.id) || c.replies.length <= 2 ? (
              <ul className="ct-replies">{c.replies.map((r) => item(r, true))}</ul>
            ) : (
              <button type="button" className="ct-more-replies" onClick={() => setOpen((o) => new Set(o).add(c.id))}>View {c.replies.length} replies</button>
            )
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="ct" ref={root}>
      {list.length === 0 ? <p className="muted small ct-empty">{emptyText}{signedIn ? " Be the first." : ""}</p> : <ul className="ct-list">{list.map((c) => item(c, false))}</ul>}
      {hasMore && onMore ? <button type="button" className="btn small ct-load" onClick={() => void more()}>More comments</button> : null}
      {signedIn ? (
        <form className={`ct-form${replyTo ? " replying" : ""}`} onSubmit={(e) => void post(e)}>
          {replyTo ? (
            <p className="ct-replying" aria-live="polite">Replying to <strong>{replyTo.name}</strong>
              <button type="button" className="ct-cancel" onClick={() => setReplyTo(null)} aria-label="Cancel the reply">×</button></p>
          ) : null}
          <div className="ct-row">
            <textarea ref={box} value={body} rows={1} maxLength={maxLength} placeholder={replyTo ? `Reply to ${replyTo.name}` : placeholder} aria-label={replyTo ? `Your reply to ${replyTo.name}` : "Your comment"}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && replyTo) { e.preventDefault(); e.stopPropagation(); setReplyTo(null); }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); }
              }} />
            <button className="btn primary" type="submit" disabled={busy || !body.trim()}>{busy ? "…" : replyTo ? "Reply" : "Post"}</button>
          </div>
          {rules ? <p className="small muted ct-rules">{rules}</p> : null}
        </form>
      ) : (
        <button type="button" className="btn primary" onClick={needSignIn}>Sign in to comment</button>
      )}
      <span className="sr-only" aria-live="polite">{total ? `${total} comments` : ""}</span>
    </div>
  );
}
