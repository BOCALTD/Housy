"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

const SIZE = { avatar: { w: 512, h: 512 }, cover: { w: 1800, h: 600 } } as const;

/** Crop to the target shape around the centre and re-encode as JPEG: smaller, and the photo's location and camera data are gone. */
async function prepare(file: File, kind: "avatar" | "cover"): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file is not a picture we can open")); i.src = url; });
    const { w, h } = SIZE[kind];
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale, sh = h / scale, sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); if (!g) throw new Error("This browser cannot prepare pictures");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    for (const q of [0.86, 0.78, 0.68]) {
      const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
      if (b && b.size < (kind === "avatar" ? 590 : 1580) * 1024) return b;
    }
    throw new Error("That picture is too detailed to shrink enough. Try another one.");
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Change a profile photo or cover photo: pick it, and it is prepared on the device and saved; the page then shows it.
 */
export function ProfileMedia({ kind, action, hasImage, remove, label }: {
  kind: "avatar" | "cover"; label: string; hasImage: boolean;
  action: (form: FormData) => Promise<void>; remove: (form: FormData) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onPick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const blob = await prepare(f, kind);
      setPreview(URL.createObjectURL(blob));
      const fd = new FormData(); fd.set("kind", kind); fd.set("file", new File([blob], `${kind}.jpg`, { type: "image/jpeg" }));
      start(async () => { await action(fd); });
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className={`pm pm-${kind}${pending ? " is-saving" : ""}`}>
      {preview && kind === "cover" ? <img className="pm-preview pm-preview-cover" src={preview} alt="" /> : null}
      <form action={action} encType="multipart/form-data" className="pm-form" onSubmit={(e) => e.preventDefault()}>
        <input type="hidden" name="kind" value={kind} />
        <input ref={input} className="pm-file" type="file" name="file" accept="image/jpeg,image/png,image/webp" aria-label={label} onChange={(e) => void onPick(e.target.files?.[0])} />
        <button type="button" className="pm-btn" onClick={() => input.current?.click()} disabled={pending}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          <span>{pending ? "Saving…" : label}</span>
        </button>
      </form>
      {hasImage && !pending ? (
        <form action={remove} className="pm-remove">
          <input type="hidden" name="kind" value={kind} />
          {kind === "avatar" ? (
            <button type="submit" className="pm-x" aria-label="Remove profile photo" title="Remove photo">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          ) : (
            <button type="submit" className="pm-btn ghost" aria-label="Remove cover photo">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
              <span>Remove</span>
            </button>
          )}
        </form>
      ) : null}
    </div>
  );
}
