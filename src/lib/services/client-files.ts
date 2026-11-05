import { z } from "zod";
import { withInviteToken, withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { formatKobo } from "../money";
import { hashToken, newToken } from "../tokens";
import { can } from "../permissions";
import { readStoredFile } from "../storage";
import { assertCan, type Ctx } from "./context";

/**
 * Client files: each client's properties, grouped by kind of property and place, and under each property its documents,
 * correspondence, field work (inspections), inventory, improvements with their costs, and valuations. A company can send a
 * client a private, expiring, read-only link to follow one property, showing only the sections it chose.
 */

export const SECTIONS = {
  documents: "Documents",
  correspondence: "Correspondence",
  inspections: "Field work and inspections",
  inventory: "Inventory",
  projects: "Improvements and project costs",
  valuations: "Valuations",
} as const;
export type Section = keyof typeof SECTIONS;
export const ROLES = { OWNER: "Owner", BUYER: "Buyer", TENANT: "Tenant", LANDLORD: "Landlord" } as const;
/** What a client link may show: correspondence stays internal. */
export const SHAREABLE: Section[] = ["inventory", "projects", "valuations", "inspections", "documents"];

/** Clients with how many properties are in their file (deals count too). */
export async function clientDirectory(ctx: Ctx, qRaw = "") {
  assertCan(ctx, "crm.view");
  const q = qRaw.trim().slice(0, 80);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const clients = await tx.client.findMany({
      where: { companyId: ctx.companyId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { ref: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, ref: true, email: true, phone: true, kind: true },
    });
    const ids = clients.map((c) => c.id);
    const [linked, dealt] = await Promise.all([
      tx.clientAsset.findMany({ where: { companyId: ctx.companyId, clientId: { in: ids } }, select: { clientId: true, assetId: true } }),
      tx.deal.findMany({ where: { companyId: ctx.companyId, clientId: { in: ids } }, select: { clientId: true, assetId: true } }),
    ]);
    const count = new Map<string, Set<string>>();
    for (const r of [...linked, ...dealt]) { if (!count.has(r.clientId)) count.set(r.clientId, new Set()); count.get(r.clientId)!.add(r.assetId); }
    return clients.map((c) => ({ ...c, properties: count.get(c.id)?.size ?? 0 }));
  });
}

async function propertiesOf(tx: Tx, companyId: string, clientId: string) {
  const [linked, dealt] = await Promise.all([
    tx.clientAsset.findMany({ where: { companyId, clientId }, select: { assetId: true, role: true } }),
    tx.deal.findMany({ where: { companyId, clientId }, select: { assetId: true, type: true, status: true } }),
  ]);
  const roles = new Map<string, string>();
  for (const d of dealt) roles.set(d.assetId, d.type === "SALE" ? "BUYER" : "TENANT");
  for (const l of linked) roles.set(l.assetId, l.role);
  return roles;
}

