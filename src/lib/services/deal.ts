import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseDateOnly, todayInLagos } from "../dates";
import { parseNairaToKobo } from "../money";
import { nextNumber } from "../numbering";
import { DEAL_TYPES, lagosToUtc, offerAcceptable, overlaps, slotProblem, stageMoveProblem, type DealStage } from "../deal-rules";
import { can } from "../permissions";
import { assertCan, type Ctx } from "./context";
import { activeAgent, loadClient, markLeadConverted, visibleOwners } from "./crm";

// Deals: the path from enquiry to completion (master prompt Phase 8). A deal has one client, one property and one owner.
// Agents see their own deals, a team lead sees the team's, managers see all. A confidential client's deals stay with the owner and managers.
// Prices are agreed only when a second person approves an accepted offer, and a deal is completed only by someone other than its owner.

const optionalId = z.string().optional().transform((v) => v || null);
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));
const money = (what: string) => z.string().trim().min(1, `Enter ${what}`).transform((v) => parseNairaToKobo(v)).refine((v) => v > 0n, `${what[0].toUpperCase()}${what.slice(1)} must be more than zero`);
const reasonText = (msg: string) => z.string().trim().min(3, msg).max(1000);
const isManager = (ctx: Ctx) => can(ctx.role, "crm.assign");

export function dealVisibleWhere(ctx: Ctx, owners: string[] | null): Prisma.DealWhereInput {
  if (owners === null) return {};
  return { OR: [{ ownerId: ctx.membershipId }, { ownerId: { in: owners }, client: { is: { confidential: false } } }] };
}

export async function lockDeal(tx: Tx, ctx: Ctx, id: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM deals WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, ctx.companyId);
  if (rows.length === 0) throw new Error("Deal not found");
  const owners = await visibleOwners(tx, ctx);
  const deal = await tx.deal.findFirst({ where: { id, companyId: ctx.companyId, AND: [dealVisibleWhere(ctx, owners)] } });
  if (!deal) throw new Error("Deal not found");
  return deal;
}

/** A deal the person may see, without locking it. */
export async function loadDeal(tx: Tx, ctx: Ctx, id: string) {
  const owners = await visibleOwners(tx, ctx);
  const deal = await tx.deal.findFirst({ where: { id, companyId: ctx.companyId, AND: [dealVisibleWhere(ctx, owners)] } });
  if (!deal) throw new Error("Deal not found");
  return deal;
}

export const canChangeDeal = (ctx: Ctx, d: { ownerId: string }) => isManager(ctx) || d.ownerId === ctx.membershipId;
export function mustChange(ctx: Ctx, d: { ownerId: string }) {
  if (!canChangeDeal(ctx, d)) throw new Error("Only the deal's owner or a manager can do that");
}
export function mustBeOpen(d: { status: string }) {
  if (d.status !== "OPEN") throw new Error(`This deal is ${d.status.toLowerCase().replace("_", " ")}, so it cannot be changed this way`);
}

async function event(tx: Tx, ctx: Ctx, dealId: string, e: { kind: "OPENED" | "STAGE" | "STATUS" | "REASSIGNED" | "VIEWING" | "OFFER" | "NOTE"; summary: string; reason?: string; fromStage?: DealStage; toStage?: DealStage; fromStatus?: string; toStatus?: string }) {
  await tx.dealEvent.create({
    data: { companyId: ctx.companyId, dealId, kind: e.kind, summary: e.summary, reason: e.reason ?? "", fromStage: e.fromStage, toStage: e.toStage, fromStatus: e.fromStatus as never, toStatus: e.toStatus as never, actorId: ctx.userId },
  });
}

async function advisory(tx: Tx, keys: string[]) {
  for (const k of [...new Set(keys)].sort()) await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, k);
}

// ---------- Opening and moving a deal ----------

const createSchema = z.object({
  clientId: z.string().min(1, "Choose the client"),
  leadId: optionalId,
  assetId: z.string().min(1, "Choose the property"),
  listingId: optionalId,
  type: z.enum(DEAL_TYPES).optional(),
  title: z.string().trim().max(200).default(""),
  asking: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  expectedCloseOn: optionalDate,
  ownerId: optionalId,
});

