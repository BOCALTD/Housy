import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly } from "../dates";
import { saveFile, validateUpload, readStoredFile } from "../storage";
import { assertCan, type Ctx } from "./context";

export const ASSET_CLASSES = ["RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "PLANT_MACHINERY", "OTHER"] as const;
export const ASSET_STATUSES = ["ACTIVE", "VACANT", "OCCUPIED", "UNDER_RENOVATION", "DISPOSED", "ARCHIVED"] as const;
export const COMPANY_RELATIONSHIPS = ["OWNER", "MANAGER", "CUSTODIAN", "LISTING_AGENT"] as const;
export const PARTY_RELATIONSHIPS = [
  "LEGAL_OWNER", "BENEFICIAL_OWNER", "PROPERTY_MANAGER", "CUSTODIAN", "LESSEE",
  "LISTING_AGENT", "MAINTENANCE_RESPONSIBLE", "INCOME_COLLECTOR",
] as const;
export const DOCUMENT_CATEGORIES = [
  "TITLE_OWNERSHIP", "LEASE_AGREEMENT", "MANAGEMENT_AGREEMENT", "SURVEY_PLAN", "VALUATION_REPORT",
  "INSPECTION_REPORT", "INSURANCE", "TAX_RECEIPT", "PERMIT_APPROVAL", "CORRESPONDENCE", "OTHER",
] as const;

const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const optionalKobo = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null));

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter the asset name").max(200),
  assetClass: z.enum(ASSET_CLASSES),
  category: z.string().trim().min(2, "Enter a category, for example Duplex or Generator").max(80),
  description: z.string().trim().max(5000).default(""),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(80).default(""),
  state: z.string().trim().max(80).default(""),
  status: z.enum(ASSET_STATUSES).default("ACTIVE"),
  companyRelationship: z.enum(COMPANY_RELATIONSHIPS, { errorMap: () => ({ message: "Choose how your company holds this asset" }) }),
  acquisitionCost: optionalKobo,
  acquiredOn: optionalDate,
});

export async function createAsset(ctx: Ctx, input: z.input<typeof createSchema>) {
  assertCan(ctx, "asset.create");
  const data = createSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const count = await tx.asset.count({ where: { companyId: ctx.companyId } });
    const ref = `AST-${String(count + 1).padStart(5, "0")}`;
    const asset = await tx.asset.create({
      data: {
        companyId: ctx.companyId, ref, name: data.name, assetClass: data.assetClass, category: data.category,
        description: data.description, address: data.address, city: data.city, state: data.state,
        status: data.status, companyRelationship: data.companyRelationship,
        acquisitionCostKobo: data.acquisitionCost, acquiredOn: data.acquiredOn, createdById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: asset.id,
      action: "asset.registered", detail: { ref, name: data.name, companyRelationship: data.companyRelationship },
    });
    return asset;
  });
}

