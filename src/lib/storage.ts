import { randomUUID } from "node:crypto";
import type { Tx } from "./db";

// Documents are stored in PostgreSQL (table stored_files), inside the same transaction and
// row-level security context as the document record. This works on serverless hosts such as
// Vercel, which have no permanent disk. Files are only served through an authorized route.
// Swap this module for an object store (S3-compatible) when volumes grow.

// Vercel limits a request body to 4.5 MB, so uploads are capped at 4 MB.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Files must be 4 MB or smaller");
  if (rule.magic && !rule.magic.every((b, i) => bytes[i] === b)) {
    throw new Error("The file contents do not match its type");
  }
}

export async function saveFile(tx: Tx, companyId: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const key = `${randomUUID()}.${ALLOWED[mimeType].ext}`;
  await tx.storedFile.create({ data: { key, companyId, bytes: Buffer.from(bytes) }, select: { key: true } });
  return key;
}

export async function readStoredFile(tx: Tx, companyId: string, key: string): Promise<Buffer> {
  const file = await tx.storedFile.findFirst({ where: { key, companyId } });
  if (!file) throw new Error("The stored file is missing");
  return Buffer.from(file.bytes);
}
