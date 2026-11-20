/**
 * One place to find any document the company holds: property documents, letters and emails received or sent (attachments in
 * the correspondence register), deal documents, project documents and valuation documents. Each person sees only what they are
 * allowed to open elsewhere (confidential letters, deals they may see, and so on). Searched by title, file name and what it is
 * attached to; sorted by date, name, size, expiry or where it belongs.
 */
import type { Prisma } from "@prisma/client";
import { withTenant } from "../db";
import { can } from "../permissions";
import { sortBy, type Sort, type SortOption } from "../list-sort";
import { visibleWhere } from "./correspondence";
import { dealVisibleWhere } from "./deal";
import { visibleOwners } from "./crm";
import type { Ctx } from "./context";

export type Source = "property" | "correspondence" | "deal" | "project" | "valuation";
export const SOURCES: Record<Source, string> = { property: "Property documents", correspondence: "Letters and emails", deal: "Deals", project: "Projects", valuation: "Valuations" };
export const FILE_TYPES = { pdf: "PDF", image: "Pictures", word: "Word documents", sheet: "Spreadsheets", other: "Other" } as const;
export type FileType = keyof typeof FILE_TYPES;

export const DOC_SORTS: SortOption[] = [
  { key: "date", label: "Date added", dir: "desc" },
  { key: "name", label: "Name", dir: "asc" },
  { key: "source", label: "Where it belongs", dir: "asc" },
  { key: "size", label: "Size", dir: "desc" },
  { key: "expires", label: "Expiry date", dir: "asc" },
  { key: "type", label: "File type", dir: "asc" },
];

export type LibraryDoc = {
  id: string; source: Source; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date; expiresOn: Date | null;
  kind: string; href: string; on: { label: string; href: string };
};

export function fileType(mime: string, name = ""): FileType {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (/word|officedocument\.wordprocessing|msword|opendocument\.text|rtf/.test(mime) || /\.(docx?|odt|rtf)$/i.test(name)) return "word";
  if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|ods|csv)$/i.test(name)) return "sheet";
  return "other";
}

const PER_SOURCE = 500;

