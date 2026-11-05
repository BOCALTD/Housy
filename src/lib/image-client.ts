/** In the browser: shrink a photo to at most `maxSide` pixels and re-encode as JPEG under `maxBytes`. Drops location and camera data. */
export async function shrinkImage(file: File, maxSide: number, maxBytes: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file is not a picture we can open")); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); if (!g) throw new Error("This browser cannot prepare pictures");
    g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.88, 0.8, 0.7, 0.6]) {
      const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
      if (b && b.size <= maxBytes) return new File([b], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw new Error("That picture is too large even after shrinking. Try another one.");
  } finally { URL.revokeObjectURL(url); }
}