export async function createDeal(ctx: Ctx, raw: z.input<typeof createSchema>) {
  assertCan(ctx, "crm.manage");
  const d = createSchema.parse(raw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const client = await loadClient(tx, ctx, d.clientId);
    if (client.archivedAt) throw new Error("This client is archived");
    const asset = await tx.asset.findFirst({ where: { id: d.assetId, companyId: ctx.companyId }, select: { id: true, name: true, ref: true } });
    if (!asset) throw new Error("Property not found");
    const listing = d.listingId ? await tx.listing.findFirst({ where: { id: d.listingId, companyId: ctx.companyId, assetId: d.assetId } }) : await tx.listing.findFirst({ where: { companyId: ctx.companyId, assetId: d.assetId } });
    if (d.listingId && !listing) throw new Error("That listing does not belong to this property");
    const type = d.type ?? listing?.purpose;
    if (!type) throw new Error("Say whether this is a sale, a rent or a lease");
    const asking = d.asking ?? listing?.priceKobo ?? null;
    if (asking === null || asking <= 0n) throw new Error("Enter the asking price");
    let ownerId = ctx.membershipId;
    if (d.leadId) {
      const lead = await tx.lead.findFirst({ where: { id: d.leadId, companyId: ctx.companyId, clientId: d.clientId } });
      if (!lead) throw new Error("Lead not found for this client");
      if (lead.ownerId !== ctx.membershipId && !isManager(ctx)) throw new Error("Only the lead's owner or a manager can open a deal from it");
      ownerId = lead.ownerId;
      await markLeadConverted(tx, ctx, lead.id);
    } else if (d.ownerId && d.ownerId !== ctx.membershipId) {
      if (!isManager(ctx)) throw new Error("Only a manager can give a deal to someone else");
      ownerId = d.ownerId;
    }
    if (ownerId !== ctx.membershipId) await activeAgent(tx, ctx.companyId, ownerId);
    const open = await tx.deal.findFirst({ where: { companyId: ctx.companyId, clientId: d.clientId, assetId: d.assetId, type, status: { in: ["OPEN", "ON_HOLD", "DISPUTED"] } }, select: { ref: true } });
    if (open) throw new Error(`${open.ref} is already open for this client and property`);
    const year = todayInLagos().getUTCFullYear();
    const n = await nextNumber(tx, ctx.companyId, "DEAL", year);
    const deal = await tx.deal.create({
      data: {
        companyId: ctx.companyId, ref: `DL-${year}-${String(n).padStart(4, "0")}`, type, title: d.title || `${asset.name} for ${client.name}`, clientId: d.clientId, leadId: d.leadId, assetId: d.assetId,
        listingId: listing?.id ?? null, ownerId, askingKobo: asking, expectedCloseOn: d.expectedCloseOn, createdById: ctx.userId,
      },
    });
    await event(tx, ctx, deal.id, { kind: "OPENED", summary: `Deal opened at ${asset.ref}`, toStage: "ENQUIRY", toStatus: "OPEN" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: deal.id, action: "deal.opened", detail: { ref: deal.ref, leadId: d.leadId } });
    return deal;
  });
}

export async function moveStage(ctx: Ctx, dealId: string, to: DealStage, reasonInput = "") {
  assertCan(ctx, "crm.manage");
  const reason = z.string().trim().max(1000).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    const problem = stageMoveProblem(deal.stage, to, deal.status, reason);
    if (problem) throw new Error(problem);
    await tx.deal.update({ where: { id: dealId }, data: { stage: to } });
    await event(tx, ctx, dealId, { kind: "STAGE", summary: `Moved from ${deal.stage.toLowerCase()} to ${to.toLowerCase()}`, reason, fromStage: deal.stage, toStage: to });
  });
}

export async function setHold(ctx: Ctx, dealId: string, hold: boolean, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = hold ? reasonText("Say why the deal is on hold").parse(reasonInput) : z.string().trim().max(1000).parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    if (hold) {
      mustBeOpen(deal);
      await tx.deal.update({ where: { id: dealId }, data: { status: "ON_HOLD", holdReason: reason } });
    } else {
      if (deal.status !== "ON_HOLD") throw new Error("This deal is not on hold");
      await tx.deal.update({ where: { id: dealId }, data: { status: "OPEN", holdReason: "" } });
    }
    await event(tx, ctx, dealId, { kind: "STATUS", summary: hold ? "Put on hold" : "Resumed", reason, fromStatus: deal.status, toStatus: hold ? "ON_HOLD" : "OPEN" });
  });
}

