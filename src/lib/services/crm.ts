import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { parseNairaToKobo } from "../money";
import { nextNumber } from "../numbering";
import {
  ACTIVITY_KINDS, CLIENT_KINDS, duplicateReasons, FINANCING, leadTransitionProblem, matchScore, MATCH_STATUSES, normaliseEmail, normaliseName, normalisePhone,
  qualificationProblem, qualificationScore, TIMELINES, type LeadStatus,
} from "../crm-rules";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";

// Clients, leads, follow-ups and property requirements (master prompt Phase 8). Every record has an owner. Managers see
// everything; an agent sees what they own, and a team lead also sees what their team owns. A confidential client is seen
// only by its owner and by managers. Duplicate checks look at every client, but show a person only what they may see.

export { ACTIVITY_KINDS, CLIENT_KINDS, FINANCING, MATCH_STATUSES, TIMELINES };

const text = (max: number) => z.string().trim().max(max).default("");
const optionalId = z.string().optional().transform((v) => v || null);
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const optionalMoney = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null));
const yes = (v: string | boolean | undefined) => v === true || v === "on" || v === "yes" || v === "true";

const isManager = (ctx: Ctx) => can(ctx.role, "crm.assign");

/** Owners whose records this person may see: null means everyone's. */
export async function visibleOwners(tx: Tx, ctx: Ctx): Promise<string[] | null> {
  if (isManager(ctx)) return null;
  const teams = await tx.team.findMany({ where: { companyId: ctx.companyId, leadId: ctx.membershipId }, select: { id: true } });
  if (teams.length === 0) return [ctx.membershipId];
  const members = await tx.membership.findMany({ where: { companyId: ctx.companyId, teamId: { in: teams.map((t) => t.id) } }, select: { id: true } });
  return [...new Set([ctx.membershipId, ...members.map((m) => m.id)])];
}

export function clientVisibleWhere(ctx: Ctx, owners: string[] | null): Prisma.ClientWhereInput {
  if (owners === null) return {};
  // A lead given to you also gives you its client, even a confidential one: a manager chose to hand it over.
  return { OR: [{ ownerId: ctx.membershipId }, { ownerId: { in: owners }, confidential: false }, { leads: { some: { ownerId: ctx.membershipId } } }] };
}

function canSeeClient(ctx: Ctx, owners: string[] | null, c: { ownerId: string; confidential: boolean }, hasMyLead = false) {
  if (owners === null) return true;
  return hasMyLead || c.ownerId === ctx.membershipId || (!c.confidential && owners.includes(c.ownerId));
}

async function myLeadOn(tx: Tx, ctx: Ctx, clientId: string) {
  return (await tx.lead.count({ where: { companyId: ctx.companyId, clientId, ownerId: ctx.membershipId } })) > 0;
}

async function loadClient(tx: Tx, ctx: Ctx, id: string) {
  const c = await tx.client.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!c) throw new Error("Client not found");
  const owners = await visibleOwners(tx, ctx);
  if (!canSeeClient(ctx, owners, c, owners !== null && (await myLeadOn(tx, ctx, id)))) throw new Error("Client not found");
  return c;
}

function canChange(ctx: Ctx, c: { ownerId: string }) {
  return isManager(ctx) || c.ownerId === ctx.membershipId;
}

async function activeAgent(tx: Tx, companyId: string, membershipId: string) {
  const m = await tx.membership.findFirst({ where: { id: membershipId, companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] } }, select: { id: true } });
  if (!m) throw new Error("Choose an active agent or manager of your company");
}

async function noteOn(tx: Tx, ctx: Ctx, clientId: string, subject: string, leadId: string | null = null, body = "") {
  await tx.clientActivity.create({ data: { companyId: ctx.companyId, clientId, leadId, kind: "NOTE", subject, body, system: true, createdById: ctx.userId } });
}

const ref = (prefix: string, year: number, n: number) => `${prefix}-${year}-${String(n).padStart(4, "0")}`;

// ---------- Lead sources, branches and teams ----------

const DEFAULT_SOURCES = ["Website enquiry", "Referral", "Walk-in", "Phone call", "Social media", "Existing client", "Other"];

async function ensureSources(tx: Tx, companyId: string) {
  if ((await tx.leadSource.count({ where: { companyId } })) > 0) return;
  await tx.leadSource.createMany({ data: DEFAULT_SOURCES.map((name) => ({ companyId, name })), skipDuplicates: true });
}

export async function addLeadSource(ctx: Ctx, nameInput: string) {
  assertCan(ctx, "crm.configure");
  const name = z.string().trim().min(2, "Name the source").max(80).parse(nameInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await ensureSources(tx, ctx.companyId);
    const dup = await tx.leadSource.findFirst({ where: { companyId: ctx.companyId, name: { equals: name, mode: "insensitive" } } });
    if (dup) throw new Error("That source already exists");
    return tx.leadSource.create({ data: { companyId: ctx.companyId, name } });
  });
}

export async function setLeadSourceActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "crm.configure");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.leadSource.updateMany({ where: { id, companyId: ctx.companyId }, data: { active } });
    if (r.count === 0) throw new Error("Source not found");
  });
}

export async function addBranch(ctx: Ctx, raw: { name: string; code: string }) {
  assertCan(ctx, "crm.configure");
  const name = z.string().trim().min(2, "Name the branch").max(100).parse(raw.name);
  const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "Use 2 to 8 letters or digits for the branch code").parse(raw.code);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (await tx.branch.findFirst({ where: { companyId: ctx.companyId, code } })) throw new Error("That branch code is already used");
    return tx.branch.create({ data: { companyId: ctx.companyId, name, code } });
  });
}

