import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { can } from "../permissions";
import { saveFile, validateUpload, readStoredFile } from "../storage";
import {
  formatReference, nextStatus, OPEN_FOR_RESPONSE, type CorrAction, type CorrStatus,
} from "../correspondence-rules";
import { assertCan, type Ctx } from "./context";

// Correspondence register (master prompt Section 11).

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const CATEGORIES = [
  "General", "Government and regulatory", "Legal", "Tenant", "Landlord or owner", "Contractor or vendor",
  "Client", "Finance", "Insurance", "Complaint",
] as const;
export const DISPATCH_METHODS = ["Email", "Courier", "Hand delivery", "Registered post", "Other"] as const;

type Upload = { name: string; type: string; bytes: Uint8Array };

/** Records the user may see. Confidential items are limited to managers, the assignee and the creator. */
export function visibleWhere(ctx: Ctx): Prisma.CorrespondenceWhereInput {
  if (can(ctx.role, "correspondence.confidential")) return { companyId: ctx.companyId };
  return {
    companyId: ctx.companyId,
    OR: [{ confidential: false }, { assigneeId: ctx.membershipId }, { createdById: ctx.userId }],
  };
}

async function nextReference(tx: Tx, ctx: Ctx, departmentCode: string | null) {
  const year = todayInLagos().getUTCFullYear();
  const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { refPrefix: true } });
  // Atomic per-company, per-year sequence. Concurrent registrations never share a number.
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO correspondence_counters (company_id, year, last_number) VALUES (${ctx.companyId}, ${year}, 1)
    ON CONFLICT (company_id, year) DO UPDATE SET last_number = correspondence_counters.last_number + 1
    RETURNING last_number`;
  return formatReference(company.refPrefix, departmentCode, year, Number(rows[0].last_number));
}

async function recordAction(tx: Tx, ctx: Ctx, id: string, kind: string, from: CorrStatus | null, to: CorrStatus | null, note = "") {
  await tx.correspondenceAction.create({
    data: { companyId: ctx.companyId, correspondenceId: id, kind, fromStatus: from, toStatus: to, note, actorId: ctx.userId },
    select: { id: true },
  });
  await logActivity(tx, {
    companyId: ctx.companyId, actorId: ctx.userId, entityType: "correspondence", entityId: id,
    action: `correspondence.${kind.toLowerCase()}`, detail: { from, to, note: note.slice(0, 500) },
  });
}

async function attach(tx: Tx, ctx: Ctx, correspondenceId: string, title: string, file: Upload) {
  validateUpload(file.type, file.bytes);
  const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
  await tx.correspondenceAttachment.create({
    data: {
      companyId: ctx.companyId, correspondenceId, title: title || file.name.slice(0, 200), fileName: file.name.slice(0, 200),
      mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey, uploadedById: ctx.userId,
    },
    select: { id: true },
  });
}

const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));

const registerSchema = z.object({
  direction: z.enum(["INCOMING", "OUTGOING"]),
  subject: z.string().trim().min(3, "Enter the subject").max(300),
  description: z.string().trim().max(5000).default(""),
  category: z.string().trim().max(80).default("General"),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  confidential: z.boolean().default(false),
  senderName: z.string().trim().min(2, "Enter the sender").max(200),
  recipientName: z.string().trim().min(2, "Enter the recipient").max(200),
  copiedTo: z.string().trim().max(500).default(""),
  externalRef: z.string().trim().max(120).default(""),
  dateReceived: optionalDate,
  responseDeadline: optionalDate,
  assetId: z.string().optional().transform((v) => v || null),
  departmentId: z.string().optional().transform((v) => v || null),
  assigneeId: z.string().optional().transform((v) => v || null),
  draftResponse: z.string().trim().max(20000).default(""),
});

/**
 * Register a letter. Incoming letters start as Registered (or Assigned if an assignee is chosen).
 * Outgoing letters start as a draft that must be approved before dispatch.
 */
export async function registerCorrespondence(ctx: Ctx, input: z.input<typeof registerSchema>, file?: Upload | null) {
  assertCan(ctx, "correspondence.register");
  const data = registerSchema.parse(input);
  if (data.direction === "INCOMING" && !data.dateReceived) throw new Error("Enter the date the letter was received");
  if (data.dateReceived && data.dateReceived > todayInLagos()) throw new Error("The date received cannot be in the future");
  if (data.direction === "OUTGOING" && data.draftResponse.length < 10) throw new Error("Write the letter text (at least 10 characters)");
  if (data.assigneeId && !can(ctx.role, "correspondence.assign")) throw new Error("Only a manager can assign correspondence");
  if (file) validateUpload(file.type, file.bytes);

  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    let departmentCode: string | null = null;
    if (data.departmentId) {
      const d = await tx.department.findFirst({ where: { id: data.departmentId, companyId: ctx.companyId } });
      if (!d) throw new Error("That department was not found");
      departmentCode = d.code;
    }
    if (data.assetId && !(await tx.asset.findFirst({ where: { id: data.assetId, companyId: ctx.companyId }, select: { id: true } }))) {
      throw new Error("That asset was not found");
    }
    if (data.assigneeId && !(await tx.membership.findFirst({ where: { id: data.assigneeId, companyId: ctx.companyId, status: "ACTIVE" } }))) {
      throw new Error("Assign the letter to an active member of your company");
    }
    const status: CorrStatus = data.direction === "OUTGOING" ? "DRAFT_RESPONSE" : data.assigneeId ? "ASSIGNED" : "REGISTERED";
    const ref = await nextReference(tx, ctx, departmentCode);
    const rec = await tx.correspondence.create({
      data: {
        companyId: ctx.companyId, ref, direction: data.direction, subject: data.subject, description: data.description,
        category: data.category || "General", priority: data.priority, confidential: data.confidential, status,
        senderName: data.senderName, recipientName: data.recipientName, copiedTo: data.copiedTo, externalRef: data.externalRef,
        dateReceived: data.dateReceived, responseDeadline: data.responseDeadline, assetId: data.assetId,
        departmentId: data.departmentId, assigneeId: data.assigneeId, createdById: ctx.userId,
        draftResponse: data.direction === "OUTGOING" ? data.draftResponse : "",
        draftedById: data.direction === "OUTGOING" ? ctx.userId : null,
      },
    });
    await recordAction(tx, ctx, rec.id, "REGISTERED", null, status, data.direction === "INCOMING" ? "Incoming letter registered" : "Outgoing letter drafted");
    if (file) await attach(tx, ctx, rec.id, "Scanned letter", file);
    return rec;
  });
}

export type ListFilter = { q?: string; status?: string; direction?: string; view?: "mine" | "overdue" | "unassigned" | "approval" };

export async function listCorrespondence(ctx: Ctx, f: ListFilter = {}) {
  assertCan(ctx, "correspondence.view");
  const today = todayInLagos();
  const and: Prisma.CorrespondenceWhereInput[] = [visibleWhere(ctx)];
  if (f.status) and.push({ status: f.status as CorrStatus });
  if (f.direction === "INCOMING" || f.direction === "OUTGOING") and.push({ direction: f.direction });
  if (f.q) and.push({ OR: [
    { subject: { contains: f.q, mode: "insensitive" } }, { ref: { contains: f.q, mode: "insensitive" } },
    { senderName: { contains: f.q, mode: "insensitive" } }, { recipientName: { contains: f.q, mode: "insensitive" } },
    { externalRef: { contains: f.q, mode: "insensitive" } },
  ] });
  if (f.view === "mine") and.push({ assigneeId: ctx.membershipId, status: { not: "CLOSED" } });
  if (f.view === "unassigned") and.push({ status: "REGISTERED" });
  if (f.view === "approval") and.push({ status: "AWAITING_APPROVAL" });
  if (f.view === "overdue") and.push({ responseDeadline: { lt: today }, status: { in: OPEN_FOR_RESPONSE } });
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.correspondence.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: "desc" }],
      take: 300,
      include: { assignee: { include: { user: { select: { name: true } } } }, department: { select: { code: true } } },
    }));
}

export async function correspondenceSummary(ctx: Ctx) {
  assertCan(ctx, "correspondence.view");
  const today = todayInLagos();
  const in7 = new Date(today.getTime() + 7 * 864e5);
  const base = visibleWhere(ctx);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => ({
    unassigned: await tx.correspondence.count({ where: { AND: [base, { status: "REGISTERED" }] } }),
    overdue: await tx.correspondence.count({ where: { AND: [base, { responseDeadline: { lt: today }, status: { in: OPEN_FOR_RESPONSE } }] } }),
    dueSoon: await tx.correspondence.count({ where: { AND: [base, { responseDeadline: { gte: today, lte: in7 }, status: { in: OPEN_FOR_RESPONSE } }] } }),
    awaitingApproval: await tx.correspondence.count({ where: { AND: [base, { status: "AWAITING_APPROVAL" }] } }),
    mine: await tx.correspondence.count({ where: { AND: [base, { assigneeId: ctx.membershipId, status: { not: "CLOSED" } }] } }),
  }));
}

/** One record with its history and attachments, or null if it does not exist or is not visible to this user. */
export async function getCorrespondence(ctx: Ctx, id: string) {
  assertCan(ctx, "correspondence.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rec = await tx.correspondence.findFirst({
      where: { AND: [visibleWhere(ctx), { id }] },
      include: {
        actions: { orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "asc" } },
        assignee: { include: { user: { select: { name: true } } } },
        department: true,
        asset: { select: { id: true, ref: true, name: true } },
      },
    });
    if (!rec) return null;
    const ids = Array.from(new Set([...rec.actions.map((a) => a.actorId), rec.draftedById, rec.approvedById, rec.createdById].filter((v): v is string => !!v)));
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return { rec, names: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
  });
}

export type ActionInput = {
  expectedStatus: string;
  note?: string;
  assigneeId?: string;
  requiredAction?: string;
  responseDeadline?: string;
  draftResponse?: string;
  dispatchMethod?: string;
  dispatchedOn?: string;
};

/**
 * Move a record through the workflow. `expectedStatus` guards against two people acting on the
 * same record at once: if the status changed in the meantime, the action is refused.
 */
export async function actOnCorrespondence(ctx: Ctx, id: string, action: CorrAction, input: ActionInput) {
  assertCan(ctx, "correspondence.view");
  const note = (input.note ?? "").trim().slice(0, 2000);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM correspondence WHERE id = ${id} AND company_id = ${ctx.companyId} FOR UPDATE`;
    if (!locked.length) throw new Error("Correspondence not found");
    const rec = await tx.correspondence.findFirst({ where: { AND: [visibleWhere(ctx), { id }] } });
    if (!rec) throw new Error("Correspondence not found");
    if (rec.status !== input.expectedStatus) {
      throw new Error("Someone else updated this record while you were working on it. Review the latest version and try again.");
    }
    const from = rec.status as CorrStatus;
    const to = nextStatus(action, from);
    const isAssignee = rec.assigneeId === ctx.membershipId;
    const canAssign = can(ctx.role, "correspondence.assign");
    const canApprove = can(ctx.role, "correspondence.approve");
    const requireHandler = () => {
      if (!isAssignee && !canAssign) throw new Error("Only the assigned officer or a manager can do that");
    };
    const data: Prisma.CorrespondenceUpdateInput = { status: to };

    switch (action) {
      case "assign": {
        if (!canAssign) throw new Error("Only a manager can assign correspondence");
        const m = input.assigneeId ? await tx.membership.findFirst({ where: { id: input.assigneeId, companyId: ctx.companyId, status: "ACTIVE" } }) : null;
        if (!m) throw new Error("Choose an active member to assign this to");
        data.assignee = { connect: { id: m.id } };
        if (input.responseDeadline) data.responseDeadline = parseDateOnly(input.responseDeadline);
        break;
      }
      case "start_review":
        requireHandler();
        break;
      case "require_response": {
        requireHandler();
        const required = (input.requiredAction ?? "").trim();
        if (required.length < 3) throw new Error("Describe the response that is required");
        data.requiredAction = required.slice(0, 2000);
        if (input.responseDeadline) data.responseDeadline = parseDateOnly(input.responseDeadline);
        break;
      }
      case "save_draft":
      case "submit_for_approval": {
        requireHandler();
        const draft = (input.draftResponse ?? rec.draftResponse).trim();
        if (draft.length < 10) throw new Error("Write the response (at least 10 characters)");
        data.draftResponse = draft.slice(0, 20000);
        data.draftedById = ctx.userId;
        break;
      }
      case "approve":
        if (!canApprove) throw new Error("Only a manager can approve a response");
        // Segregation of duties: the person who wrote the response cannot approve it.
        if (rec.draftedById === ctx.userId) throw new Error("Someone other than the person who drafted the response must approve it");
        data.approvedById = ctx.userId;
        data.approvedAt = new Date();
        break;
      case "return_to_draft":
        if (!canApprove) throw new Error("Only a manager can return a response for changes");
        if (note.length < 3) throw new Error("Explain what needs to change");
        break;
      case "dispatch": {
        requireHandler();
        const method = (input.dispatchMethod ?? "").trim();
        if (!method) throw new Error("Choose how the letter was sent");
        const on = input.dispatchedOn ? parseDateOnly(input.dispatchedOn) : todayInLagos();
        if (on > todayInLagos()) throw new Error("The dispatch date cannot be in the future");
        data.dispatchMethod = method.slice(0, 80);
        data.dispatchedAt = on;
        data.dateIssued = on;
        break;
      }
      case "await_reply":
        requireHandler();
        break;
      case "close": {
        if (note.length < 5) throw new Error("Record how this was resolved before closing it (at least 5 characters)");
        const owesResponse = ["RESPONSE_REQUIRED", "DRAFT_RESPONSE", "APPROVED"].includes(from);
        if (owesResponse && !canAssign) throw new Error("A response is still due. Only a manager can close this without sending it");
        if (!owesResponse) requireHandler();
        data.closedAt = new Date();
        data.closureNote = note;
        break;
      }
    }
    await tx.correspondence.update({ where: { id: rec.id }, data });
    await recordAction(tx, ctx, rec.id, action.toUpperCase(), from, to, note);
  });
}