/** Cancel a deal that has not completed. Once a price is agreed, only a manager can cancel it. */
export async function cancelDeal(ctx: Ctx, dealId: string, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = reasonText("Say why the deal is cancelled").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    if (deal.status === "COMPLETED") throw new Error("A completed deal cannot be cancelled");
    if (deal.status === "CANCELLED") throw new Error("This deal is already cancelled");
    if (["AGREED", "LEGAL"].includes(deal.stage) && !can(ctx.role, "crm.approve")) throw new Error("Once a price is agreed, only a manager can cancel the deal");
    const now = new Date();
    await tx.viewing.updateMany({ where: { dealId, companyId: ctx.companyId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelReason: "Deal cancelled" } });
    await tx.offer.updateMany({ where: { dealId, companyId: ctx.companyId, status: { in: ["OPEN", "ACCEPTANCE_REQUESTED", "ACCEPTED"] } }, data: { status: "WITHDRAWN", decisionNote: "Deal cancelled" } });
    await tx.deal.update({ where: { id: dealId }, data: { status: "CANCELLED", cancelReason: reason, cancelledAt: now, cancelledById: ctx.userId } });
    await event(tx, ctx, dealId, { kind: "STATUS", summary: "Cancelled", reason, fromStatus: deal.status, toStatus: "CANCELLED" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.cancelled", detail: { reason, stage: deal.stage } });
  });
}

export async function raiseDispute(ctx: Ctx, dealId: string, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = reasonText("Say what the dispute is about").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    if (!["OPEN", "ON_HOLD"].includes(deal.status)) throw new Error("Only a live deal can be disputed");
    await tx.deal.update({ where: { id: dealId }, data: { status: "DISPUTED", disputeReason: reason, disputedById: ctx.userId, disputedAt: new Date(), disputeOutcome: "" } });
    await event(tx, ctx, dealId, { kind: "STATUS", summary: "Dispute raised", reason, fromStatus: deal.status, toStatus: "DISPUTED" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.disputed", detail: { reason } });
  });
}

/** A manager other than the person who raised the dispute settles it. The deal then carries on, or is cancelled. */
export async function resolveDispute(ctx: Ctx, dealId: string, outcomeInput: string, then: "resume" | "cancel") {
  assertCan(ctx, "crm.approve");
  const outcome = reasonText("Record how the dispute was settled").parse(outcomeInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    if (deal.status !== "DISPUTED") throw new Error("This deal is not disputed");
    if (deal.disputedById === ctx.userId) throw new Error("Someone other than the person who raised the dispute must settle it");
    if (then === "cancel") {
      await tx.viewing.updateMany({ where: { dealId, companyId: ctx.companyId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelReason: "Deal cancelled after a dispute" } });
      await tx.offer.updateMany({ where: { dealId, companyId: ctx.companyId, status: { in: ["OPEN", "ACCEPTANCE_REQUESTED", "ACCEPTED"] } }, data: { status: "WITHDRAWN", decisionNote: "Deal cancelled after a dispute" } });
      await tx.deal.update({ where: { id: dealId }, data: { status: "CANCELLED", disputeOutcome: outcome, cancelReason: `Dispute: ${outcome}`, cancelledAt: new Date(), cancelledById: ctx.userId } });
    } else {
      await tx.deal.update({ where: { id: dealId }, data: { status: "OPEN", disputeOutcome: outcome } });
    }
    await event(tx, ctx, dealId, { kind: "STATUS", summary: then === "cancel" ? "Dispute settled, deal cancelled" : "Dispute settled, deal resumed", reason: outcome, fromStatus: "DISPUTED", toStatus: then === "cancel" ? "CANCELLED" : "OPEN" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.dispute_settled", detail: { outcome, then } });
  });
}

export async function reassignDeal(ctx: Ctx, dealId: string, newOwnerId: string, reasonInput: string) {
  assertCan(ctx, "crm.assign");
  const reason = reasonText("Give the reason for the reassignment").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    if (["COMPLETED", "CANCELLED"].includes(deal.status)) throw new Error("A closed deal cannot be reassigned");
    if (deal.ownerId === newOwnerId) throw new Error("That agent already owns this deal");
    await activeAgent(tx, ctx.companyId, newOwnerId);
    await tx.deal.update({ where: { id: dealId }, data: { ownerId: newOwnerId } });
    await event(tx, ctx, dealId, { kind: "REASSIGNED", summary: "Reassigned to another owner", reason });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.reassigned", detail: { from: deal.ownerId, to: newOwnerId, reason } });
  });
}

