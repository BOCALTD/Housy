/**
 * The field kit's storage on the device (IndexedDB): downloaded inspections, drafts, photos and things waiting to send.
 * Everything is keyed by the signed-in user's id, so one person's work is never shown to another account on a shared device.
 * Browser-only.
 */
const DB = "housy-field", STORE = "kv";
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { opening = null; reject(req.error); };
    });
  }
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The device storage is full or blocked"));
  });
}

export const kvGet = <T>(key: string) => run<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
export const kvPut = (key: string, value: unknown) => run("readwrite", (s) => { s.put(value, key); });
export const kvDel = (key: string) => run("readwrite", (s) => { s.delete(key); });

export async function kvList<T>(prefix: string): Promise<[string, T][]> {
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>("readonly", (s) => s.getAllKeys(range)),
    run<T[]>("readonly", (s) => s.getAll(range) as IDBRequest<T[]>),
  ]);
  return (keys ?? []).map((k, i) => [String(k), (values ?? [])[i]]);
}

export async function kvClear(prefix: string) {
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  await run("readwrite", (s) => { s.delete(range); });
}

/** A photo made smaller on the device before it is stored: at most 1600 pixels on the long side, as a JPEG. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error("Choose a photo");
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (out) return out;
  } catch { /* fall back to the original below */ }
  if (file.size > 6 * 1024 * 1024) throw new Error("That photo is too large");
  return file;
}