export async function addTeam(ctx: Ctx, raw: { name: string; branchId?: string; leadId?: string }) {
  assertCan(ctx, "crm.configure");
  const name = z.string().trim().min(2, "Name the team").max(100).parse(raw.name);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (raw.branchId && !(await tx.branch.findFirst({ where: { id: raw.branchId, companyId: ctx.companyId } }))) throw new Error("Branch not found");
    if (raw.leadId) await activeAgent(tx, ctx.companyId, raw.leadId);
    if (await tx.team.findFirst({ where: { companyId: ctx.companyId, name: { equals: name, mode: "insensitive" } } })) throw new Error("That team name is already used");
    return tx.team.create({ data: { companyId: ctx.companyId, name, branchId: raw.branchId || null, leadId: raw.leadId || null } });
  });
}

export async function setTeamLead(ctx: Ctx, teamId: string, leadId: string | null) {
  assertCan(ctx, "crm.configure");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const team = await tx.team.findFirst({ where: { id: teamId, companyId: ctx.companyId } });
    if (!team) throw new Error("Team not found");
    if (leadId) await activeAgent(tx, ctx.companyId, leadId);
    await tx.team.update({ where: { id: teamId }, data: { leadId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "team", entityId: teamId, action: "crm.team_lead_set", detail: { leadId } });
  });
}

export async function setMemberPlacement(ctx: Ctx, membershipId: string, branchId: string | null, teamId: string | null) {
  assertCan(ctx, "crm.configure");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, companyId: ctx.companyId } });
    if (!m) throw new Error("Member not found");
    if (branchId && !(await tx.branch.findFirst({ where: { id: branchId, companyId: ctx.companyId } }))) throw new Error("Branch not found");
    if (teamId) {
      const t = await tx.team.findFirst({ where: { id: teamId, companyId: ctx.companyId } });
      if (!t) throw new Error("Team not found");
      if (branchId && t.branchId && t.branchId !== branchId) throw new Error("That team belongs to a different branch");
    }
    await tx.membership.update({ where: { id: membershipId }, data: { branchId, teamId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "membership", entityId: membershipId, action: "crm.member_placed", detail: { branchId, teamId } });
  });
}

export async function getCrmSetup(ctx: Ctx) {
  assertCan(ctx, "crm.configure");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await ensureSources(tx, ctx.companyId);
    const [sources, branches, teams, members] = await Promise.all([
      tx.leadSource.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.branch.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.team.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId, status: "ACTIVE" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    ]);
    return { sources, branches, teams, members: members.map((m) => ({ id: m.id, name: m.user.name, role: m.role, branchId: m.branchId, teamId: m.teamId })) };
  });
}

// ---------- Clients ----------

const clientSchema = z.object({
  kind: z.enum(CLIENT_KINDS).default("INDIVIDUAL"),
  name: z.string().trim().min(2, "Enter the client's name").max(200),
  email: z.string().trim().max(200).default("").refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
  phone: z.string().trim().max(50).default("").refine((v) => v === "" || normalisePhone(v).length >= 7, "Enter a valid phone number"),
  address: text(500),
  city: text(100),
  notes: text(4000),
  confidential: z.union([z.boolean(), z.string()]).optional().transform(yes),
  marketingConsent: z.union([z.boolean(), z.string()]).optional().transform(yes),
  ownerId: optionalId,
  notDuplicate: z.union([z.boolean(), z.string()]).optional().transform(yes),
});

/** Clients that may be the same as these details. The caller decides how much of each to show. */
async function findDuplicates(tx: Tx, companyId: string, keys: { id?: string; name: string; emailNorm: string; phoneNorm: string; city: string }) {
  const or: object[] = [];
  if (keys.emailNorm) or.push({ emailNorm: keys.emailNorm });
  if (keys.phoneNorm) or.push({ phoneNorm: keys.phoneNorm });
  or.push({ name: { equals: keys.name.trim(), mode: "insensitive" as const } });
  const first = normaliseName(keys.name).split(" ")[0];
  if (first && first.length >= 3) or.push({ name: { contains: first, mode: "insensitive" as const } });
  const rows = await tx.client.findMany({ where: { companyId, archivedAt: null, ...(keys.id ? { id: { not: keys.id } } : {}), OR: or }, take: 50 });
  const dismissed = keys.id ? await tx.clientNotDuplicate.findMany({ where: { companyId, OR: [{ clientAId: keys.id }, { clientBId: keys.id }] } }) : [];
  const skip = new Set(dismissed.flatMap((d) => [d.clientAId, d.clientBId]));
  return rows.map((r) => ({ client: r, reasons: duplicateReasons(keys, r) })).filter((x) => x.reasons.length > 0 && !skip.has(x.client.id));
}

