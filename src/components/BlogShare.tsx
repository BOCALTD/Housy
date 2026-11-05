"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { copyText } from "./CopyButton";
import { networkLink, type Network } from "@/lib/share-rules";

const NETS: { key: Network; label: string; color: string }[] = [
  { key: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { key: "facebook", label: "Facebook", color: "#1877F2" },
  { key: "x", label: "X", color: "#111" },
  { key: "linkedin", label: "LinkedIn", color: "#0A66C2" },
  { key: "telegram", label: "Telegram", color: "#229ED9" },
  { key: "email", label: "Email", color: "#6B7280" },
];

/** One-tap sharing for a blog post: the phone's own share sheet when there is one, the main networks, and copy link. */
export function BlogShare({ path, title, excerpt }: { path: string; title: string; excerpt: string }) {
  const [url, setUrl] = useState(path);
  const [native, setNative] = useState(false);
  useEffect(() => { setUrl(`${window.location.origin}${path}`); setNative(typeof navigator.share === "function"); }, [path]);
  const text = `${title}\n${excerpt}`;
  return (
    <div className="blog-share" aria-label="Share this article">
      <span className="small muted">Share</span>
      {native ? <button type="button" className="bs-btn" onClick={() => { navigator.share({ title, text: excerpt, url }).catch(() => undefined); }} aria-label="Share with an app"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 14v6h14v-6" /></svg></button> : null}
      {NETS.map((n) => (
        <a key={n.key} className="bs-btn" style={{ ["--c" as string]: n.color }} href={networkLink(n.key, url, text, title)} target="_blank" rel="noopener noreferrer" aria-label={`Share on ${n.label}`} title={n.label}>{n.label.slice(0, n.key === "linkedin" ? 2 : 1)}</a>
      ))}
      <button type="button" className="bs-btn bs-copy" onClick={async () => { if (await copyText(url)) toast.success("Link copied"); else toast.error("Could not copy. Hold the address bar to copy it."); }}>Copy link</button>
    </div>
  );
}
