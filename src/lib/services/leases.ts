import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { parseDateOnly, todayInLagos } from "../dates";
import { applyPayment, generateRentSchedule } from "../rent";
import { assertCan, type Ctx } from "./context";

export const FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;

const leaseSchema = z.object({
  occupantName: z.string().trim().min(2, "Enter the tenant or occupying organization").max(200),
  occupantContact: z.string().trim().max(200).default(""),
  startDate: z.string().transform((v) => parseDateOnly(v)),
  endDate: z.string().transform((v) => parseDateOnly(v)),
  rent: z.string().transform((v) => parseNairaToKobo(v)),
  frequency: z.enum(FREQUENCIES),
  deposit: z.string().optional().transform((v) => (v ? parseNairaToKobo(v) : 0n)),
});

/** Create a lease and its full rent schedule in one transaction (master prompt Section 12.2). */
export async function createLease(ctx: Ctx, assetId: string, input: z.input<typeof leaseSchema>) {
  assertCan(ctx, "lease.manage");
  const data = leaseSchema.parse(input);
  const schedule = generateRentSchedule({
    startDate: data.startDate, endDate: data.endDate, frequency: data.frequency, rentKobo: data.rent,
  });
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const asset = await tx.asset.findFirst({ where: { id: assetId, companyId: ctx.companyId } });
    if (!asset) throw new Error("Asset not found");
    const overlapping = await tx.lease.findFirst({
      where: { companyId: ctx.companyId, assetId, status: "ACTIVE",
               startDate: { lt: data.endDate }, endDate: { gt: data.startDate } },
    });
    if (overlapping) throw new Error(`This asset already has an active lease (${overlapping.ref}) for those dates.`);
    const count = await tx.lease.count({ where: { companyId: ctx.companyId } });
    const ref = `LSE-${String(count + 1).padStart(5, "0")}`;
    const lease = await tx.lease.create({
      data: {
        companyId: ctx.companyId, assetId, ref, occupantName: data.occupantName,
        occupantContact: data.occupantContact, startDate: data.startDate, endDate: data.endDate,
        rentKobo: data.rent, frequency: data.frequency, depositKobo: data.deposit, createdById: ctx.userId,
      },
    });
    await tx.rentCharge.createMany({
      data: schedule.map((c) => ({ companyId: ctx.companyId, leaseId: lease.id, dueDate: c.dueDate, amountKobo: c.amountKobo })),
    });
    const today = todayInLagos();
    if (data.startDate <= today && data.endDate > today && asset.status !== "OCCUPIED") {
      await tx.asset.update({ where: { id: asset.id }, data: { status: "OCCUPIED" } });
      await logActivity(tx, {
        companyId: ctx.companyId, actorId: ctx.userId, entityType: "asset", entityId: asset.id,
        action: "asset.status_changed", detail: { from: asset.status, to: "OCCUPIED", reason: `Lease ${ref} started` },
      });
    }
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "lease", entityId: lease.id,
      action: "lease.created",
      detail: { ref, occupant: data.occupantName, charges: schedule.length, frequency: data.frequency,
                rentKobo: data.rent.toString() },
    });
    return lease;
  });
}

const paymentSchema = z.object({
  amount: z.string().transform((v) => parseNairaToKobo(v)),
  paidOn: z.string().transform((v) => parseDateOnly(v)),
  evidence: z.string().trim().min(3, "Record the payment evidence, for example a bank transfer reference").max(500),
});

/**
 * Record a payment against a rent charge. A payment needs evidence; a reminder or a status change
 * is never treated as proof of payment (master prompt Section 12.2).
 */
export async function recordPayment(ctx: Ctx, chargeId: string, input: z.input<typeof paymentSchema>) {
  assertCan(ctx, "payment.record");
  const data = paymentSchema.parse(input);
  if (data.paidOn > todayInLagos()) throw new Error("The payment date cannot be in the future");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    // Lock the charge row so two concurrent payments cannot both pass the overpayment check.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM rent_charges WHERE id = ${chargeId} AND company_id = ${ctx.companyId} FOR UPDATE`;
    if (rows.length === 0) throw new Error("Rent charge not found");
    const charge = await tx.rentCharge.findUniqueOrThrow({ where: { id: chargeId } });
    const newPaid = applyPayment(charge, data.amount);
    await tx.rentPayment.create({
      data: { companyId: ctx.companyId, chargeId, amountKobo: data.amount, paidOn: data.paidOn,
              evidence: data.evidence, recordedById: ctx.userId },
    });
    await tx.rentCharge.update({ where: { id: chargeId }, data: { paidKobo: newPaid } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "rent_charge", entityId: chargeId,
      action: "payment.recorded",
      detail: { amountKobo: data.amount.toString(), paidOn: data.paidOn.toISOString().slice(0, 10), evidence: data.evidence },
    });
  });
}