export async function createClient(ctx: Ctx, raw: z.input<typeof clientSchema>) {
  assertCan(ctx, "crm.manage");
  const d = clientSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const ownerId = d.ownerId && isManager(ctx) ? d.ownerId : ctx.membershipId;
    if (ownerId !== ctx.membershipId) await activeAgent(tx, ctx.companyId, ownerId);
    const keys = { name: d.name, emailNorm: normaliseEmail(d.email), phoneNorm: normalisePhone(d.phone), city: d.city };
    if (!keys.emailNorm && !keys.phoneNorm && d.kind === "INDIVIDUAL" && d.name.trim().split(/\s+/).length < 2) throw new Error("Enter the full name, or a phone number or email address, so the client can be told apart from others");
    if (!d.notDuplicate) {
      const dups = await findDuplicates(tx, ctx.companyId, keys);
      if (dups.length > 0) {
        const owners = await visibleOwners(tx, ctx);
        const lines = dups.slice(0, 3).map((x) => (canSeeClient(ctx, owners, x.client) ? `${x.client.ref} ${x.client.name} (${x.reasons.join(", ")})` : `${x.client.ref}, a client held by someone else (${x.reasons.join(", ")})`));
        throw new Error(`This may be a client already on record: ${lines.join("; ")}. Open the existing record, or tick "This is a different client" and save again.`);
      }
    }
    const year = todayInLagos().getUTCFullYear();
    const client = await tx.client.create({
      data: {
        companyId: ctx.companyId, ref: ref("CLT", year, await nextNumber(tx, ctx.companyId, "CLT", year)), kind: d.kind, name: d.name, email: d.email, emailNorm: keys.emailNorm,
        phone: d.phone, phoneNorm: keys.phoneNorm, address: d.address, city: d.city, notes: d.notes, ownerId, confidential: d.confidential, marketingConsent: d.marketingConsent, createdById: ctx.userId,
      },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: client.id, action: "crm.client_created", detail: { ref: client.ref } });
    return client;
  });
}

export async function updateClient(ctx: Ctx, id: string, raw: z.input<typeof clientSchema>) {
  assertCan(ctx, "crm.manage");
  const d = clientSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, id);
    if (!canChange(ctx, c)) throw new Error("Only the client's owner or a manager can change this record");
    if (c.archivedAt) throw new Error("This client is archived. Restore it before changing it");
    const keys = { id, name: d.name, emailNorm: normaliseEmail(d.email), phoneNorm: normalisePhone(d.phone), city: d.city };
    if (!d.notDuplicate && (keys.emailNorm !== c.emailNorm || keys.phoneNorm !== c.phoneNorm)) {
      const dups = (await findDuplicates(tx, ctx.companyId, keys)).filter((x) => x.reasons.some((r) => r !== "same name"));
      if (dups.length > 0) throw new Error(`Those contact details are already on ${dups[0].client.ref}. Open that record, or tick "This is a different client" and save again.`);
    }
    await tx.client.update({
      where: { id },
      data: { kind: d.kind, name: d.name, email: d.email, emailNorm: keys.emailNorm, phone: d.phone, phoneNorm: keys.phoneNorm, address: d.address, city: d.city, notes: d.notes, confidential: d.confidential, marketingConsent: d.marketingConsent },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: id, action: "crm.client_updated", detail: { ref: c.ref } });
  });
}

export async function archiveClient(ctx: Ctx, id: string, restore = false) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, id);
    if (!canChange(ctx, c)) throw new Error("Only the client's owner or a manager can do that");
    if (restore) {
      if (c.mergedIntoId) throw new Error("This client was merged into another record and cannot be restored");
      await tx.client.update({ where: { id }, data: { archivedAt: null } });
    } else {
      const open = await tx.lead.count({ where: { companyId: ctx.companyId, clientId: id, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } } });
      if (open > 0) throw new Error("Close or mark lost the client's open leads before archiving");
      await tx.client.update({ where: { id }, data: { archivedAt: new Date() } });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: id, action: restore ? "crm.client_restored" : "crm.client_archived", detail: { ref: c.ref } });
  });
}

/** Hand a client to another agent. The reason is kept on the client's history. */
export async function reassignClient(ctx: Ctx, id: string, newOwnerId: string, reasonInput: string) {
  assertCan(ctx, "crm.assign");
  const reason = z.string().trim().min(3, "Give the reason for the reassignment").max(500).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, id);
    if (c.ownerId === newOwnerId) throw new Error("That agent already owns this client");
    await activeAgent(tx, ctx.companyId, newOwnerId);
    await tx.client.update({ where: { id }, data: { ownerId: newOwnerId } });
    await tx.lead.updateMany({ where: { companyId: ctx.companyId, clientId: id, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }, data: { ownerId: newOwnerId, assignedById: ctx.userId, assignedAt: new Date() } });
    await noteOn(tx, ctx, id, "Client reassigned", null, reason);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: id, action: "crm.client_reassigned", detail: { from: c.ownerId, to: newOwnerId, reason } });
  });
}

export async function dismissDuplicate(ctx: Ctx, clientId: string, otherId: string) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const a = await loadClient(tx, ctx, clientId);
    const b = await tx.client.findFirst({ where: { id: otherId, companyId: ctx.companyId } });
    if (!b || !a) throw new Error("Client not found");
    const [x, y] = [clientId, otherId].sort();
    await tx.clientNotDuplicate.upsert({ where: { companyId_clientAId_clientBId: { companyId: ctx.companyId, clientAId: x, clientBId: y } }, update: {}, create: { companyId: ctx.companyId, clientAId: x, clientBId: y, decidedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: clientId, action: "crm.duplicate_dismissed", detail: { other: otherId } });
  });
}