export async function listAssets(ctx: Ctx, filter: { q?: string; status?: string } = {}) {
  assertCan(ctx, "asset.view");
  const status = (ASSET_STATUSES as readonly string[]).includes(filter.status ?? "") ? filter.status : undefined;
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.asset.findMany({
      where: {
        companyId: ctx.companyId,
        ...(status ? { status: status as (typeof ASSET_STATUSES)[number] } : {}),
        ...(filter.q ? { OR: [
          { name: { contains: filter.q, mode: "insensitive" } },
          { ref: { contains: filter.q, mode: "insensitive" } },
          { city: { contains: filter.q, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { listing: { select: { status: true, publicRef: true } } },
    }),
  );
}

/** Full asset record with its related records and history. Returns null if not in this company. */
export async function getAsset(ctx: Ctx, assetId: string) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({
      where: { id: assetId, companyId: ctx.companyId },
      include: {
        parties: { orderBy: { createdAt: "asc" } },
        documents: { orderBy: { createdAt: "desc" } },
        leases: { orderBy: { startDate: "desc" }, include: { charges: { orderBy: { dueDate: "asc" } } } },
        tasks: { where: { dealId: null }, orderBy: { createdAt: "desc" }, include: { assignee: { include: { user: { select: { name: true } } } } } },
        listing: { include: { enquiries: { orderBy: { createdAt: "desc" } } } },
      },
    });
    if (!asset) return null;
    const history = await tx.activityLog.findMany({
      where: { companyId: ctx.companyId, OR: [
        { entityType: "asset", entityId: asset.id },
        { entityId: { in: [
          ...asset.leases.map((l) => l.id), ...asset.tasks.map((t) => t.id),
          ...asset.documents.map((d) => d.id), ...asset.parties.map((p) => p.id),
          ...(asset.listing ? [asset.listing.id] : []),
          ...asset.leases.flatMap((l) => l.charges.map((c) => c.id)),
        ] } },
      ] },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const actorIds = Array.from(new Set(history.map((h) => h.actorId).filter((v): v is string => !!v)));
    const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    return { asset, history, actorNames: Object.fromEntries(actors.map((a) => [a.id, a.name])) };
  });
}

export async function updateAssetStatus(ctx: Ctx, assetId: string, status: string, reason: string) {
  assertCan(ctx, "asset.update");
  const parsed = z.enum(ASSET_STATUSES).parse(status);
  if (reason.trim().length < 3) throw new Error("Give a reason for the status change");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    if (asset.status === parsed) return;
    await tx.asset.update({ where: { id: asset.id }, data: { status: parsed } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: asset.id,
      action: "asset.status_changed", detail: { from: asset.status, to: parsed, reason: reason.trim() },
    });
    // A disposed or archived asset must not stay advertised as available (master prompt Section 19).
    if (parsed === "DISPOSED" || parsed === "ARCHIVED") {
      const listing = await tx.listing.findFirst({
        where: { assetId: asset.id, companyId: ctx.companyId, status: { in: ["PUBLISHED", "PENDING_REVIEW"] } },
      });
      if (listing) {
        await tx.listing.update({ where: { id: listing.id }, data: { status: "UNAVAILABLE" } });
        await logActivity(tx, {
          companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: listing.id,
          action: "listing.status_changed", detail: { from: listing.status, to: "UNAVAILABLE", reason: `Asset ${parsed.toLowerCase()}` },
        });
      }
    }
  });
}

const partySchema = z.object({
  partyName: z.string().trim().min(2, "Enter the person or organization name").max(200),
  relationship: z.enum(PARTY_RELATIONSHIPS),
  effectiveFrom: optionalDate,
  evidenceNote: z.string().trim().max(1000).default(""),
});

export async function addParty(ctx: Ctx, assetId: string, input: z.input<typeof partySchema>) {
  assertCan(ctx, "party.manage");
  const data = partySchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    const party = await tx.assetParty.create({
      data: { companyId: ctx.companyId, assetId: asset.id, partyName: data.partyName, relationship: data.relationship,
              effectiveFrom: data.effectiveFrom, evidenceNote: data.evidenceNote },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset_party", entityId: party.id,
      action: "party.recorded", detail: { partyName: data.partyName, relationship: data.relationship },
    });
  });
}

const docSchema = z.object({
  title: z.string().trim().min(2, "Enter a document title").max(200),
  category: z.enum(DOCUMENT_CATEGORIES),
  expiresOn: optionalDate,
});

export async function uploadDocument(
  ctx: Ctx,
  assetId: string,
  input: z.input<typeof docSchema>,
  file: { name: string; type: string; bytes: Uint8Array },
) {
  assertCan(ctx, "document.upload");
  const data = docSchema.parse(input);
  validateUpload(file.type, file.bytes);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // Confirm the asset belongs to this company before writing anything.
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId }, select: { id: true } });
    if (!asset) throw new Error("Asset not found");
    const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
    const previous = await tx.assetDocument.count({ where: { companyId: ctx.companyId, assetId, title: data.title } });
    const doc = await tx.assetDocument.create({
      data: {
        companyId: ctx.companyId, assetId, category: data.category, title: data.title,
        fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey,
        version: previous + 1, expiresOn: data.expiresOn, uploadedById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "document", entityId: doc.id,
      action: "document.uploaded", detail: { title: data.title, category: data.category, version: doc.version },
    });
  });
}

/** Fetch a document for download. Records the access in the audit trail. */
export async function getDocumentForDownload(ctx: Ctx, documentId: string) {
  assertCan(ctx, "document.download");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const doc = await tx.assetDocument.findFirst({ where: { id: documentId, companyId: ctx.companyId } });
    if (!doc) return null;
    const bytes = await readStoredFile(tx, ctx.companyId, doc.storageKey);
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "document", entityId: doc.id,
      action: "document.downloaded", detail: { title: doc.title },
    });
    return { doc, bytes };
  });
}
