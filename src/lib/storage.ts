import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Document storage behind a small interface so it can be swapped for an object store
// (S3-compatible) without changing callers. Files are never served from a public folder:
// downloads go through an authorized route handler.

function root() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, { ext: string; magic?: number[] }> = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", magic: [0x50, 0x4b, 0x03, 0x04] },
};

export function validateUpload(mimeType: string, bytes: Uint8Array) {
  const rule = ALLOWED[mimeType];
  if (!rule) throw new Error("Upload a PDF, JPG, PNG, WEBP or Word (.docx) file");
  if (bytes.byteLength === 0) throw new Error("The file is empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Files must be 10 MB or smaller");
  if (rule.magic && !rule.magic.every((b, i) => bytes[i] === b)) {
    throw new Error("The file contents do not match its type");
  }
}

export async function saveFile(mimeType: string, bytes: Uint8Array): Promise<string> {
  const key = `${randomUUID()}.${ALLOWED[mimeType].ext}`;
  await mkdir(root(), { recursive: true });
  await writeFile(path.join(root(), key), bytes, { flag: "wx" });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\.[a-z]+$/.test(key)) throw new Error("Invalid storage key");
  return readFile(path.join(root(), key));
}