/** Completion needs a manager who is not the deal's owner, once the deal is in the legal stage. */
export async function completeDeal(ctx: Ctx, dealId: string, noteInput = "") {
  assertCan(ctx, "crm.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustBeOpen(deal);
    if (deal.stage !== "LEGAL") throw new Error("Only a deal in the legal stage can be completed");
    if (deal.ownerId === ctx.membershipId) throw new Error("Someone other than the deal's owner must complete it");
    await tx.deal.update({ where: { id: dealId }, data: { stage: "COMPLETED", status: "COMPLETED", completedAt: new Date(), completedById: ctx.userId } });
    await event(tx, ctx, dealId, { kind: "STAGE", summary: "Completed", reason: note, fromStage: "LEGAL", toStage: "COMPLETED", fromStatus: "OPEN", toStatus: "COMPLETED" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: dealId, action: "deal.completed", detail: { agreedKobo: String(deal.agreedKobo) } });
  });
}

/** Go back to negotiating after a price was agreed. The accepted offer is withdrawn. */
export async function reopenNegotiation(ctx: Ctx, dealId: string, reasonInput: string) {
  assertCan(ctx, "crm.approve");
  const reason = reasonText("Say why the agreement is being reopened").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustBeOpen(deal);
    if (!["AGREED", "LEGAL"].includes(deal.stage)) throw new Error("Only an agreed deal can be reopened");
    await tx.offer.updateMany({ where: { dealId, companyId: ctx.companyId, status: "ACCEPTED" }, data: { status: "WITHDRAWN", decisionNote: `Reopened: ${reason}` } });
    await tx.deal.update({ where: { id: dealId }, data: { stage: "NEGOTIATION", agreedKobo: null, agreedAt: null } });
    await event(tx, ctx, dealId, { kind: "STAGE", summary: "Agreement reopened", reason, fromStage: deal.stage, toStage: "NEGOTIATION" });
  });
}

// ---------- Viewings ----------

const viewingSchema = z.object({
  date: z.string().trim().min(1, "Choose the date"),
  time: z.string().trim().min(1, "Choose the time"),
  minutes: z.string().trim().default("30").transform((v) => Number(v || "30")).refine((v) => Number.isInteger(v), "Enter the length in minutes"),
  agentId: optionalId,
  meetingPoint: z.string().trim().max(300).default(""),
});

