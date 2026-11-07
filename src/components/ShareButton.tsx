"use client";

import { toast } from "sonner";
import { copyText } from "./CopyButton";

import { useEffect, useId, useRef, useState } from "react";
import { shareCodeAction } from "@/app/share-actions";
import { shareAction as countReelShare } from "@/app/reels/actions";
import { NETWORKS, networkLink, shareLink, type ShareKind } from "@/lib/share-rules";

/**
 * Share a property, reel, agent or company anywhere: the phone's own share sheet (with the photos attached where the phone allows
 * it, which is how they reach Instagram, Status and Stories), the main social networks, email and text, or copy the words and link.
 * Every shared link opens the page again, greets the visitor and invites them to sign up; a signed-in sharer's link carries their
 * invite code.
 */
export default function ShareButton({ kind, path, title, text, photos = [], video, reelId, count, signedIn, small = false, rail = false }: {
  kind: ShareKind; path: string; title: string; text: string; photos?: string[]; video?: string;
  reelId?: string; count?: number; signedIn: boolean; small?: boolean;
  /** Drawn as an icon with its count in the reels side rail. */
  rail?: boolean;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const headId = `share-h-${useId().replace(/:/g, "")}`;
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(count ?? 0);
  const [counted, setCounted] = useState(false);
  const [canFiles, setCanFiles] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    try {
      const probe = new File([new Uint8Array(1)], "x.jpg", { type: "image/jpeg" });
      setCanFiles(typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
    } catch { setCanFiles(false); }
  }, []);

  // The phone only opens its share sheet straight from a tap: anything slow before navigator.share (fetching the link or the
  // video) makes it refuse. So the link and the files are prepared when the dialog opens, and the tap shares at once.
  const [prepared, setPrepared] = useState<File[] | null>(null);
  const [prep, setPrep] = useState<"idle" | "loading" | "ready" | "none">("idle");
  const hasMedia = !!video || photos.length > 0;

  async function link(): Promise<string> {
    if (url) return url;
    let code: string | null = null;
    if (signedIn) { try { code = await shareCodeAction(path); } catch { code = null; } }
    const u = shareLink(window.location.origin, path, code);
    setUrl(u);
    return u;
  }

  async function prepareFiles() {
    if (!canFiles || !hasMedia || prep === "loading" || prep === "ready") return;
    setPrep("loading");
    const f = await files();
    const ok = f.length > 0 && !!navigator.canShare?.({ files: f });
    setPrepared(ok ? f : null);
    setPrep(ok ? "ready" : "none");
  }

  async function open() {
    setStatus("");
    await link();
    box.current?.showModal();
    void prepareFiles();
  }

  /** Counted only when a share really happened (the phone says it was sent). Copying or opening a network is not a share;
   * those count when someone opens the shared link. */
  async function counted1() {
    if (reelId && signedIn && !counted) {
      setCounted(true);
      try { setN(await countReelShare(reelId)); } catch { /* counting is best effort */ }
    }
  }

  async function files(): Promise<File[]> {
    const list: File[] = [];
    const want = video ? [video] : photos.slice(0, 4);
    const limit = video ? 60_000_000 : 15_000_000; // bigger than this and most share sheets give up
    for (const [i, src] of want.entries()) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size > limit) continue;
        const type = blob.type || (video ? "video/mp4" : "image/jpeg");
        const ext = type.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") || (video ? "mp4" : "jpg");
        list.push(new File([blob], `${kind}-${i + 1}.${ext}`, { type }));
      } catch { /* skip a file that will not load */ }
    }
    return list;
  }

  function nativeShare(withFiles: boolean) {
    if (!url) { setStatus("The link is still being made. Try again in a moment."); return; }
    // With files attached many apps drop the separate link, so it goes in the words too; without files it goes once, as the link.
    const data: ShareData = withFiles && prepared ? { title, text: `${text}\n${url}`, files: prepared } : { title, text, url };
    let p: Promise<void>;
    try { p = navigator.share(data); } catch (e) { p = Promise.reject(e); }
    setBusy(true);
    p.then(() => { setStatus("Shared"); return counted1(); })
      .catch((e: Error) => {
        if (e?.name === "AbortError") { setStatus(""); return; } // they closed the share sheet: nothing was shared
        setStatus(withFiles ? "This phone would not attach the file. Use Share link with an app, or download it below." : "Sharing did not open here. Use a button below or copy the link.");
      })
      .finally(() => setBusy(false));
  }

  async function copy(what: "link" | "all") {
    const u = await link();
    try {
      if (!(await copyText(what === "link" ? u : `${text}\n${u}`))) throw new Error("blocked");
      toast.success(what === "link" ? "Link copied" : "Text and link copied");
      setStatus(what === "link" ? "Link copied. It counts as a share when someone opens it." : "Text and link copied: paste them with the photos");
    } catch { setStatus("Copying is blocked here. Press and hold the link to copy it."); }
  }

  const ShareIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );

  return (
    <>
      {rail ? (
        <button type="button" className="rf-act" onClick={open} aria-haspopup="dialog" aria-label={`Share${reelId ? `, ${n} shares` : ""}`}>
          <span className="rf-ico"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3 11 14M22 3l-7 19-4-8-8-4 19-7Z" /></svg></span>
          <span className="rf-n">{n}</span>
        </button>
      ) : (
        <button type="button" className={`btn share-btn${small ? " small" : ""}`} onClick={open} aria-haspopup="dialog">
          {ShareIcon}<span>Share{reelId ? ` (${n})` : ""}</span>
        </button>
      )}
      <dialog ref={box} className="share-sheet" aria-labelledby={headId} onClick={(e) => { if (e.target === box.current) box.current?.close(); }}>
        <div className="share-inner stack">
          <div className="row between share-head">
            <h2 id={headId}>Share {{ property: "this property", reel: "this reel", agent: "this agent", company: "this company" }[kind]}</h2>
            <button type="button" className="btn share-close" aria-label="Close" onClick={() => box.current?.close()}>×</button>
          </div>
          <div className="share-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photos[0] ? <img src={photos[0]} alt="" loading="lazy" /> : <span className="share-preview-mark" aria-hidden="true">{ShareIcon}</span>}
            <p className="small">{text.split("\n").slice(0, 3).join("\n")}</p>
          </div>
          {canShare ? (
            <div className="share-primary">
              {canFiles && hasMedia && prep !== "none" ? (
                <button type="button" className="btn primary" disabled={busy || prep !== "ready"} onClick={() => nativeShare(true)}>
                  {prep !== "ready" ? (video ? "Getting the video ready…" : "Getting the photos ready…") : video ? "Share the video and link" : `Share ${prepared?.length ?? 1} photo${(prepared?.length ?? 1) === 1 ? "" : "s"} and link`}
                </button>
              ) : null}
              <button type="button" className={`btn${canFiles && hasMedia && prep !== "none" ? "" : " primary"}`} disabled={busy || !url} onClick={() => nativeShare(false)}>Share link with an app</button>
              {canFiles && hasMedia && prep === "none" ? <p className="small muted">{video ? "This video is too large to attach here, so share the link: it opens the reel." : "These photos cannot be attached here, so share the link or download them below."}</p> : null}
            </div>
          ) : null}
          <ul className="share-grid" aria-label="Share to">
            {NETWORKS.map((nw) => (
              <li key={nw.key}>
                <a className={`share-net share-${nw.key}`} href={url ? networkLink(nw.key, url, text, title) : "#"} target={nw.key === "email" || nw.key === "sms" ? undefined : "_blank"} rel="noopener noreferrer" onClick={(e) => { if (!url) e.preventDefault(); }}>
                  <span className="share-dot" aria-hidden="true" />{nw.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="share-copy">
            <label className="field">Link<input readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></label>
            <div className="row">
              <button type="button" className="btn" onClick={() => copy("link")}>Copy link</button>
              <button type="button" className="btn" onClick={() => copy("all")}>Copy text and link</button>
            </div>
          </div>
          {photos.length ? (
            <details className="inline">
              <summary>Download the photos ({photos.length})</summary>
              <p className="small muted">For Instagram, TikTok or a status: save the photos, then post them with the copied text and link.</p>
              <ul className="share-downloads">{photos.map((p, i) => <li key={p}><a className="btn small" href={p} download={`${kind}-${i + 1}.jpg`}>Photo {i + 1}</a></li>)}</ul>
            </details>
          ) : null}
          <p className="small muted">Whoever opens the link sees this page{kind === "property" ? " with the first photos and key details" : ""}, and is invited to sign up free to see more.{signedIn ? " If they join through your link, it counts towards your referral rewards." : ""}</p>
          <p className="small" role="status" aria-live="polite">{status}</p>
        </div>
      </dialog>
    </>
  );
}
