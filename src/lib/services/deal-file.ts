import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { parseNairaToKobo } from "../money";
import { readStoredFile, saveFile, validateUpload } from "../storage";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";
import { visibleWhere as correspondenceVisible } from "./correspondence";
import { canChangeDeal, loadDeal, lockDeal, mustBeOpen, mustChange } from "./deal";
import type { Upload } from "./photos";

// The deal file: everything tied to one deal in one place (master prompt Phase 8). Documents, payments, correspondence, tasks and
// conversations are linked to the deal and its client, and each follows the access rules of the thing it came from.

export const DEAL_DOC_KINDS = ["OFFER_LETTER", "SALES_AGREEMENT", "TENANCY_AGREEMENT", "TITLE_DOCUMENT", "SURVEY", "IDENTITY", "PROOF_OF_FUNDS", "LEGAL", "OTHER"] as const;
export const DEAL_PAYMENT_KINDS = ["BOOKING_DEPOSIT", "PART_PAYMENT", "BALANCE", "AGENCY_FEE", "LEGAL_FEE", "REFUND", "OTHER"] as const;

// ---------- Documents ----------

export async function addDealDocument(ctx: Ctx, dealId: string, rawKind: string, title: string, file: Upload) {
  assertCan(ctx, "crm.manage");
  const kind = z.enum(DEAL_DOC_KINDS).parse(rawKind);
  const t = z.string().trim().min(2, "Give the document a title").max(200).parse(title);
  validateUpload(file.type, file.bytes);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    if (deal.status === "CANCELLED") throw new Error("This deal was cancelled, so documents can no longer be added");
    const storageKey = await saveFile(tx, ctx.companyId, file.type, file.bytes);
    const doc = await tx.dealDocument.create({
      data: { companyId: ctx.companyId, dealId, kind, title: t, fileName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.bytes.byteLength, storageKey, uploadedById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.document_added", detail: { title: t, kind } });
    return doc;
  });
}

export async function getDealDocument(ctx: Ctx, documentId: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const doc = await tx.dealDocument.findFirst({ where: { id: documentId, companyId: ctx.companyId } });
    if (!doc) return null;
    try { await loadDeal(tx, ctx, doc.dealId); } catch { return null; }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: doc.dealId, action: "deal.document_opened", detail: { title: doc.title } });
    return { doc, bytes: await readStoredFile(tx, ctx.companyId, doc.storageKey) };
  });
}

// ---------- Payments ----------

const paymentSchema = z.object({
  kind: z.enum(DEAL_PAYMENT_KINDS),
  amount: z.string().trim().min(1, "Enter the amount").transform((v) => parseNairaToKobo(v)).refine((v) => v > 0n, "The amount must be more than zero"),
  paidOn: z.string().trim().min(1, "Enter the date paid").transform((v) => parseDateOnly(v)),
  method: z.string().trim().max(100).default(""),
  reference: z.string().trim().max(200).default(""),
  note: z.string().trim().max(1000).default(""),
});

export async function recordDealPayment(ctx: Ctx, dealId: string, raw: z.input<typeof paymentSchema>) {
  assertCan(ctx, "crm.manage");
  const d = paymentSchema.parse(raw);
  if (d.paidOn.getTime() > todayInLagos().getTime()) throw new Error("The payment date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    if (deal.status === "CANCELLED") throw new Error("This deal was cancelled, so payments can no longer be recorded against it");
    const p = await tx.dealPayment.create({ data: { companyId: ctx.companyId, dealId, kind: d.kind, amountKobo: d.amount, paidOn: d.paidOn, method: d.method, reference: d.reference, note: d.note, recordedById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.payment_recorded", detail: { kind: d.kind, amountKobo: String(d.amount) } });
    return p;
  });
}

/** Cancel out a wrong payment with a reversal. A manager other than the person who recorded it must do this. */
export async function reverseDealPayment(ctx: Ctx, paymentId: string, reasonInput: string) {
  assertCan(ctx, "crm.approve");
  const reason = z.string().trim().min(3, "Say why the payment is reversed").max(1000).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const p = await tx.dealPayment.findFirst({ where: { id: paymentId, companyId: ctx.companyId } });
    if (!p) throw new Error("Payment not found");
    await lockDeal(tx, ctx, p.dealId);
    if (p.reversesId) throw new Error("A reversal cannot itself be reversed");
    if (p.recordedById === ctx.userId) throw new Error("Someone other than the person who recorded the payment must reverse it");
    if (await tx.dealPayment.findFirst({ where: { reversesId: p.id } })) throw new Error("This payment has already been reversed");
    const r = await tx.dealPayment.create({
      data: { companyId: ctx.companyId, dealId: p.dealId, kind: p.kind, amountKobo: p.amountKobo, paidOn: todayInLagos(), reference: p.reference, note: reason, reversesId: p.id, recordedById: ctx.userId },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: p.dealId, action: "deal.payment_reversed", detail: { paymentId: p.id, reason } });
    return r;
  });
}

/** What has been received against a deal: refunds count against it, reversed payments and reversals cancel out. */
export function paymentTotals(rows: { id: string; kind: string; amountKobo: bigint; reversesId: string | null }[]) {
  const reversed = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId!));
  let received = 0n;
  let refunded = 0n;
  for (const r of rows) {
    if (r.reversesId || reversed.has(r.id)) continue;
    if (r.kind === "REFUND") refunded += r.amountKobo;
    else received += r.amountKobo;
  }
  return { received, refunded, net: received - refunded };
}

// ---------- Correspondence ----------

