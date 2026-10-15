import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { checkClosure, checkRenewalPeriod, noticeAdequacy } from "../ledger-rules";
import { insertLease } from "./leases";
import { assertCan, type Ctx } from "./context";

// Renewals, notices, handover and closure (master prompt Section 12.3).

async function lockLease(tx: Tx, leaseId: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM leases WHERE id = $1 AND company_id = $2 FOR UPDATE`, leaseId, companyId);
  if (rows.length === 0) throw new Error("Lease not found");
}

// ---------- Renewals ----------

const renewalSchema = z.object({
  startDate: z.string().transform((v) => parseDateOnly(v)),
  endDate: z.string().transform((v) => parseDateOnly(v)),
  rent: z.string().transform((v) => parseNairaToKobo(v)),
  note: z.string().trim().max(1000).default(""),
});

/** Propose a renewal. Nothing changes until someone other than the proposer approves it. */
export async function proposeRenewal(ctx: Ctx, leaseId: string, input: z.input<typeof renewalSchema>) {
  assertCan(ctx, "lease.manage");
  const data = renewalSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockLease(tx, leaseId, ctx.companyId);
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId }, include: { renewals: { where: { status: "PENDING" } }, renewedTo: true } });
    if (lease.status !== "ACTIVE") throw new Error("Only an active lease can be renewed");
    if (lease.renewedTo) throw new Error(`This lease has already been renewed (${lease.renewedTo.ref})`);
    if (lease.renewals.length > 0) throw new Error("A renewal is already waiting for approval on this lease");
    const problem = checkRenewalPeriod(lease.endDate, data.startDate, data.endDate);
    if (problem) throw new Error(problem);
    const renewal = await tx.leaseRenewal.create({
      data: {
        companyId: ctx.companyId, leaseId, proposedStart: data.startDate, proposedEnd: data.endDate,
        proposedRentKobo: data.rent, note: data.note, requestedById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "lease.renewal_proposed",
      detail: { renewalId: renewal.id, start: data.startDate.toISOString().slice(0, 10), end: data.endDate.toISOString().slice(0, 10), rentKobo: data.rent.toString() },
    });
    return renewal;
  });
}

/**
 * Approve or reject a proposed renewal. Approval needs a different person from the proposer and
 * creates the new lease with the old lease's terms. The deposit stays on the old lease until settled.
 */
export async function decideRenewal(ctx: Ctx, renewalId: string, decision: "approve" | "reject", noteInput: string) {
  const note = z.string().trim().max(500).parse(noteInput);
  if (decision === "approve") assertCan(ctx, "renewal.approve"); else assertCan(ctx, "lease.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const found = await tx.leaseRenewal.findFirst({ where: { id: renewalId, companyId: ctx.companyId }, select: { leaseId: true } });
    if (!found) throw new Error("Renewal not found");
    await lockLease(tx, found.leaseId, ctx.companyId);
    const renewal = await tx.leaseRenewal.findUniqueOrThrow({ where: { id: renewalId } });
    if (renewal.status !== "PENDING") throw new Error("This renewal has already been decided");
    if (decision === "approve" && renewal.requestedById === ctx.userId) {
      throw new Error("A renewal must be approved by someone other than the person who proposed it");
    }
    if (decision === "reject") {
      await tx.leaseRenewal.update({ where: { id: renewalId }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note } });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: renewal.leaseId,
        action: "lease.renewal_rejected", detail: { renewalId, note },
      });
      return null;
    }
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: renewal.leaseId }, include: { renewedTo: true } });
    if (lease.status !== "ACTIVE") throw new Error("The lease is no longer active");
    if (lease.renewedTo) throw new Error(`This lease has already been renewed (${lease.renewedTo.ref})`);
    const created = await insertLease(tx, ctx, lease.assetId, {
      occupantName: lease.occupantName, occupantContact: lease.occupantContact, unit: lease.unit,
      startDate: renewal.proposedStart, endDate: renewal.proposedEnd, rent: renewal.proposedRentKobo,
      frequency: lease.frequency, intervalMonths: lease.intervalMonths, deposit: 0n,
      graceDays: lease.graceDays, noticeDays: lease.noticeDays, floorAreaSqm: lease.floorAreaSqm, permittedUse: lease.permittedUse, otherTerms: lease.otherTerms,
    }, lease.id);
    await tx.leaseRenewal.update({
      where: { id: renewalId },
      data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note, newLeaseId: created.id },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: lease.id,
      action: "lease.renewal_approved", detail: { renewalId, newLease: created.ref, note },
    });
    return created;
  });
}

// ---------- Notices ----------

const noticeSchema = z.object({
  givenBy: z.enum(["TENANT", "LANDLORD"]),
  givenOn: z.string().transform((v) => parseDateOnly(v)),
  effectiveOn: z.string().transform((v) => parseDateOnly(v)),
  reason: z.string().trim().min(3, "Record the reason or type of notice").max(1000),
});

/** Record a notice given by the tenant or the landlord. Short notice is flagged, not blocked. */
export async function recordNotice(ctx: Ctx, leaseId: string, input: z.input<typeof noticeSchema>) {
  assertCan(ctx, "lease.manage");
  const data = noticeSchema.parse(input);
  const today = todayInLagos();
  if (data.givenOn > today) throw new Error("The date the notice was given cannot be in the future");
  if (data.effectiveOn < data.givenOn) throw new Error("A notice cannot take effect before it was given");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId: ctx.companyId } });
    if (!lease) throw new Error("Lease not found");
    if (lease.status !== "ACTIVE") throw new Error("Notices can only be recorded on an active lease");
    const adequacy = noticeAdequacy(data.givenOn, data.effectiveOn, lease.noticeDays);
    const notice = await tx.leaseNotice.create({
      data: { companyId: ctx.companyId, leaseId, givenBy: data.givenBy, givenOn: data.givenOn, effectiveOn: data.effectiveOn, reason: data.reason, recordedById: ctx.userId },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "lease.notice_recorded",
      detail: { by: data.givenBy, days: adequacy.days, requiredDays: adequacy.requiredDays, shortNotice: adequacy.short },
    });
    return { notice, adequacy };
  });
}

// ---------- Handover ----------

const handoverSchema = z.object({
  kind: z.enum(["MOVE_IN", "MOVE_OUT"]),
  handoverOn: z.string().transform((v) => parseDateOnly(v)),
  keysCount: z.string().trim().regex(/^\d{1,3}$/, "Enter the number of keys handed over as a whole number"),
  meterReadings: z.string().trim().max(500).default(""),
  conditionNotes: z.string().trim().min(5, "Describe the condition of the premises").max(3000),
  issues: z.string().trim().max(2000).default(""),
  acknowledgedBy: z.string().trim().min(2, "Enter the name of the person who acknowledged the handover").max(200),
});

/** Record a signed-off move-in or move-out. One of each per lease, and it cannot be edited afterwards. */
export async function recordHandover(ctx: Ctx, leaseId: string, input: z.input<typeof handoverSchema>) {
  assertCan(ctx, "handover.record");
  const data = handoverSchema.parse(input);
  const today = todayInLagos();
  if (data.handoverOn > today) throw new Error("The handover date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockLease(tx, leaseId, ctx.companyId);
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId }, include: { handovers: true } });
    if (lease.handovers.some((h) => h.kind === data.kind)) {
      throw new Error(`A ${data.kind === "MOVE_IN" ? "move-in" : "move-out"} handover has already been recorded for this lease`);
    }
    const moveIn = lease.handovers.find((h) => h.kind === "MOVE_IN");
    if (data.kind === "MOVE_OUT" && moveIn && data.handoverOn < moveIn.handoverOn) {
      throw new Error("The move-out cannot be dated before the move-in");
    }
    const handover = await tx.leaseHandover.create({
      data: {
        companyId: ctx.companyId, leaseId, kind: data.kind, handoverOn: data.handoverOn, keysCount: Number(data.keysCount),
        meterReadings: data.meterReadings, conditionNotes: data.conditionNotes, issues: data.issues,
        acknowledgedBy: data.acknowledgedBy, recordedById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "lease.handover_recorded",
      detail: { kind: data.kind, keys: Number(data.keysCount), acknowledgedBy: data.acknowledgedBy },
    });
    return handover;
  });
}

// ---------- Closure ----------

const closeSchema = z.object({
  outcome: z.enum(["ENDED", "TERMINATED"]),
  closedOn: z.string().transform((v) => parseDateOnly(v)),
  reason: z.string().trim().max(1000).default(""),
});

/**
 * Close a lease after the move-out handover. Rent charges not yet due and untouched by any payment or
 * adjustment are removed; everything else stays so arrears can still be collected. If nothing else
 * occupies the property, it goes back to vacant.
 */
export async function closeLease(ctx: Ctx, leaseId: string, input: z.input<typeof closeSchema>) {
  assertCan(ctx, "lease.close");
  const data = closeSchema.parse(input);
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockLease(tx, leaseId, ctx.companyId);
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: leaseId }, include: { handovers: true, asset: true } });
    const problem = checkClosure({
      outcome: data.outcome, closedOn: data.closedOn, today, startDate: lease.startDate, endDate: lease.endDate,
      reason: data.reason, hasMoveOut: lease.handovers.some((h) => h.kind === "MOVE_OUT"), status: lease.status,
    });
    if (problem) throw new Error(problem);
    const removed = await tx.rentCharge.deleteMany({
      where: {
        leaseId, companyId: ctx.companyId, dueDate: { gt: data.closedOn }, paidKobo: 0, adjustedKobo: 0,
        payments: { none: {} }, adjustments: { none: {} },
      },
    });
    await tx.lease.update({
      where: { id: leaseId },
      data: { status: data.outcome, closedOn: data.closedOn, closeReason: data.reason },
    });
    const stillOccupied = await tx.lease.count({
      where: { companyId: ctx.companyId, assetId: lease.assetId, status: "ACTIVE", id: { not: leaseId }, startDate: { lte: today }, endDate: { gt: today } },
    });
    if (stillOccupied === 0 && lease.asset.status === "OCCUPIED") {
      await tx.asset.update({ where: { id: lease.assetId }, data: { status: "VACANT" } });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: lease.assetId,
        action: "asset.status_changed", detail: { from: "OCCUPIED", to: "VACANT", reason: `Lease ${lease.ref} closed` },
      });
    }
    const open = await tx.rentCharge.findMany({ where: { leaseId, companyId: ctx.companyId } });
    const arrears = open.reduce((sum, c) => {
      const owed = c.amountKobo + c.adjustedKobo - c.paidKobo;
      return c.dueDate <= today && owed > 0n ? sum + owed : sum;
    }, 0n);
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: leaseId, action: "lease.closed",
      detail: { outcome: data.outcome, closedOn: data.closedOn.toISOString().slice(0, 10), reason: data.reason, removedCharges: removed.count, arrearsKobo: arrears.toString() },
    });
    return { removedCharges: removed.count, arrearsKobo: arrears };
  });
}