/** One client's file: their properties grouped by kind and place, with the count in every folder. */
export async function clientFile(ctx: Ctx, clientId: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: clientId, companyId: ctx.companyId }, select: { id: true, name: true, ref: true, email: true, phone: true, kind: true, address: true } });
    if (!client) throw new Error("Client not found");
    const roles = await propertiesOf(tx, ctx.companyId, clientId);
    const ids = [...roles.keys()];
    const assets = await tx.asset.findMany({ where: { id: { in: ids }, companyId: ctx.companyId }, select: { id: true, ref: true, name: true, assetClass: true, category: true, city: true, state: true, status: true } });
    const by = (rows: { assetId: string | null }[]) => { const m = new Map<string, number>(); for (const r of rows) if (r.assetId) m.set(r.assetId, (m.get(r.assetId) ?? 0) + 1); return m; };
    const [docs, corr, insp, inv, projects, valuations, links] = await Promise.all([
      tx.assetDocument.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.correspondence.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.inspection.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.inventoryItem.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.project.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.valuationInstruction.findMany({ where: { companyId: ctx.companyId, assetId: { in: ids } }, select: { assetId: true } }),
      tx.clientViewLink.findMany({ where: { companyId: ctx.companyId, clientId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, assetId: true, sections: true, expiresAt: true, views: true, lastViewedAt: true, createdAt: true } }),
    ]);
    const counts = { documents: by(docs), correspondence: by(corr), inspections: by(insp), inventory: by(inv), projects: by(projects), valuations: by(valuations) };
    const properties = assets.map((a) => ({
      ...a, role: roles.get(a.id) ?? "OWNER",
      counts: Object.fromEntries((Object.keys(SECTIONS) as Section[]).map((s) => [s, counts[s].get(a.id) ?? 0])) as Record<Section, number>,
      links: links.filter((l) => l.assetId === a.id),
    }));
    // Folders: kind of property, then place.
    const groups = new Map<string, typeof properties>();
    for (const p of properties) { const k = `${p.category || p.assetClass} · ${p.city || p.state || "No location"}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); }
    return { client, groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({ label, items })) };
  });
}

/** What is in one folder of a property in a client's file. */
export async function folderItems(ctx: Ctx, clientId: string, assetId: string, section: Section) {
  assertCan(ctx, "crm.view");
  if (section === "documents") assertCan(ctx, "document.download");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const roles = await propertiesOf(tx, ctx.companyId, clientId);
    if (!roles.has(assetId)) throw new Error("That property is not in this client's file");
    return sectionItems(tx, ctx.companyId, assetId, section, true);
  });
}

type Item = { id: string; title: string; detail: string; when: Date | null; href: string | null; amount?: string };

/** The items of one section. `internal` adds links into the workspace; for a client link they are plain. */
async function sectionItems(tx: Tx, companyId: string, assetId: string, section: Section, internal: boolean): Promise<Item[]> {
  if (section === "documents") {
    const rows = await tx.assetDocument.findMany({ where: { companyId, assetId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, category: true, fileName: true, createdAt: true, expiresOn: true } });
    return rows.map((d) => ({ id: d.id, title: d.title, detail: `${String(d.category).replace(/_/g, " ").toLowerCase()} · ${d.fileName}${d.expiresOn ? ` · expires ${d.expiresOn.toISOString().slice(0, 10)}` : ""}`, when: d.createdAt, href: internal ? `/app/assets/${assetId}#documents` : null }));
  }
  if (section === "correspondence") {
    const rows = await tx.correspondence.findMany({ where: { companyId, assetId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, ref: true, subject: true, status: true, category: true, createdAt: true } });
    return rows.map((c) => ({ id: c.id, title: c.subject, detail: `${c.ref} · ${c.category} · ${String(c.status).toLowerCase()}`, when: c.createdAt, href: internal ? `/app/correspondence?show=${c.id}` : null }));
  }
  if (section === "inspections") {
    const rows = await tx.inspection.findMany({ where: { companyId, assetId }, orderBy: { scheduledFor: "desc" }, take: 100, select: { id: true, ref: true, status: true, scheduledFor: true, conductedOn: true } });
    return rows.map((i) => ({ id: i.id, title: `Inspection ${i.ref}`, detail: `${String(i.status).replace(/_/g, " ").toLowerCase()}${i.conductedOn ? ` · done ${i.conductedOn.toISOString().slice(0, 10)}` : ` · planned ${i.scheduledFor.toISOString().slice(0, 10)}`}`, when: i.conductedOn ?? i.scheduledFor, href: internal ? `/app/inspections/${i.id}` : null }));
  }
  if (section === "inventory") {
    const rows = await tx.inventoryItem.findMany({ where: { companyId, assetId }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, category: true, kind: true, status: true, createdAt: true } });
    return rows.map((r) => ({ id: r.id, title: r.name, detail: [r.category, String(r.kind).toLowerCase(), String(r.status).toLowerCase()].filter(Boolean).join(" · "), when: r.createdAt, href: internal ? `/app/inventory` : null }));
  }
  if (section === "projects") {
    const rows = await tx.project.findMany({ where: { companyId, assetId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ref: true, title: true, kind: true, status: true, approvedBudgetKobo: true, createdAt: true, completedAt: true } });
    const invoices = await tx.projectInvoice.groupBy({ by: ["projectId"], where: { companyId, projectId: { in: rows.map((r) => r.id) } }, _sum: { amountKobo: true } });
    const spent = new Map(invoices.map((i) => [i.projectId, i._sum.amountKobo ?? 0n]));
    return rows.map((p) => ({ id: p.id, title: p.title, detail: `${p.ref} · ${String(p.kind).replace(/_/g, " ").toLowerCase()} · ${String(p.status).replace(/_/g, " ").toLowerCase()}${p.approvedBudgetKobo ? ` · budget ${formatKobo(p.approvedBudgetKobo)}` : ""}`, amount: `Invoiced ${formatKobo(spent.get(p.id) ?? 0n)}`, when: p.completedAt ?? p.createdAt, href: internal ? `/app/projects/${p.id}` : null }));
  }
  // Valuations: only approved reports carry a value.
  const ins = await tx.valuationInstruction.findMany({ where: { companyId, assetId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, purpose: true, basis: true, createdAt: true } });
  const reports = await tx.valuationReport.findMany({ where: { companyId, instructionId: { in: ins.map((i) => i.id) }, status: "APPROVED" }, select: { instructionId: true, concludedValueKobo: true, decidedAt: true } });
  return ins.map((i) => {
    const r = reports.find((x) => x.instructionId === i.id);
    return { id: i.id, title: `Valuation for ${String(i.purpose).replace(/_/g, " ").toLowerCase()}`, detail: `${String(i.basis).replace(/_/g, " ").toLowerCase()}${r ? "" : " · not approved yet"}`, amount: r?.concludedValueKobo != null ? formatKobo(r.concludedValueKobo) : undefined, when: r?.decidedAt ?? i.createdAt, href: internal ? `/app/valuations/${i.id}` : null };
  });
}

