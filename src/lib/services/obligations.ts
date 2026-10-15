import { z } from "zod";
import { withTenant, type Tx } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { addMonthsClamped, parseDateOnly, todayInLagos } from "../dates";
import { classifyDeadline, STATE_ORDER, type DeadlineState } from "../deadlines";
import { assessmentBalance } from "../ledger-rules";
import { assertCan, type Ctx } from "./context";

// Obligations, reminders and the compliance calendar (master prompt Sections 13.2 and 13.4).
// Rates, authorities and rules are entered by the company. Nothing here knows a tax rate or a law.

export const OBLIGATION_KINDS = [
  "LAND_USE_CHARGE", "TENEMENT_RATE", "GROUND_RENT", "CONSENT_FEE", "STAMP_DUTY", "WITHHOLDING_TAX", "PERMIT", "INSURANCE", "OTHER",
] as const;

const optionalMoney = z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null));
const optionalDate = z.string().trim().optional().transform((v) => (v ? parseDateOnly(v) : null));

const obligationSchema = z.object({
  assetId: z.string().trim().optional().transform((v) => v || null),
  kind: z.enum(OBLIGATION_KINDS),
  title: z.string().trim().min(3, "Name the obligation").max(200),
  authority: z.string().trim().max(200).default(""),
  jurisdiction: z.string().trim().max(200).default(""),
  amount: optionalMoney,
  dueDate: z.string().transform((v) => parseDateOnly(v)),
  recurrenceMonths: z.string().trim().optional().transform((v, ctx): number | null => {
    if (!v) return null;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 120) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Repeat every a whole number of months between 1 and 120, or leave blank" });
      return z.NEVER;
    }
    return Number(v);
  }),
  nextReviewOn: optionalDate,
  requiresProfessionalReview: z.boolean().default(false),
  notes: z.string().trim().max(2000).default(""),
});

export async function createObligation(ctx: Ctx, input: z.input<typeof obligationSchema>) {
  assertCan(ctx, "obligation.manage");
  const data = obligationSchema.parse(input);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    if (data.assetId) {
      const asset = await tx.asset.findFirst({ where: { id: data.assetId, companyId: ctx.companyId }, select: { id: true } });
      if (!asset) throw new Error("Asset not found");
    }
    const row = await tx.obligation.create({
      data: {
        companyId: ctx.companyId, assetId: data.assetId, kind: data.kind, title: data.title, authority: data.authority,
        jurisdiction: data.jurisdiction, amountKobo: data.amount, dueDate: data.dueDate, recurrenceMonths: data.recurrenceMonths,
        nextReviewOn: data.nextReviewOn, requiresProfessionalReview: data.requiresProfessionalReview, notes: data.notes,
        createdById: ctx.userId,
      },
    });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: data.assetId ? "asset" : "company", entityId: data.assetId ?? ctx.companyId,
      action: "obligation.created", detail: { obligationId: row.id, kind: data.kind, title: data.title, due: data.dueDate.toISOString().slice(0, 10) },
    });
    return row;
  });
}

