"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { shrinkImage } from "@/lib/image-client";

/** The flatmate ID check: a photo of an ID and a selfie, each shrunk on the phone before sending. */
export function IdCheckForm({ types, action }: { types: Record<string, string>; action: (form: FormData) => Promise<void> }) {
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ doc?: string; selfie?: string }>({});
  const [pending, start] = useTransition();
  const pick = async (which: "doc" | "selfie", f?: File) => {
    if (!f) return;
    try {
      const small = await shrinkImage(f, 1600, 1.6 * 1024 * 1024);
      if (which === "doc") setDoc(small); else setSelfie(small);
      setPreview((p) => ({ ...p, [which]: URL.createObjectURL(small) }));
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <form className="stack idcheck" onSubmit={(e) => {
      e.preventDefault();
      if (!doc || !selfie) { toast.error("Add both the ID photo and the selfie"); return; }
      const fd = new FormData(e.currentTarget); fd.set("doc", doc); fd.set("selfie", selfie);
      start(async () => { await action(fd); });
    }}>
      <label className="field">Kind of ID<select name="idType" required defaultValue="NIN">{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <div className="idcheck-grid">
        <label className="idcheck-slot">
          {preview.doc ? <img src={preview.doc} alt="Your ID photo" /> : <span aria-hidden="true">🪪</span>}
          <strong>{doc ? "Change ID photo" : "Photo of your ID"}</strong>
          <small>The whole card, all four corners, readable.</small>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => void pick("doc", e.target.files?.[0])} />
        </label>
        <label className="idcheck-slot">
          {preview.selfie ? <img src={preview.selfie} alt="Your selfie" /> : <span aria-hidden="true">🤳</span>}
          <strong>{selfie ? "Change selfie" : "A selfie"}</strong>
          <small>Your face, well lit, no hat or sunglasses.</small>
          <input type="file" accept="image/*" capture="user" onChange={(e) => void pick("selfie", e.target.files?.[0])} />
        </label>
      </div>
      <p className="small muted">A Housy reviewer compares the two. They are used for nothing else, never shown to other people, and deleted 30 days after the decision.</p>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send for checking"}</button>
    </form>
  );
}