const linkSchema = z.object({ clientId: z.string().min(1), assetId: z.string().min(1, { error: "Choose a property" }), role: z.enum(["OWNER", "BUYER", "TENANT", "LANDLORD"]).default("OWNER") });
export async function addToClientFile(ctx: Ctx, input: z.input<typeof linkSchema>) {
  assertCan(ctx, "crm.manage");
  const d = linkSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (!(await tx.client.findFirst({ where: { id: d.clientId, companyId: ctx.companyId }, select: { id: true } }))) throw new Error("Client not found");
    if (!(await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true } }))) throw new Error("Property not found");
    await tx.clientAsset.upsert({ where: { clientId_assetId: { clientId: d.clientId, assetId: d.assetId } }, create: { companyId: ctx.companyId, clientId: d.clientId, assetId: d.assetId, role: d.role, createdById: ctx.userId }, update: { role: d.role } });
  });
}

export async function removeFromClientFile(ctx: Ctx, clientId: string, assetId: string) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.clientAsset.deleteMany({ where: { companyId: ctx.companyId, clientId, assetId } }));
}

const shareSchema = z.object({ clientId: z.string().min(1), assetId: z.string().min(1), sections: z.array(z.string()), days: z.coerce.number().int().min(1).max(365) });
/** A read-only link for the client to follow one property. Returns the link's secret once; only its hash is kept. */
export async function createClientLink(ctx: Ctx, input: z.input<typeof shareSchema>) {
  assertCan(ctx, "crm.manage");
  const d = shareSchema.parse(input);
  const sections = [...new Set(d.sections)].filter((s): s is Section => (SHAREABLE as string[]).includes(s));
  if (!sections.length) throw new Error("Choose at least one thing the client can see");
  if (sections.includes("documents") && !can(ctx.role, "document.download")) throw new Error("You cannot share documents");
  const token = newToken();
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const roles = await propertiesOf(tx, ctx.companyId, d.clientId);
    if (!roles.has(d.assetId)) throw new Error("Add the property to the client's file first");
    const l = await tx.clientViewLink.create({ data: { companyId: ctx.companyId, clientId: d.clientId, assetId: d.assetId, tokenHash: hashToken(token), sections, expiresAt: new Date(Date.now() + d.days * 864e5), createdById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client_link", entityId: l.id, action: "client_link.created", detail: { clientId: d.clientId, assetId: d.assetId, sections, days: d.days } });
  });
  return token;
}

export async function revokeClientLink(ctx: Ctx, linkId: string) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.clientViewLink.updateMany({ where: { id: linkId, companyId: ctx.companyId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new Error("That link is already closed");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client_link", entityId: linkId, action: "client_link.revoked", detail: {} });
  });
}

async function openLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const h = hashToken(token);
  const link = await withInviteToken(h, (tx) => tx.clientViewLink.findUnique({ where: { tokenHash: h } }));
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  return link;
}

/** What a client sees from their link: the property and the chosen sections. Counts the visit. Null when closed. */
export async function viewClientLink(token: string) {
  const link = await openLink(token);
  if (!link) return null;
  await withInviteToken(link.tokenHash, (tx) => tx.clientViewLink.update({ where: { tokenHash: link.tokenHash }, data: { views: { increment: 1 }, lastViewedAt: new Date() } }));
  return withTenant(link.companyId, "system", async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: link.assetId, companyId: link.companyId }, select: { name: true, category: true, assetClass: true, city: true, state: true } });
    const client = await tx.client.findFirst({ where: { id: link.clientId, companyId: link.companyId }, select: { name: true } });
    const company = await tx.company.findUnique({ where: { id: link.companyId }, select: { name: true } });
    if (!asset || !client) return null;
    const sections = await Promise.all((link.sections as Section[]).map(async (s) => ({ key: s, title: SECTIONS[s], items: await sectionItems(tx, link.companyId, link.assetId, s, false) })));
    return { asset, clientName: client.name, companyName: company?.name ?? "Your property company", sections, expiresAt: link.expiresAt };
  });
}

/** A document through a client link (only when the link shares documents, and only this property's). */
export async function clientLinkDocument(token: string, documentId: string) {
  const link = await openLink(token);
  if (!link || !link.sections.includes("documents")) return null;
  return withTenant(link.companyId, "system", async (tx) => {
    const d = await tx.assetDocument.findFirst({ where: { id: documentId, companyId: link.companyId, assetId: link.assetId }, select: { storageKey: true, mimeType: true, fileName: true } });
    if (!d) return null;
    return { bytes: await readStoredFile(tx, link.companyId, d.storageKey), type: d.mimeType, name: d.fileName };
  });
}