async function checkClash(tx: Tx, ctx: Ctx, slot: { startsAt: Date; endsAt: Date }, agentId: string, assetId: string, ignoreId: string | null) {
  await advisory(tx, [`${ctx.companyId}:agent:${agentId}`, `${ctx.companyId}:asset:${assetId}`]);
  const near = await tx.viewing.findMany({
    where: { companyId: ctx.companyId, status: "SCHEDULED", ...(ignoreId ? { id: { not: ignoreId } } : {}), OR: [{ agentId }, { assetId }], startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
  });
  for (const v of near) {
    if (overlaps(slot, v)) throw new Error(v.agentId === agentId ? "That agent already has a viewing at that time" : "The property is already booked for a viewing at that time");
  }
}

export async function scheduleViewing(ctx: Ctx, dealId: string, raw: z.input<typeof viewingSchema>) {
  assertCan(ctx, "crm.manage");
  const d = viewingSchema.parse(raw);
  const startsAt = lagosToUtc(d.date, d.time);
  const slot = { startsAt, endsAt: new Date(startsAt.getTime() + d.minutes * 60_000) };
  const bad = slotProblem(slot, new Date());
  if (bad) throw new Error(bad);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await lockDeal(tx, ctx, dealId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (["AGREED", "LEGAL"].includes(deal.stage)) throw new Error("A price is already agreed, so no more viewings can be booked");
    const agentId = d.agentId ?? deal.ownerId;
    await activeAgent(tx, ctx.companyId, agentId);
    await checkClash(tx, ctx, slot, agentId, deal.assetId, null);
    const v = await tx.viewing.create({ data: { companyId: ctx.companyId, dealId, assetId: deal.assetId, agentId, startsAt: slot.startsAt, endsAt: slot.endsAt, meetingPoint: d.meetingPoint, createdById: ctx.userId } });
    if (deal.stage === "ENQUIRY") {
      await tx.deal.update({ where: { id: dealId }, data: { stage: "VIEWING" } });
      await event(tx, ctx, dealId, { kind: "STAGE", summary: "Moved from enquiry to viewing", reason: "Viewing booked", fromStage: "ENQUIRY", toStage: "VIEWING" });
    }
    await event(tx, ctx, dealId, { kind: "VIEWING", summary: `Viewing booked for ${d.date} at ${d.time}` });
    return v;
  });
}

async function loadViewing(tx: Tx, ctx: Ctx, id: string) {
  const v = await tx.viewing.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!v) throw new Error("Viewing not found");
  const deal = await lockDeal(tx, ctx, v.dealId);
  return { v, deal };
}

export async function rescheduleViewing(ctx: Ctx, viewingId: string, raw: Pick<z.input<typeof viewingSchema>, "date" | "time" | "minutes">) {
  assertCan(ctx, "crm.manage");
  const d = viewingSchema.pick({ date: true, time: true, minutes: true }).parse(raw);
  const startsAt = lagosToUtc(d.date, d.time);
  const slot = { startsAt, endsAt: new Date(startsAt.getTime() + d.minutes * 60_000) };
  const bad = slotProblem(slot, new Date());
  if (bad) throw new Error(bad);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { v, deal } = await loadViewing(tx, ctx, viewingId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (v.status !== "SCHEDULED") throw new Error("Only a scheduled viewing can be moved");
    await checkClash(tx, ctx, slot, v.agentId, v.assetId, v.id);
    await tx.viewing.update({ where: { id: v.id }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, rescheduledCount: { increment: 1 } } });
    await event(tx, ctx, deal.id, { kind: "VIEWING", summary: `Viewing moved to ${d.date} at ${d.time}` });
  });
}

export async function cancelViewing(ctx: Ctx, viewingId: string, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = reasonText("Say why the viewing is cancelled").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { v, deal } = await loadViewing(tx, ctx, viewingId);
    mustChange(ctx, deal);
    if (v.status !== "SCHEDULED") throw new Error("Only a scheduled viewing can be cancelled");
    await tx.viewing.update({ where: { id: v.id }, data: { status: "CANCELLED", cancelReason: reason } });
    await event(tx, ctx, deal.id, { kind: "VIEWING", summary: "Viewing cancelled", reason });
  });
}

export async function recordViewingOutcome(ctx: Ctx, viewingId: string, result: "COMPLETED" | "NO_SHOW", outcomeInput: string) {
  assertCan(ctx, "crm.manage");
  const outcome = z.string().trim().max(2000).parse(outcomeInput);
  if (result === "COMPLETED" && outcome.length < 3) throw new Error("Record how the viewing went");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { v, deal } = await loadViewing(tx, ctx, viewingId);
    if (!canChangeDeal(ctx, deal) && v.agentId !== ctx.membershipId) throw new Error("Only the deal's owner, the agent who held it, or a manager can record the outcome");
    if (v.status !== "SCHEDULED") throw new Error("The outcome of this viewing is already recorded");
    if (v.startsAt.getTime() > Date.now()) throw new Error("The viewing has not happened yet");
    await tx.viewing.update({ where: { id: v.id }, data: { status: result, outcome } });
    await event(tx, ctx, deal.id, { kind: "VIEWING", summary: result === "COMPLETED" ? "Viewing held" : "Client did not attend the viewing", reason: outcome });
  });
}

// ---------- Offers ----------