async function lockObligation(tx: Tx, id: string, companyId: string) {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM obligations WHERE id = $1 AND company_id = $2 FOR UPDATE`, id, companyId);
  if (rows.length === 0) throw new Error("Obligation not found");
}

/** Record who reviewed an obligation professionally (for example a tax adviser or lawyer). */
export async function recordProfessionalReview(ctx: Ctx, obligationId: string, input: { reviewedBy: string; reviewedOn: string }) {
  assertCan(ctx, "obligation.manage");
  const data = z.object({
    reviewedBy: z.string().trim().min(2, "Enter the name of the professional who reviewed it").max(200),
    reviewedOn: z.string().transform((v) => parseDateOnly(v)),
  }).parse(input);
  if (data.reviewedOn > todayInLagos()) throw new Error("The review date cannot be in the future");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockObligation(tx, obligationId, ctx.companyId);
    const row = await tx.obligation.findUniqueOrThrow({ where: { id: obligationId } });
    if (row.status !== "OPEN") throw new Error("This obligation is no longer open");
    await tx.obligation.update({ where: { id: obligationId }, data: { reviewedBy: data.reviewedBy, reviewedOn: data.reviewedOn } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: row.assetId ? "asset" : "company", entityId: row.assetId ?? ctx.companyId,
      action: "obligation.reviewed", detail: { obligationId, reviewedBy: data.reviewedBy },
    });
  });
}

const completionSchema = z.object({
  completedOn: z.string().transform((v) => parseDateOnly(v)),
  amountPaid: optionalMoney,
  evidence: z.string().trim().min(3, "Record the receipt or filing reference").max(500),
});

/**
 * Mark an obligation as met, with evidence. If it repeats, the next one is created in the same step so
 * a recurring duty never drops off the calendar. An item that needs professional review cannot be
 * completed until the review is recorded.
 */
export async function completeObligation(ctx: Ctx, obligationId: string, input: z.input<typeof completionSchema>) {
  assertCan(ctx, "obligation.complete");
  const data = completionSchema.parse(input);
  if (data.completedOn > todayInLagos()) throw new Error("The completion date cannot be in the future");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockObligation(tx, obligationId, ctx.companyId);
    const row = await tx.obligation.findUniqueOrThrow({ where: { id: obligationId } });
    if (row.status !== "OPEN") throw new Error("This obligation is no longer open");
    if (row.requiresProfessionalReview && (!row.reviewedBy || !row.reviewedOn)) {
      throw new Error("This obligation needs a professional review recorded before it can be completed");
    }
    await tx.obligationFiling.create({
      data: {
        companyId: ctx.companyId, obligationId, completedOn: data.completedOn, amountPaidKobo: data.amountPaid,
        evidence: data.evidence, recordedById: ctx.userId,
      },
    });
    await tx.obligation.update({ where: { id: obligationId }, data: { status: "SATISFIED" } });
    let next: { id: string; dueDate: Date } | null = null;
    if (row.recurrenceMonths) {
      next = await tx.obligation.create({
        data: {
          companyId: ctx.companyId, assetId: row.assetId, kind: row.kind, title: row.title, authority: row.authority,
          jurisdiction: row.jurisdiction, amountKobo: row.amountKobo, dueDate: addMonthsClamped(row.dueDate, row.recurrenceMonths),
          recurrenceMonths: row.recurrenceMonths,
          nextReviewOn: row.nextReviewOn ? addMonthsClamped(row.nextReviewOn, row.recurrenceMonths) : null,
          requiresProfessionalReview: row.requiresProfessionalReview, notes: row.notes, rolledFromId: row.id, createdById: ctx.userId,
        },
        select: { id: true, dueDate: true },
      });
    }
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: row.assetId ? "asset" : "company", entityId: row.assetId ?? ctx.companyId,
      action: "obligation.completed", detail: { obligationId, evidence: data.evidence, nextId: next?.id ?? null },
    });
    return next;
  });
}

export async function cancelObligation(ctx: Ctx, obligationId: string, reasonInput: string) {
  assertCan(ctx, "obligation.manage");
  const reason = z.string().trim().min(5, "Give the reason for cancelling this obligation").max(500).parse(reasonInput);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await lockObligation(tx, obligationId, ctx.companyId);
    const row = await tx.obligation.findUniqueOrThrow({ where: { id: obligationId } });
    if (row.status !== "OPEN") throw new Error("This obligation is no longer open");
    await tx.obligation.update({ where: { id: obligationId }, data: { status: "CANCELLED", cancelReason: reason } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: row.assetId ? "asset" : "company", entityId: row.assetId ?? ctx.companyId,
      action: "obligation.cancelled", detail: { obligationId, reason },
    });
  });
}

// ---------- Calendar ----------

export interface CalendarItem {
  kind: "OBLIGATION" | "LEASE_END" | "NOTICE" | "SERVICE_CHARGE" | "REVIEW";
  id: string;
  title: string;
  detail: string;
  dueDate: Date;
  href: string;
  state: DeadlineState;
  days: number;
  amountKobo: bigint | null;
}

/**
 * Everything with a deadline, in one list, classed by the company's reminder settings: open
 * obligations and their reviews, lease ends, notice dates, and service charge payments still owed.
 */
export async function complianceCalendar(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  const today = todayInLagos();
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { reminderLeadDays: true, escalationDays: true } });
    const { reminderLeadDays: lead, escalationDays: esc } = company;
    const horizon = new Date(today.getTime() + 365 * 864e5);
    const items: CalendarItem[] = [];
    const push = (it: Omit<CalendarItem, "state" | "days">) => {
      const c = classifyDeadline(it.dueDate, today, lead, esc);
      items.push({ ...it, ...c });
    };

    const obligations = await tx.obligation.findMany({
      where: { companyId: ctx.companyId, status: "OPEN" }, include: { asset: { select: { id: true, ref: true, name: true } } },
    });
    for (const o of obligations) {
      const where = o.asset ? `${o.asset.ref} · ${o.asset.name}` : "Whole portfolio";
      push({
        kind: "OBLIGATION", id: o.id, title: o.title, dueDate: o.dueDate, amountKobo: o.amountKobo, href: "/app/compliance",
        detail: `${where}${o.authority ? ` · ${o.authority}` : ""}${o.requiresProfessionalReview && !o.reviewedBy ? " · professional review needed" : ""}`,
      });
      if (o.nextReviewOn) {
        push({ kind: "REVIEW", id: `${o.id}:review`, title: `Review: ${o.title}`, dueDate: o.nextReviewOn, amountKobo: null, href: "/app/compliance", detail: where });
      }
    }

    const leases = await tx.lease.findMany({
      where: { companyId: ctx.companyId, status: "ACTIVE", endDate: { lte: horizon } },
      include: { asset: { select: { ref: true, name: true } }, notices: true, renewedTo: { select: { id: true } } },
    });
    for (const l of leases) {
      if (!l.renewedTo) {
        push({
          kind: "LEASE_END", id: l.id, title: `Lease ends: ${l.occupantName}`, dueDate: l.endDate, amountKobo: null,
          href: `/app/leases/${l.id}`, detail: `${l.ref} · ${l.asset.ref} · ${l.asset.name}${l.unit ? ` · ${l.unit}` : ""}`,
        });
      }
      for (const n of l.notices) {
        if (n.effectiveOn >= today) {
          push({
            kind: "NOTICE", id: n.id, title: `Notice takes effect: ${l.occupantName}`, dueDate: n.effectiveOn, amountKobo: null,
            href: `/app/leases/${l.id}`, detail: `${l.ref} · ${n.givenBy === "TENANT" ? "tenant" : "landlord"} notice`,
          });
        }
      }
    }

    const assessments = await tx.serviceAssessment.findMany({
      where: { companyId: ctx.companyId },
      include: { collections: { include: { reversal: true } }, lease: { select: { occupantName: true, ref: true } }, period: { select: { id: true, name: true } } },
    });
    for (const a of assessments) {
      const { outstanding } = assessmentBalance(a.amountKobo, a.collections.map((c) => ({ amountKobo: c.amountKobo, reversed: !!c.reversal })));
      if (outstanding > 0n) {
        push({
          kind: "SERVICE_CHARGE", id: a.id, title: `Service charge due: ${a.lease.occupantName}`, dueDate: a.dueDate, amountKobo: outstanding,
          href: `/app/service-charges/${a.period.id}`, detail: `${a.period.name} · ${a.lease.ref}`,
        });
      }
    }

    items.sort((x, y) => STATE_ORDER[x.state] - STATE_ORDER[y.state] || x.dueDate.getTime() - y.dueDate.getTime());
    return { items, leadDays: lead, escalationDays: esc };
  });
}

export async function listObligations(ctx: Ctx) {
  assertCan(ctx, "asset.view");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [open, closed, assets] = await Promise.all([
      tx.obligation.findMany({
        where: { companyId: ctx.companyId, status: "OPEN" }, orderBy: { dueDate: "asc" },
        include: { asset: { select: { id: true, ref: true, name: true } } },
      }),
      tx.obligation.findMany({
        where: { companyId: ctx.companyId, status: { not: "OPEN" } }, orderBy: { dueDate: "desc" }, take: 30,
        include: { asset: { select: { id: true, ref: true, name: true } }, filing: true },
      }),
      tx.asset.findMany({ where: { companyId: ctx.companyId }, select: { id: true, ref: true, name: true }, orderBy: { ref: "asc" } }),
    ]);
    return { open, closed, assets };
  });
}