/** Merge a duplicate into the record being kept. Leads, activities and requirements move across; the other record is archived and points to the kept one. */
export async function mergeClients(ctx: Ctx, keepId: string, mergeId: string) {
  assertCan(ctx, "crm.merge");
  if (keepId === mergeId) throw new Error("Choose two different clients");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const ids = [keepId, mergeId].sort();
    const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM clients WHERE company_id = $1 AND id = ANY($2::text[]) ORDER BY id FOR UPDATE`, ctx.companyId, ids);
    if (locked.length !== 2) throw new Error("Client not found");
    const keep = await tx.client.findFirstOrThrow({ where: { id: keepId, companyId: ctx.companyId } });
    const gone = await tx.client.findFirstOrThrow({ where: { id: mergeId, companyId: ctx.companyId } });
    if (keep.archivedAt || gone.archivedAt) throw new Error("Both clients must be active to merge them");
    await tx.lead.updateMany({ where: { companyId: ctx.companyId, clientId: mergeId }, data: { clientId: keepId } });
    await tx.clientActivity.updateMany({ where: { companyId: ctx.companyId, clientId: mergeId }, data: { clientId: keepId } });
    await tx.propertyRequirement.updateMany({ where: { companyId: ctx.companyId, clientId: mergeId }, data: { clientId: keepId } });
    await tx.client.update({
      where: { id: keepId },
      data: {
        email: keep.email || gone.email, emailNorm: keep.emailNorm || gone.emailNorm, phone: keep.phone || gone.phone, phoneNorm: keep.phoneNorm || gone.phoneNorm,
        address: keep.address || gone.address, city: keep.city || gone.city, confidential: keep.confidential || gone.confidential,
        notes: [keep.notes, gone.notes && `From ${gone.ref}: ${gone.notes}`].filter(Boolean).join("\n"),
      },
    });
    await tx.client.update({ where: { id: mergeId }, data: { archivedAt: new Date(), mergedIntoId: keepId } });
    await noteOn(tx, ctx, keepId, `Merged ${gone.ref} ${gone.name} into this record`);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: keepId, action: "crm.clients_merged", detail: { kept: keep.ref, merged: gone.ref } });
  });
}

export async function listClients(ctx: Ctx, opts: { q?: string; mine?: boolean; archived?: boolean } = {}) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const q = (opts.q ?? "").trim();
    const qn = normalisePhone(q);
    const rows = await tx.client.findMany({
      where: {
        companyId: ctx.companyId, archivedAt: opts.archived ? { not: null } : null, ...(opts.mine ? { ownerId: ctx.membershipId } : {}),
        AND: [clientVisibleWhere(ctx, owners), q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { ref: { contains: q, mode: "insensitive" } }, { emailNorm: { contains: q.toLowerCase() } }, ...(qn.length >= 4 ? [{ phoneNorm: { contains: qn } }] : [])] } as Prisma.ClientWhereInput : {}],
      },
      orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { leads: true } } },
    });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } });
    return { rows, owners: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>, members: members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name })) };
  });
}

export async function getClient(ctx: Ctx, id: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const client = await tx.client.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!client || !canSeeClient(ctx, owners, client, owners !== null && (await myLeadOn(tx, ctx, id)))) return null;
    const [leads, activities, requirements, sources, members, dupes] = await Promise.all([
      tx.lead.findMany({ where: { companyId: ctx.companyId, clientId: id }, orderBy: { createdAt: "desc" } }),
      tx.clientActivity.findMany({ where: { companyId: ctx.companyId, clientId: id }, orderBy: { occurredAt: "desc" }, take: 200 }),
      tx.propertyRequirement.findMany({ where: { companyId: ctx.companyId, clientId: id }, orderBy: { createdAt: "desc" }, include: { matches: true } }),
      (async () => { await ensureSources(tx, ctx.companyId); return tx.leadSource.findMany({ where: { companyId: ctx.companyId, active: true }, orderBy: { name: "asc" } }); })(),
      tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } }),
      client.archivedAt ? Promise.resolve([]) : findDuplicates(tx, ctx.companyId, { id, name: client.name, emailNorm: client.emailNorm, phoneNorm: client.phoneNorm, city: client.city }),
    ]);
    return {
      client, leads, activities, requirements, sources,
      names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>,
      userNames: Object.fromEntries(members.map((m) => [m.userId, m.user.name])) as Record<string, string>,
      agents: members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name })),
      duplicates: dupes.map((x) => ({ id: x.client.id, ref: x.client.ref, name: x.client.name, reasons: x.reasons, visible: canSeeClient(ctx, owners, x.client) })),
      canChange: canChange(ctx, client),
    };
  });
}

// ---------- Leads ----------

const leadSchema = z.object({
  title: z.string().trim().min(3, "Say what the client is interested in").max(200),
  sourceId: optionalId,
  listingId: optionalId,
  ownerId: optionalId,
  budgetMax: optionalMoney,
  timeline: z.enum(TIMELINES).default("UNKNOWN"),
  financing: z.enum(FINANCING).default("UNKNOWN"),
  decisionMaker: z.union([z.boolean(), z.string()]).optional().transform(yes),
});

/** The agent with the fewest open leads, so new leads spread evenly. Ties go to whoever joined first. */
async function leastBusyAgent(tx: Tx, companyId: string): Promise<string | null> {
  const agents = await tx.membership.findMany({ where: { companyId, status: "ACTIVE", role: "AGENT" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (agents.length === 0) return null;
  const counts = await tx.lead.groupBy({ by: ["ownerId"], where: { companyId, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] }, ownerId: { in: agents.map((a) => a.id) } }, _count: { _all: true } });
  const by = new Map(counts.map((c) => [c.ownerId, c._count._all]));
  return agents.map((a) => ({ id: a.id, n: by.get(a.id) ?? 0 })).sort((x, y) => x.n - y.n)[0].id;
}

async function makeLead(tx: Tx, ctx: Ctx, client: { id: string; email: string; phone: string; ownerId: string }, d: z.output<typeof leadSchema>, extra: { sourceEnquiryId?: string } = {}) {
  await ensureSources(tx, ctx.companyId);
  if (d.sourceId && !(await tx.leadSource.findFirst({ where: { id: d.sourceId, companyId: ctx.companyId, active: true } }))) throw new Error("Choose an active lead source");
  if (d.listingId && !(await tx.listing.findFirst({ where: { id: d.listingId, companyId: ctx.companyId } }))) throw new Error("Listing not found");
  let ownerId = ctx.membershipId;
  if (d.ownerId && d.ownerId !== ctx.membershipId) {
    if (!isManager(ctx)) throw new Error("Only a manager can give a lead to someone else");
    ownerId = d.ownerId;
  } else if (isManager(ctx) && !d.ownerId) {
    ownerId = (await leastBusyAgent(tx, ctx.companyId)) ?? ctx.membershipId;
  }
  if (ownerId !== ctx.membershipId) await activeAgent(tx, ctx.companyId, ownerId);
  const hasContact = !!(client.email || client.phone);
  const year = todayInLagos().getUTCFullYear();
  const lead = await tx.lead.create({
    data: {
      companyId: ctx.companyId, ref: ref("LD", year, await nextNumber(tx, ctx.companyId, "LEAD", year)), clientId: client.id, sourceId: d.sourceId, sourceEnquiryId: extra.sourceEnquiryId, listingId: d.listingId,
      title: d.title, ownerId, assignedById: ownerId === ctx.membershipId ? null : ctx.userId, assignedAt: ownerId === ctx.membershipId ? null : new Date(),
      budgetMaxKobo: d.budgetMax, timeline: d.timeline, financing: d.financing, decisionMaker: d.decisionMaker,
      score: qualificationScore({ budgetMaxKobo: d.budgetMax, timeline: d.timeline, financing: d.financing, decisionMaker: d.decisionMaker, hasContact }), createdById: ctx.userId,
    },
  });
  await noteOn(tx, ctx, client.id, `Lead ${lead.ref} opened: ${d.title}`, lead.id);
  await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lead", entityId: lead.id, action: "crm.lead_created", detail: { ref: lead.ref, ownerId } });
  return lead;
}

export async function createLead(ctx: Ctx, clientId: string, raw: z.input<typeof leadSchema>) {
  assertCan(ctx, "crm.manage");
  const d = leadSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, clientId);
    if (c.archivedAt) throw new Error("This client is archived");
    return makeLead(tx, ctx, c, d);
  });
}

/** Turn a public enquiry into a lead. A matching client (same email or phone) is reused, otherwise one is created. Each enquiry becomes a lead once. */
export async function createLeadFromEnquiry(ctx: Ctx, enquiryId: string) {
  assertCan(ctx, "crm.manage");
  assertCan(ctx, "enquiry.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const enquiry = await tx.enquiry.findFirst({ where: { id: enquiryId, companyId: ctx.companyId }, include: { listing: { select: { id: true, title: true } } } });
    if (!enquiry) throw new Error("Enquiry not found");
    if (await tx.lead.findFirst({ where: { sourceEnquiryId: enquiryId } })) throw new Error("This enquiry has already been made into a lead");
    await ensureSources(tx, ctx.companyId);
    const source = await tx.leadSource.findFirst({ where: { companyId: ctx.companyId, name: "Website enquiry" } });
    const isEmail = enquiry.contact.includes("@");
    const emailNorm = isEmail ? normaliseEmail(enquiry.contact) : "";
    const phoneNorm = isEmail ? "" : normalisePhone(enquiry.contact);
    let client = await tx.client.findFirst({
      where: { companyId: ctx.companyId, archivedAt: null, OR: [...(emailNorm ? [{ emailNorm }] : []), ...(phoneNorm ? [{ phoneNorm }] : [])] },
    });
    if (client) {
      const owners = await visibleOwners(tx, ctx);
      if (!canSeeClient(ctx, owners, client)) throw new Error(`This enquirer is already a client (${client.ref}) held by someone else. Ask a manager to assign the lead.`);
    } else {
      const year = todayInLagos().getUTCFullYear();
      client = await tx.client.create({
        data: {
          companyId: ctx.companyId, ref: ref("CLT", year, await nextNumber(tx, ctx.companyId, "CLT", year)), name: enquiry.name, email: isEmail ? enquiry.contact : "", emailNorm,
          phone: isEmail ? "" : enquiry.contact, phoneNorm, ownerId: ctx.membershipId, createdById: ctx.userId,
        },
      });
    }
    const lead = await makeLead(tx, ctx, client, leadSchema.parse({ title: `Enquiry about ${enquiry.listing.title}`, sourceId: source?.id, listingId: enquiry.listing.id }), { sourceEnquiryId: enquiryId });
    await tx.clientActivity.create({ data: { companyId: ctx.companyId, clientId: client.id, leadId: lead.id, kind: "NOTE", subject: "Original enquiry", body: enquiry.message, system: true, createdById: ctx.userId } });
    return { lead, client };
  });
}

export async function updateQualification(ctx: Ctx, leadId: string, raw: Pick<z.input<typeof leadSchema>, "budgetMax" | "timeline" | "financing" | "decisionMaker" | "title">) {
  assertCan(ctx, "crm.manage");
  const d = leadSchema.pick({ budgetMax: true, timeline: true, financing: true, decisionMaker: true, title: true }).parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, companyId: ctx.companyId } });
    if (!lead) throw new Error("Lead not found");
    const client = await loadClient(tx, ctx, lead.clientId);
    if (!canChange(ctx, lead)) throw new Error("Only the lead's owner or a manager can change it");
    if (lead.status === "CONVERTED") throw new Error("This lead has become a transaction and can no longer be changed");
    const q = { budgetMaxKobo: d.budgetMax, timeline: d.timeline, financing: d.financing, decisionMaker: d.decisionMaker, hasContact: !!(client.email || client.phone) };
    if (lead.status === "QUALIFIED" && qualificationProblem(q)) throw new Error(`${qualificationProblem(q)}. Move the lead back to contacted first if the details are no longer known`);
    await tx.lead.update({ where: { id: leadId }, data: { title: d.title, budgetMaxKobo: d.budgetMax, timeline: d.timeline, financing: d.financing, decisionMaker: d.decisionMaker, score: qualificationScore(q) } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lead", entityId: leadId, action: "crm.lead_qualification_updated", detail: { score: qualificationScore(q) } });
  });
}

export async function setLeadStatus(ctx: Ctx, leadId: string, to: LeadStatus, reasonInput = "") {
  assertCan(ctx, "crm.manage");
  const reason = z.string().trim().max(500).parse(reasonInput);
  if (to === "CONVERTED") throw new Error("A lead becomes converted when a transaction is opened from it");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM leads WHERE id = $1 AND company_id = $2 FOR UPDATE`, leadId, ctx.companyId);
    if (rows.length === 0) throw new Error("Lead not found");
    const lead = await tx.lead.findFirstOrThrow({ where: { id: leadId, companyId: ctx.companyId } });
    const client = await loadClient(tx, ctx, lead.clientId);
    if (!canChange(ctx, lead)) throw new Error("Only the lead's owner or a manager can change it");
    const problem = leadTransitionProblem(lead.status as LeadStatus, to);
    if (problem) throw new Error(problem);
    const data: Record<string, unknown> = { status: to };
    if (to === "QUALIFIED") {
      const q = { budgetMaxKobo: lead.budgetMaxKobo, timeline: lead.timeline, financing: lead.financing, decisionMaker: lead.decisionMaker, hasContact: !!(client.email || client.phone) };
      const p = qualificationProblem(q);
      if (p) throw new Error(p);
      Object.assign(data, { qualifiedById: ctx.userId, qualifiedAt: new Date() });
    }
    if (to === "LOST") {
      if (reason.length < 3) throw new Error("Say why the lead was lost");
      data.lostReason = reason;
    }
    if (to === "CONTACTED") Object.assign(data, { lostReason: "", qualifiedById: null, qualifiedAt: null });
    await tx.lead.update({ where: { id: leadId }, data });
    await noteOn(tx, ctx, lead.clientId, `Lead ${lead.ref} moved from ${lead.status.toLowerCase()} to ${to.toLowerCase()}`, leadId, reason);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lead", entityId: leadId, action: "crm.lead_status", detail: { from: lead.status, to, reason } });
  });
}