const offerSchema = z.object({
  amount: money("the amount"),
  conditions: z.string().trim().max(2000).default(""),
  validUntil: optionalDate,
  note: z.string().trim().max(1000).default(""),
});

function checkValidity(validUntil: Date | null) {
  if (validUntil && validUntil.getTime() < todayInLagos().getTime()) throw new Error("The offer's last day cannot be in the past");
}

async function liveForNegotiation(tx: Tx, ctx: Ctx, dealId: string) {
  const deal = await lockDeal(tx, ctx, dealId);
  mustChange(ctx, deal);
  mustBeOpen(deal);
  if (["AGREED", "LEGAL"].includes(deal.stage)) throw new Error("A price is already agreed. Reopen the negotiation to change it");
  return deal;
}

export async function recordOffer(ctx: Ctx, dealId: string, raw: z.input<typeof offerSchema> & { side: "CLIENT" | "OWNER" }) {
  assertCan(ctx, "crm.manage");
  const d = offerSchema.parse(raw);
  const side = z.enum(["CLIENT", "OWNER"]).parse(raw.side);
  checkValidity(d.validUntil);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const deal = await liveForNegotiation(tx, ctx, dealId);
    const live = await tx.offer.count({ where: { dealId, companyId: ctx.companyId, status: { in: ["OPEN", "ACCEPTANCE_REQUESTED"] } } });
    if (live > 0) throw new Error("There is already a live offer. Counter, reject or withdraw it first");
    const o = await tx.offer.create({ data: { companyId: ctx.companyId, dealId, side, amountKobo: d.amount, conditions: d.conditions, validUntil: d.validUntil, note: d.note, recordedById: ctx.userId } });
    if (["ENQUIRY", "VIEWING"].includes(deal.stage)) {
      await tx.deal.update({ where: { id: dealId }, data: { stage: "OFFER" } });
      await event(tx, ctx, dealId, { kind: "STAGE", summary: `Moved from ${deal.stage.toLowerCase()} to offer`, reason: "Offer received", fromStage: deal.stage, toStage: "OFFER" });
    }
    await event(tx, ctx, dealId, { kind: "OFFER", summary: `${side === "CLIENT" ? "Client" : "Owner"} offer recorded` });
    return o;
  });
}

async function loadOffer(tx: Tx, ctx: Ctx, id: string) {
  const o = await tx.offer.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!o) throw new Error("Offer not found");
  const deal = await lockDeal(tx, ctx, o.dealId);
  const fresh = await tx.offer.findFirstOrThrow({ where: { id, companyId: ctx.companyId } });
  return { o: fresh, deal };
}

export async function counterOffer(ctx: Ctx, offerId: string, raw: z.input<typeof offerSchema>) {
  assertCan(ctx, "crm.manage");
  const d = offerSchema.parse(raw);
  checkValidity(d.validUntil);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (o.status !== "OPEN") throw new Error("Only an open offer can be countered");
    await tx.offer.update({ where: { id: o.id }, data: { status: "COUNTERED", decidedById: ctx.userId, decidedAt: new Date() } });
    const next = await tx.offer.create({
      data: { companyId: ctx.companyId, dealId: deal.id, parentId: o.id, side: o.side === "CLIENT" ? "OWNER" : "CLIENT", amountKobo: d.amount, conditions: d.conditions, validUntil: d.validUntil, note: d.note, recordedById: ctx.userId },
    });
    if (deal.stage === "OFFER") {
      await tx.deal.update({ where: { id: deal.id }, data: { stage: "NEGOTIATION" } });
      await event(tx, ctx, deal.id, { kind: "STAGE", summary: "Moved from offer to negotiation", reason: "Counteroffer made", fromStage: "OFFER", toStage: "NEGOTIATION" });
    }
    await event(tx, ctx, deal.id, { kind: "OFFER", summary: `${next.side === "CLIENT" ? "Client" : "Owner"} counteroffer recorded` });
    return next;
  });
}