export async function addCorrespondenceNote(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "correspondence.view");
  const text = note.trim();
  if (text.length < 2) throw new Error("Write a note first");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rec = await tx.correspondence.findFirst({ where: { AND: [visibleWhere(ctx), { id }] }, select: { id: true } });
    if (!rec) throw new Error("Correspondence not found");
    await recordAction(tx, ctx, rec.id, "NOTE", null, null, text.slice(0, 2000));
  });
}

export async function addCorrespondenceAttachment(ctx: Ctx, id: string, title: string, file: Upload) {
  assertCan(ctx, "correspondence.register");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const rec = await tx.correspondence.findFirst({ where: { AND: [visibleWhere(ctx), { id }] }, select: { id: true } });
    if (!rec) throw new Error("Correspondence not found");
    await attach(tx, ctx, rec.id, title.trim().slice(0, 200), file);
    await recordAction(tx, ctx, rec.id, "ATTACHED", null, null, title.trim().slice(0, 200) || file.name.slice(0, 200));
  });
}

/** Download an attachment, respecting confidentiality. Records the access. */
export async function getCorrespondenceAttachment(ctx: Ctx, attachmentId: string) {
  assertCan(ctx, "correspondence.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const att = await tx.correspondenceAttachment.findFirst({ where: { id: attachmentId, companyId: ctx.companyId } });
    if (!att) return null;
    const rec = await tx.correspondence.findFirst({ where: { AND: [visibleWhere(ctx), { id: att.correspondenceId }] }, select: { id: true } });
    if (!rec) return null;
    const bytes = await readStoredFile(tx, ctx.companyId, att.storageKey);
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "correspondence", entityId: rec.id,
      action: "correspondence.attachment_downloaded", detail: { attachmentId: att.id, title: att.title },
    });
    return { att, bytes };
  });
}
