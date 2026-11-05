"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Item = { id: string; name: string; thumb: string; state: "waiting" | "preparing" | "sending" | "done" | "failed"; error?: string };
const LONG_SIDE = 2048;

/** Resize to at most 2048 px on the long side and re-encode as JPEG: quicker uploads, and location and camera data are dropped. */
async function prepare(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error("Not a picture");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("This picture could not be opened")); i.src = url; });
    const k = Math.min(1, LONG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); if (!g) throw new Error("This browser cannot prepare pictures");
    g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.86, 0.78, 0.7, 0.6]) {
      const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
      if (b && b.size < 3.8 * 1024 * 1024) return new File([b], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw new Error("Too large even after resizing");
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Add several photographs at once: tap the button (or drop pictures on it), pick as many as you like, and each is prepared on the
 * device and sent in turn with its own progress. The listing's limit is respected; what does not fit is said, not dropped silently.
 */
export function PhotoUploader({ assetId, remaining, max, upload }: {
  assetId: string; remaining: number; max: number;
  upload: (form: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<"PHOTO" | "FLOOR_PLAN">("PHOTO");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const patch = (id: string, p: Partial<Item>) => setItems((all) => all.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function run(files: File[]) {
    if (!files.length || busy) return;
    const room = Math.max(0, remaining - items.filter((i) => i.state === "done").length);
    const take = files.slice(0, room);
    if (files.length > room) toast.warning(room ? `Only ${room} more picture${room === 1 ? "" : "s"} fit (the most is ${max}). The first ${room} will be added.` : `This listing already has ${max} pictures. Remove one to add another.`);
    if (!take.length) return;
    const batch: Item[] = take.map((f, n) => ({ id: `${Date.now()}-${n}`, name: f.name, thumb: URL.createObjectURL(f), state: "waiting" }));
    setItems((all) => [...all, ...batch]);
    setBusy(true);
    let ok = 0;
    for (let n = 0; n < take.length; n++) {
      const it = batch[n];
      try {
        patch(it.id, { state: "preparing" });
        const file = await prepare(take[n]);
        patch(it.id, { state: "sending" });
        const fd = new FormData(); fd.set("assetId", assetId); fd.set("kind", kind); fd.set("caption", ""); fd.set("file", file);
        const r = await upload(fd);
        if (!r.ok) throw new Error(r.error || "Not saved");
        patch(it.id, { state: "done" }); ok++;
      } catch (e) { patch(it.id, { state: "failed", error: (e as Error).message }); }
    }
    setBusy(false);
    if (ok) { toast.success(`${ok} picture${ok === 1 ? "" : "s"} added. A live listing goes back to review until it is approved again.`); router.refresh(); }
    if (ok < take.length) toast.error(`${take.length - ok} picture${take.length - ok === 1 ? "" : "s"} could not be added. See the list.`);
  }

  const label = { waiting: "Waiting", preparing: "Preparing…", sending: "Uploading…", done: "Added", failed: "Not added" } as const;
  return (
    <div className="uploader">
      <fieldset className="choice-row">
        <legend className="small muted">These pictures are</legend>
        <label className="chip-choice"><input type="radio" name="up-kind" checked={kind === "PHOTO"} onChange={() => setKind("PHOTO")} /><span>Photographs</span></label>
        <label className="chip-choice"><input type="radio" name="up-kind" checked={kind === "FLOOR_PLAN"} onChange={() => setKind("FLOOR_PLAN")} /><span>Floor plans</span></label>
      </fieldset>
      <button type="button" className={`drop${over ? " over" : ""}`} disabled={busy || remaining <= 0} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m21 16-5-5-7 7" /><path d="M12 2v5M9.5 4.5 12 2l2.5 2.5" /></svg>
        <strong>{busy ? "Adding your pictures…" : remaining > 0 ? "Add photos" : "Picture limit reached"}</strong>
        <span>{remaining > 0 ? `Choose several at once, or drop them here. ${remaining} of ${max} left.` : `Remove a picture to add another.`}</span>
      </button>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => { void run([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {items.length ? (
        <ul className="up-list" aria-live="polite">
          {items.map((it) => (
            <li key={it.id} className={`up-${it.state}`}>
              <img src={it.thumb} alt="" />
              <span className="up-name">{it.name}</span>
              <span className="up-state">{label[it.state]}{it.error ? `: ${it.error}` : ""}</span>
              <span className="up-bar" aria-hidden="true"><i /></span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