export async function rejectOffer(ctx: Ctx, offerId: string, reasonInput: string) {
  assertCan(ctx, "crm.manage");
  const reason = reasonText("Say why the offer was rejected").parse(reasonInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (o.status !== "OPEN") throw new Error("Only an open offer can be rejected");
    await tx.offer.update({ where: { id: o.id }, data: { status: "REJECTED", decisionNote: reason, decidedById: ctx.userId, decidedAt: new Date() } });
    await event(tx, ctx, deal.id, { kind: "OFFER", summary: "Offer rejected", reason });
  });
}

export async function withdrawOffer(ctx: Ctx, offerId: string, noteInput = "") {
  assertCan(ctx, "crm.manage");
  const note = z.string().trim().max(1000).parse(noteInput);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (o.status !== "OPEN") throw new Error("Only an open offer can be withdrawn");
    await tx.offer.update({ where: { id: o.id }, data: { status: "WITHDRAWN", decisionNote: note, decidedById: ctx.userId, decidedAt: new Date() } });
    await event(tx, ctx, deal.id, { kind: "OFFER", summary: "Offer withdrawn", reason: note });
  });
}

/** Ask for an offer to be accepted. Nothing is agreed until a second person approves. */
export async function requestAcceptance(ctx: Ctx, offerId: string) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    mustChange(ctx, deal);
    mustBeOpen(deal);
    if (!["OFFER", "NEGOTIATION"].includes(deal.stage)) throw new Error("An offer can be accepted while the deal is at the offer or negotiation stage");
    const problem = offerAcceptable(o, todayInLagos());
    if (problem) throw new Error(problem);
    await tx.offer.update({ where: { id: o.id }, data: { status: "ACCEPTANCE_REQUESTED", acceptRequestedById: ctx.userId, acceptRequestedAt: new Date() } });
    await event(tx, ctx, deal.id, { kind: "OFFER", summary: "Acceptance requested, waiting for approval" });
  });
}

export async function withdrawAcceptanceRequest(ctx: Ctx, offerId: string) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    if (o.status !== "ACCEPTANCE_REQUESTED") throw new Error("There is no acceptance waiting for approval");
    if (o.acceptRequestedById !== ctx.userId && !isManager(ctx)) throw new Error("Only the person who asked, or a manager, can withdraw the request");
    await tx.offer.update({ where: { id: o.id }, data: { status: "OPEN", acceptRequestedById: null, acceptRequestedAt: null } });
    await event(tx, ctx, deal.id, { kind: "OFFER", summary: "Acceptance request withdrawn" });
  });
}

/** Approve or refuse an acceptance. The approver must be a manager other than the person who asked. Approval fixes the price and moves the deal to agreed. */
export async function decideAcceptance(ctx: Ctx, offerId: string, decision: "approve" | "reject", noteInput = "") {
  assertCan(ctx, "crm.approve");
  const note = z.string().trim().max(1000).parse(noteInput);
  if (decision === "reject" && note.length < 3) throw new Error("Say why the acceptance is refused");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const first = await tx.offer.findFirst({ where: { id: offerId, companyId: ctx.companyId } });
    if (!first) throw new Error("Offer not found");
    const dealForAsset = await tx.deal.findFirst({ where: { id: first.dealId, companyId: ctx.companyId }, select: { assetId: true } });
    if (!dealForAsset) throw new Error("Deal not found");
    await advisory(tx, [`${ctx.companyId}:agreement:${dealForAsset.assetId}`]);
    const { o, deal } = await loadOffer(tx, ctx, offerId);
    if (o.status !== "ACCEPTANCE_REQUESTED") throw new Error("There is no acceptance waiting for approval");
    if (o.acceptRequestedById === ctx.userId) throw new Error("Someone other than the person who asked must decide this");
    mustBeOpen(deal);
    if (decision === "reject") {
      await tx.offer.update({ where: { id: o.id }, data: { status: "OPEN", acceptRequestedById: null, acceptRequestedAt: null, decisionNote: note } });
      await event(tx, ctx, deal.id, { kind: "OFFER", summary: "Acceptance refused", reason: note });
      return;
    }
    const problem = offerAcceptable({ status: "OPEN", validUntil: o.validUntil }, todayInLagos());
    if (problem) throw new Error(problem);
    const rivals = await tx.deal.findMany({
      where: {
        companyId: ctx.companyId, assetId: deal.assetId, id: { not: deal.id }, stage: { in: ["AGREED", "LEGAL", "COMPLETED"] },
        type: deal.type === "SALE" ? "SALE" : { in: ["RENT", "LEASE"] },
        status: { in: deal.type === "SALE" ? ["OPEN", "ON_HOLD", "DISPUTED", "COMPLETED"] : ["OPEN", "ON_HOLD", "DISPUTED"] },
      },
      select: { ref: true },
    });
    if (rivals.length > 0) throw new Error(`${rivals[0].ref} has already agreed this property. Resolve that deal first`);
    const now = new Date();
    await tx.offer.update({ where: { id: o.id }, data: { status: "ACCEPTED", decidedById: ctx.userId, decidedAt: now, decisionNote: note } });
    await tx.offer.updateMany({ where: { dealId: deal.id, companyId: ctx.companyId, id: { not: o.id }, status: "OPEN" }, data: { status: "WITHDRAWN", decisionNote: "Another offer was accepted" } });
    await tx.deal.update({ where: { id: deal.id }, data: { stage: "AGREED", agreedKobo: o.amountKobo, agreedAt: now } });
    await event(tx, ctx, deal.id, { kind: "STAGE", summary: "Price agreed", reason: note, fromStage: deal.stage, toStage: "AGREED" });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "deal", entityId: deal.id, action: "deal.agreed", detail: { offerId: o.id, amountKobo: String(o.amountKobo), requestedBy: o.acceptRequestedById } });
  });
}