export async function linkCorrespondence(ctx: Ctx, dealId: string, correspondenceId: string, unlink = false) {
  assertCan(ctx, "crm.manage");
  assertCan(ctx, "correspondence.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    const rec = await tx.correspondence.findFirst({ where: { AND: [correspondenceVisible(ctx), { id: correspondenceId }] }, select: { id: true, dealId: true } });
    if (!rec) throw new Error("Correspondence not found");
    if (unlink) {
      if (rec.dealId !== dealId) throw new Error("That correspondence is not linked to this deal");
      await tx.correspondence.update({ where: { id: rec.id }, data: { dealId: null, clientId: null } });
    } else {
      if (rec.dealId && rec.dealId !== dealId) throw new Error("That correspondence is already linked to another deal. Unlink it there first");
      await tx.correspondence.update({ where: { id: rec.id }, data: { dealId, clientId: deal.clientId } });
    }
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: unlink ? "deal.correspondence_unlinked" : "deal.correspondence_linked", detail: { correspondenceId } });
  });
}

// ---------- Tasks ----------

const taskSchema = z.object({
  title: z.string().trim().min(3, "Enter a short title").max(200),
  description: z.string().trim().max(2000).default(""),
  dueOn: z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null)),
  assigneeId: z.string().optional().transform((v) => v || null),
});

export async function addDealTask(ctx: Ctx, dealId: string, raw: z.input<typeof taskSchema>) {
  assertCan(ctx, "crm.manage");
  const d = taskSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    const assigneeId = d.assigneeId ?? ctx.membershipId;
    if (assigneeId !== ctx.membershipId) {
      const m = await tx.membership.findFirst({ where: { id: assigneeId, companyId: ctx.companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"] } } });
      if (!m) throw new Error("Assign the task to an active agent or manager");
      if (m.role === "AGENT" && assigneeId !== deal.ownerId) throw new Error("That agent cannot see this deal. Assign it to the deal's owner or a manager");
    }
    const task = await tx.task.create({ data: { companyId: ctx.companyId, assetId: deal.assetId, dealId, kind: "TASK", title: d.title, description: d.description, assigneeId, dueOn: d.dueOn, createdById: ctx.userId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "task", entityId: task.id, action: "task.created", detail: { dealId, title: d.title } });
    return task;
  });
}

export async function setDealTaskStatus(ctx: Ctx, taskId: string, status: "DONE" | "OPEN" | "CANCELLED", outcomeInput = "") {
  assertCan(ctx, "crm.manage");
  const outcome = z.string().trim().max(1000).parse(outcomeInput);
  if (status === "DONE" && outcome.length < 3) throw new Error("Record the outcome before marking the task done");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, companyId: ctx.companyId, dealId: { not: null } } });
    if (!task) throw new Error("Task not found");
    const deal = await loadDeal(tx, ctx, task.dealId!);
    if (task.assigneeId !== ctx.membershipId && !canChangeDeal(ctx, deal)) throw new Error("Only the assignee, the deal's owner or a manager can update this task");
    await tx.task.update({ where: { id: taskId }, data: { status, outcome: outcome || task.outcome } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "task", entityId: taskId, action: "task.status_changed", detail: { status } });
  });
}

// ---------- The whole file ----------

export async function getDealFile(ctx: Ctx, dealId: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await loadDeal(tx, ctx, dealId);
    const [client, asset, documents, payments, correspondence, tasks, activities, viewings, lead, members, linkable] = await Promise.all([
      tx.client.findFirstOrThrow({ where: { id: deal.clientId, companyId: ctx.companyId }, select: { id: true, ref: true, name: true } }),
      tx.asset.findFirstOrThrow({ where: { id: deal.assetId, companyId: ctx.companyId }, select: { id: true, ref: true, name: true } }),
      tx.dealDocument.findMany({ where: { dealId, companyId: ctx.companyId }, orderBy: { createdAt: "desc" } }),
      tx.dealPayment.findMany({ where: { dealId, companyId: ctx.companyId }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] }),
      can(ctx.role, "correspondence.view")
        ? tx.correspondence.findMany({ where: { AND: [correspondenceVisible(ctx), { dealId }] }, orderBy: { createdAt: "desc" }, select: { id: true, ref: true, subject: true, direction: true, status: true, createdAt: true } })
        : Promise.resolve([]),
      tx.task.findMany({ where: { dealId, companyId: ctx.companyId }, orderBy: [{ status: "asc" }, { dueOn: "asc" }] }),
      tx.clientActivity.findMany({ where: { companyId: ctx.companyId, clientId: deal.clientId, OR: [{ dealId }, ...(deal.leadId ? [{ leadId: deal.leadId }] : [])] }, orderBy: { occurredAt: "desc" }, take: 200 }),
      tx.viewing.findMany({ where: { dealId, companyId: ctx.companyId }, orderBy: { startsAt: "desc" } }),
      deal.leadId ? tx.lead.findFirst({ where: { id: deal.leadId, companyId: ctx.companyId }, select: { id: true, ref: true, title: true } }) : Promise.resolve(null),
      tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } }),
      can(ctx.role, "correspondence.view") && canChangeDeal(ctx, deal)
        ? tx.correspondence.findMany({ where: { AND: [correspondenceVisible(ctx), { dealId: null }] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ref: true, subject: true } })
        : Promise.resolve([]),
    ]);
    return {
      deal, client, asset, lead, documents, payments, totals: paymentTotals(payments), correspondence, tasks, activities, viewings, linkable,
      names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>,
      userNames: Object.fromEntries(members.map((m) => [m.userId, m.user.name])) as Record<string, string>,
      agents: members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name })),
      canChange: canChangeDeal(ctx, deal),
    };
  });
}