/** The documents this person may see, searched, filtered and sorted. `capped` says a source had more than could be shown. */
export async function documentLibrary(ctx: Ctx, f: { q?: string; source?: string; type?: string; sort: Sort }) {
  const q = (f.q ?? "").trim().slice(0, 120);
  const want = (s: Source) => !f.source || f.source === s;
  const may = {
    property: can(ctx.role, "asset.view") && can(ctx.role, "document.download"),
    correspondence: can(ctx.role, "correspondence.view"),
    deal: can(ctx.role, "crm.view"),
    project: can(ctx.role, "project.view"),
    valuation: can(ctx.role, "valuation.view"),
  } satisfies Record<Source, boolean>;
  const available = (Object.keys(may) as Source[]).filter((s) => may[s]);
  const order = { createdAt: "desc" as const };

  const out = await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const docs: LibraryDoc[] = [];
    let capped = false;
    const cap = <T,>(rows: T[]) => { if (rows.length >= PER_SOURCE) capped = true; return rows; };

    if (may.property && want("property")) {
      const where: Prisma.AssetDocumentWhereInput = { companyId: ctx.companyId, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }, { asset: { name: { contains: q, mode: "insensitive" } } }, { asset: { ref: { contains: q, mode: "insensitive" } } }] } : {}) };
      for (const d of cap(await tx.assetDocument.findMany({ where, orderBy: order, take: PER_SOURCE, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, expiresOn: true, category: true, asset: { select: { id: true, ref: true, name: true } } } }))) {
        docs.push({ id: d.id, source: "property", title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, expiresOn: d.expiresOn, kind: d.category, href: `/app/documents/${d.id}`, on: { label: `${d.asset.ref} · ${d.asset.name}`, href: `/app/assets/${d.asset.id}` } });
      }
    }
    if (may.correspondence && want("correspondence")) {
      const where: Prisma.CorrespondenceAttachmentWhereInput = { companyId: ctx.companyId, correspondence: visibleWhere(ctx), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }, { correspondence: { subject: { contains: q, mode: "insensitive" } } }, { correspondence: { ref: { contains: q, mode: "insensitive" } } }, { correspondence: { senderName: { contains: q, mode: "insensitive" } } }] } : {}) };
      for (const d of cap(await tx.correspondenceAttachment.findMany({ where, orderBy: order, take: PER_SOURCE, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, correspondence: { select: { id: true, ref: true, subject: true, direction: true } } } }))) {
        docs.push({ id: d.id, source: "correspondence", title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, expiresOn: null, kind: d.correspondence.direction === "INCOMING" ? "Incoming" : "Outgoing", href: `/app/correspondence/attachments/${d.id}`, on: { label: `${d.correspondence.ref} · ${d.correspondence.subject}`, href: `/app/correspondence/${d.correspondence.id}` } });
      }
    }
    if (may.deal && want("deal")) {
      const owners = await visibleOwners(tx, ctx);
      const where: Prisma.DealDocumentWhereInput = { companyId: ctx.companyId, deal: dealVisibleWhere(ctx, owners), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }, { deal: { ref: { contains: q, mode: "insensitive" } } }, { deal: { client: { name: { contains: q, mode: "insensitive" } } } }] } : {}) };
      for (const d of cap(await tx.dealDocument.findMany({ where, orderBy: order, take: PER_SOURCE, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, kind: true, deal: { select: { id: true, ref: true, client: { select: { name: true } } } } } }))) {
        docs.push({ id: d.id, source: "deal", title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, expiresOn: null, kind: d.kind, href: `/app/deal-docs/${d.id}`, on: { label: `${d.deal.ref} · ${d.deal.client?.name ?? "Deal"}`, href: `/app/deals/${d.deal.id}` } });
      }
    }
    if (may.project && want("project")) {
      const where: Prisma.ProjectDocumentWhereInput = { companyId: ctx.companyId, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }, { project: { title: { contains: q, mode: "insensitive" } } }, { project: { ref: { contains: q, mode: "insensitive" } } }] } : {}) };
      for (const d of cap(await tx.projectDocument.findMany({ where, orderBy: order, take: PER_SOURCE, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, kind: true, project: { select: { id: true, ref: true, title: true } } } }))) {
        docs.push({ id: d.id, source: "project", title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, expiresOn: null, kind: d.kind, href: `/app/project-docs/${d.id}`, on: { label: `${d.project.ref} · ${d.project.title}`, href: `/app/projects/${d.project.id}` } });
      }
    }
    if (may.valuation && want("valuation")) {
      const where: Prisma.ValuationDocumentWhereInput = { companyId: ctx.companyId, ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { fileName: { contains: q, mode: "insensitive" } }, { instruction: { ref: { contains: q, mode: "insensitive" } } }] } : {}) };
      for (const d of cap(await tx.valuationDocument.findMany({ where, orderBy: order, take: PER_SOURCE, select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, instruction: { select: { id: true, ref: true } } } }))) {
        docs.push({ id: d.id, source: "valuation", title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt, expiresOn: null, kind: "Valuation", href: `/app/valuation-docs/${d.id}`, on: { label: d.instruction.ref, href: `/app/valuations/${d.instruction.id}` } });
      }
    }
    return { docs, capped };
  });

  const typed = f.type && f.type in FILE_TYPES ? out.docs.filter((d) => fileType(d.mimeType, d.fileName) === f.type) : out.docs;
  const value: Record<string, (d: LibraryDoc) => unknown> = {
    date: (d) => d.createdAt, name: (d) => d.title || d.fileName, source: (d) => `${SOURCES[d.source]} ${d.on.label}`, size: (d) => d.sizeBytes,
    expires: (d) => d.expiresOn, type: (d) => FILE_TYPES[fileType(d.mimeType, d.fileName)],
  };
  return { docs: sortBy(typed, value[f.sort.key] ?? value.date, f.sort.dir), capped: out.capped, available };
}