// ---------- Reading ----------

export async function listDeals(ctx: Ctx, opts: { status?: string; stage?: string; mine?: boolean; q?: string } = {}) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const q = (opts.q ?? "").trim();
    const deals = await tx.deal.findMany({
      where: {
        companyId: ctx.companyId, ...(opts.status ? { status: opts.status as never } : {}), ...(opts.stage ? { stage: opts.stage as never } : {}), ...(opts.mine ? { ownerId: ctx.membershipId } : {}),
        AND: [dealVisibleWhere(ctx, owners), q ? ({ OR: [{ ref: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { client: { is: { name: { contains: q, mode: "insensitive" } } } }] } as Prisma.DealWhereInput) : {}],
      },
      orderBy: { createdAt: "desc" }, take: 300, include: { client: { select: { id: true, ref: true, name: true } }, asset: { select: { id: true, ref: true, name: true } } },
    });
    const members = await tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } });
    return { deals, names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string> };
  });
}

export async function getDeal(ctx: Ctx, id: string) {
  assertCan(ctx, "crm.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const owners = await visibleOwners(tx, ctx);
    const deal = await tx.deal.findFirst({ where: { id, companyId: ctx.companyId, AND: [dealVisibleWhere(ctx, owners)] }, include: { client: { select: { id: true, ref: true, name: true, phone: true, email: true } }, asset: { select: { id: true, ref: true, name: true } } } });
    if (!deal) return null;
    const [events, viewings, offers, members] = await Promise.all([
      tx.dealEvent.findMany({ where: { dealId: id, companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 300 }),
      tx.viewing.findMany({ where: { dealId: id, companyId: ctx.companyId }, orderBy: { startsAt: "desc" } }),
      tx.offer.findMany({ where: { dealId: id, companyId: ctx.companyId }, orderBy: { createdAt: "asc" } }),
      tx.membership.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } } }),
    ]);
    return {
      deal, events, viewings, offers,
      names: Object.fromEntries(members.map((m) => [m.id, m.user.name])) as Record<string, string>,
      userNames: Object.fromEntries(members.map((m) => [m.userId, m.user.name])) as Record<string, string>,
      agents: members.filter((m) => m.status === "ACTIVE" && ["COMPANY_SUPER_ADMIN", "MANAGER", "AGENT"].includes(m.role)).map((m) => ({ id: m.id, name: m.user.name })),
      canChange: canChangeDeal(ctx, deal),
    };
  });
}

/** Deals for the pickers on the client page. */
export async function dealOptions(ctx: Ctx) {
  assertCan(ctx, "crm.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) => tx.asset.findMany({ where: { companyId: ctx.companyId, status: { notIn: ["DISPOSED", "ARCHIVED"] } }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" }, take: 500 }));
}