/** Give an open lead to another agent. */
export async function assignLead(ctx: Ctx, leadId: string, ownerId: string, reasonInput: string) {
  assertCan(ctx, "crm.assign");
  const reason = z.string().trim().min(3, "Give the reason for the reassignment").max(500).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM leads WHERE id = $1 AND company_id = $2 FOR UPDATE`, leadId, ctx.companyId);
    if (rows.length === 0) throw new Error("Lead not found");
    const lead = await tx.lead.findFirstOrThrow({ where: { id: leadId, companyId: ctx.companyId } });
    if (["CONVERTED", "LOST"].includes(lead.status)) throw new Error("Only an open lead can be reassigned");
    if (lead.ownerId === ownerId) throw new Error("That agent already owns this lead");
    await activeAgent(tx, ctx.companyId, ownerId);
    await tx.lead.update({ where: { id: leadId }, data: { ownerId, assignedById: ctx.userId, assignedAt: new Date() } });
    await noteOn(tx, ctx, lead.clientId, `Lead ${lead.ref} reassigned`, leadId, reason);
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "lead", entityId: leadId, action: "crm.lead_reassigned", detail: { from: lead.ownerId, to: ownerId, reason } });
  });
}

/** Called by the transaction workflow when a deal is opened from a lead. Runs in the caller's transaction. */
export async function markLeadConverted(tx: Tx, ctx: Ctx, leadId: string) {
  const lead = await tx.lead.findFirst({ where: { id: leadId, companyId: ctx.companyId } });
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "CONVERTED") return lead;
  if (lead.status !== "QUALIFIED") throw new Error("Only a qualified lead can become a transaction. Qualify the lead first");
  return tx.lead.update({ where: { id: leadId }, data: { status: "CONVERTED", convertedAt: new Date() } });
}

export async function listLeads(ctx: Ctx, opts: { status?: string; mine?: boolean } = {}) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const leads = await tx.lead.findMany({
      where: {
        companyId: ctx.companyId, ...(opts.status ? { status: opts.status as never } : {}), ...(opts.mine ? { ownerId: ctx.membershipId } : {}),
        client: { is: clientVisibleWhere(ctx, owners) },
        ...(owners === null ? {} : { ownerId: { in: owners } }),
      },
      orderBy: { createdAt: "desc" }, take: 300, include: { client: { select: { id: true, ref: true, name: true } }, source: { select: { name: true } } },
    });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } });
    return {
      leads, names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>,
      agents: members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name })),
    };
  });
}

// ---------- Activities and follow-ups ----------

const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  subject: z.string().trim().min(2, "Enter a short subject").max(200),
  body: text(4000),
  leadId: optionalId,
  dueOn: optionalDate,
  assigneeId: optionalId,
});

export async function addClientActivity(ctx: Ctx, clientId: string, raw: z.input<typeof activitySchema>) {
  assertCan(ctx, "crm.manage");
  const d = activitySchema.parse(raw);
  if (d.kind === "FOLLOW_UP" && !d.dueOn) throw new Error("Choose the date the follow-up is due");
  if (d.kind === "FOLLOW_UP" && d.dueOn!.getTime() < todayInLagos().getTime()) throw new Error("The follow-up date cannot be in the past");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, clientId);
    if (c.archivedAt) throw new Error("This client is archived");
    if (d.leadId && !(await tx.lead.findFirst({ where: { id: d.leadId, companyId: ctx.companyId, clientId } }))) throw new Error("Lead not found for this client");
    let assigneeId = d.assigneeId;
    if (d.kind === "FOLLOW_UP") {
      assigneeId = assigneeId ?? ctx.membershipId;
      if (assigneeId !== ctx.membershipId) {
        if (!isManager(ctx) && c.ownerId !== ctx.membershipId) throw new Error("Only the client's owner or a manager can give a follow-up to someone else");
        await activeAgent(tx, ctx.companyId, assigneeId);
        const who = await tx.membership.findFirstOrThrow({ where: { id: assigneeId, companyId: ctx.companyId }, select: { role: true } });
        const sees = who.role !== "AGENT" || assigneeId === c.ownerId || (await tx.lead.count({ where: { companyId: ctx.companyId, clientId, ownerId: assigneeId } })) > 0;
        if (!sees) throw new Error("That agent cannot see this client. Give them a lead on the client first");
      }
    } else assigneeId = null;
    const a = await tx.clientActivity.create({
      data: { companyId: ctx.companyId, clientId, leadId: d.leadId, kind: d.kind, subject: d.subject, body: d.body, dueOn: d.kind === "FOLLOW_UP" ? d.dueOn : null, assigneeId, createdById: ctx.userId },
    });
    if (d.leadId && d.kind !== "FOLLOW_UP" && d.kind !== "NOTE") {
      await tx.lead.updateMany({ where: { id: d.leadId, companyId: ctx.companyId, status: "NEW" }, data: { status: "CONTACTED" } });
    }
    return a;
  });
}

export async function completeFollowUp(ctx: Ctx, activityId: string, outcomeInput: string) {
  assertCan(ctx, "crm.manage");
  const outcome = z.string().trim().max(1000).parse(outcomeInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const a = await tx.clientActivity.findFirst({ where: { id: activityId, companyId: ctx.companyId, kind: "FOLLOW_UP" } });
    if (!a) throw new Error("Follow-up not found");
    const c = await loadClient(tx, ctx, a.clientId);
    if (a.assigneeId !== ctx.membershipId && !canChange(ctx, c)) throw new Error("Only the person it is assigned to, the client's owner or a manager can complete this follow-up");
    const r = await tx.clientActivity.updateMany({ where: { id: activityId, companyId: ctx.companyId, doneAt: null }, data: { doneAt: new Date(), doneById: ctx.userId, body: outcome ? `${a.body ? a.body + "\n" : ""}Outcome: ${outcome}` : a.body } });
    if (r.count === 0) throw new Error("This follow-up is already done");
  });
}

export async function myFollowUps(ctx: Ctx, days = 7) {
  assertCan(ctx, "crm.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const rows = await tx.clientActivity.findMany({
      where: {
        companyId: ctx.companyId, kind: "FOLLOW_UP", doneAt: null, dueOn: { lte: new Date(today.getTime() + days * 864e5) }, assigneeId: ctx.membershipId,
        client: { is: clientVisibleWhere(ctx, owners) },
      },
      orderBy: { dueOn: "asc" }, take: 100, include: { client: { select: { id: true, ref: true, name: true } } },
    });
    return rows.map((r) => ({ ...r, overdue: r.dueOn!.getTime() < today.getTime() }));
  });
}

// ---------- Requirements and matching ----------

const requirementSchema = z.object({
  purpose: z.enum(["SALE", "RENT", "LEASE"]),
  assetClass: z.enum(["", "RESIDENTIAL", "COMMERCIAL", "LAND", "INDUSTRIAL", "OTHER"]).default(""),
  city: text(100),
  state: text(100),
  bedroomsMin: z.string().trim().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 50), "Bedrooms is a whole number from 0 to 50"),
  budgetMin: optionalMoney,
  budgetMax: z.string().trim().min(1, "Enter the most the client can spend").transform((v) => parseNairaToKobo(v)),
  notes: text(2000),
  leadId: optionalId,
});

export async function addRequirement(ctx: Ctx, clientId: string, raw: z.input<typeof requirementSchema>) {
  assertCan(ctx, "crm.manage");
  const d = requirementSchema.parse(raw);
  if (d.budgetMax <= 0n) throw new Error("The budget must be more than zero");
  if (d.budgetMin !== null && d.budgetMin > d.budgetMax) throw new Error("The lowest budget cannot be above the highest");
  if (!d.city && !d.state) throw new Error("Enter the city or state where the client wants to be");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const c = await loadClient(tx, ctx, clientId);
    if (c.archivedAt) throw new Error("This client is archived");
    if (d.leadId && !(await tx.lead.findFirst({ where: { id: d.leadId, companyId: ctx.companyId, clientId } }))) throw new Error("Lead not found for this client");
    const r = await tx.propertyRequirement.create({
      data: { companyId: ctx.companyId, clientId, leadId: d.leadId, purpose: d.purpose, assetClass: d.assetClass, city: d.city, state: d.state, bedroomsMin: d.bedroomsMin, budgetMinKobo: d.budgetMin, budgetMaxKobo: d.budgetMax, notes: d.notes, createdById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "client", entityId: clientId, action: "crm.requirement_added", detail: { purpose: d.purpose } });
    return r;
  });
}

export async function setRequirementActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.propertyRequirement.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!r) throw new Error("Requirement not found");
    const c = await loadClient(tx, ctx, r.clientId);
    if (!canChange(ctx, c)) throw new Error("Only the client's owner or a manager can change this");
    await tx.propertyRequirement.update({ where: { id }, data: { active } });
  });
}

/** Published listings that fit a requirement, best first, with where each one stands in the follow-up. */
export async function matchesFor(ctx: Ctx, requirementId: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const req = await tx.propertyRequirement.findFirst({ where: { id: requirementId, companyId: ctx.companyId } });
    if (!req) throw new Error("Requirement not found");
    await loadClient(tx, ctx, req.clientId);
    const listings = await tx.listing.findMany({ where: { companyId: ctx.companyId, status: "PUBLISHED", purpose: req.purpose }, include: { asset: { select: { assetClass: true, ref: true, name: true } } }, take: 500 });
    const stored = await tx.requirementMatch.findMany({ where: { requirementId } });
    const status = new Map(stored.map((m) => [m.listingId, m]));
    const need = { purpose: req.purpose, city: req.city, state: req.state, assetClass: req.assetClass, bedroomsMin: req.bedroomsMin, budgetMinKobo: req.budgetMinKobo, budgetMaxKobo: req.budgetMaxKobo };
    const out = listings.flatMap((l) => {
      const m = matchScore(need, { purpose: l.purpose, city: l.city, state: l.state, priceKobo: l.priceKobo, bedrooms: l.bedrooms, assetClass: l.asset.assetClass });
      return m ? [{ listing: l, score: m.score, reasons: m.reasons, match: status.get(l.id) ?? null }] : [];
    });
    return out.sort((a, b) => b.score - a.score).slice(0, 25);
  });
}

export async function setMatchStatus(ctx: Ctx, requirementId: string, listingId: string, status: (typeof MATCH_STATUSES)[number], noteInput = "") {
  assertCan(ctx, "crm.manage");
  const st = z.enum(MATCH_STATUSES).parse(status);
  const note = z.string().trim().max(500).parse(noteInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const req = await tx.propertyRequirement.findFirst({ where: { id: requirementId, companyId: ctx.companyId } });
    if (!req) throw new Error("Requirement not found");
    const c = await loadClient(tx, ctx, req.clientId);
    if (!canChange(ctx, c)) throw new Error("Only the client's owner or a manager can change this");
    const listing = await tx.listing.findFirst({ where: { id: listingId, companyId: ctx.companyId, status: "PUBLISHED" } });
    if (!listing) throw new Error("That listing is not published");
    await tx.requirementMatch.upsert({
      where: { requirementId_listingId: { requirementId, listingId } },
      update: { status: st, note, updatedById: ctx.userId },
      create: { companyId: ctx.companyId, requirementId, listingId, status: st, note, updatedById: ctx.userId },
    });
    await noteOn(tx, ctx, req.clientId, `${listing.title}: ${st.toLowerCase()}`, req.leadId, note);
  });
}

// ---------- Overview ----------

export async function crmOverview(ctx: Ctx) {
  assertCan(ctx, "crm.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const scopeLead = { companyId: ctx.companyId, client: { is: clientVisibleWhere(ctx, owners) }, ...(owners === null ? {} : { ownerId: { in: owners } }) };
    const [byStatus, clients, dueFollowUps, enquiries, converted] = await Promise.all([
      tx.lead.groupBy({ by: ["status"], where: scopeLead, _count: { _all: true } }),
      tx.client.count({ where: { companyId: ctx.companyId, archivedAt: null, ...clientVisibleWhere(ctx, owners) } }),
      tx.clientActivity.count({ where: { companyId: ctx.companyId, kind: "FOLLOW_UP", doneAt: null, dueOn: { lte: today }, assigneeId: ctx.membershipId } }),
      can(ctx.role, "enquiry.view") ? tx.enquiry.count({ where: { companyId: ctx.companyId, id: { notIn: (await tx.lead.findMany({ where: { companyId: ctx.companyId, sourceEnquiryId: { not: null } }, select: { sourceEnquiryId: true } })).map((l) => l.sourceEnquiryId!) } } }) : Promise.resolve(0),
      tx.lead.count({ where: { ...scopeLead, status: "CONVERTED" } }),
    ]);
    const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return { clients, newLeads: n("NEW"), contacted: n("CONTACTED"), qualified: n("QUALIFIED"), lost: n("LOST"), converted, dueFollowUps, enquiriesToConvert: enquiries };
  });
}

export async function pendingEnquiries(ctx: Ctx) {
  assertCan(ctx, "crm.manage");
  assertCan(ctx, "enquiry.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const done = (await tx.lead.findMany({ where: { companyId: ctx.companyId, sourceEnquiryId: { not: null } }, select: { sourceEnquiryId: true } })).map((l) => l.sourceEnquiryId!);
    return tx.enquiry.findMany({ where: { companyId: ctx.companyId, id: { notIn: done } }, orderBy: { createdAt: "desc" }, take: 50, include: { listing: { select: { title: true, publicRef: true } } } });
  });
}
