"use client";

import { useState } from "react";
import { toast } from "sonner";

/** Copies text, also on a plain-http address where browsers switch the clipboard API off (falls back to a hidden selection). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

/** A copy button that says "Copied" (and shows a toast) for a moment after it works. */
export function CopyButton({ text, label = "Copy", className = "btn", done = "Link copied" }: { text: string; label?: string; className?: string; done?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={`${className} copy-btn${copied ? " is-copied" : ""}`} aria-live="polite" onClick={async () => {
      const ok = await copyText(text);
      if (ok) { setCopied(true); toast.success(done); setTimeout(() => setCopied(false), 2200); }
      else toast.error("Copying is blocked here. Press and hold the link to copy it.");
    }}>
      {copied ? (
        <><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>Copied</>
      ) : (
        <><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>{label}</>
      )}
    </button>
  );
}

/** A link shown in a box with Copy beside it. */
export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="copy-field">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <CopyButton text={value} className="btn primary" />
    </div>
  );
}
