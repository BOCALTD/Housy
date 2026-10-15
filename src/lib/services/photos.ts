import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { readStoredFile, saveFile, validateUpload } from "../storage";
import { assertCan, type Ctx } from "./context";

// Photographs attached to inspections, findings and work orders. A photograph is evidence, so the
// record cannot be edited or removed once saved.

export const PHOTO_SUBJECTS = ["inspection", "inspection_finding", "work_order", "handover_line"] as const;
export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number];
export const PHOTO_PHASES = ["BEFORE", "AFTER", "EVIDENCE"] as const;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface Upload { name: string; type: string; bytes: Uint8Array }

const metaSchema = z.object({
  phase: z.enum(PHOTO_PHASES).default("EVIDENCE"),
  caption: z.string().trim().max(300).default(""),
});

/** Save a photograph for a subject. The caller has already checked the subject belongs to this company and is open for evidence. */
export async function savePhoto(tx: Tx, ctx: Ctx, subjectType: PhotoSubject, subjectId: string, meta: z.input<typeof metaSchema>, file: Upload) {
  const data = metaSchema.parse(meta);
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Photographs must be JPG, PNG or WEBP images");
  validateUpload(file.type, file.bytes);
  const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
  const photo = await tx.evidencePhoto.create({
    data: {
      companyId: ctx.companyId, subjectType, subjectId, phase: data.phase, caption: data.caption,
      fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey, uploadedById: ctx.userId,
    },
  });
  await logActivity(tx, {
    companyId: ctx.companyId, actorId: ctx.userId, entityType: subjectType, entityId: subjectId,
    action: "photo.added", detail: { photoId: photo.id, phase: data.phase, caption: data.caption },
  });
  return photo;
}

/** Read a photograph for display. Any member who can view assets may see photographs in their own company. */
export async function getPhotoForDownload(ctx: Ctx, photoId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const photo = await tx.evidencePhoto.findFirst({ where: { id: photoId, companyId: ctx.companyId } });
    if (!photo) return null;
    return { photo, bytes: await readStoredFile(tx, ctx.companyId, photo.storageKey) };
  });
}

export async function photosFor(tx: Tx, companyId: string, subjectType: PhotoSubject, subjectIds: string[]) {
  if (subjectIds.length === 0) return [];
  return tx.evidencePhoto.findMany({
    where: { companyId, subjectType, subjectId: { in: subjectIds } }, orderBy: { createdAt: "asc" },
  });
}
