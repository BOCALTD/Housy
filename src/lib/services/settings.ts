import { z } from "zod";
import { withTenant } from "../db";
import { logActivity } from "../audit";
import { cleanCode } from "../correspondence-rules";
import { assertCan, type Ctx } from "./context";

export async function getSettings(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, async (tx) => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { name: true, refPrefix: true, reminderLeadDays: true, escalationDays: true } }),
    departments: await tx.department.findMany({
      where: { companyId: ctx.companyId }, orderBy: { name: "asc" },
      include: { _count: { select: { members: true } } },
    }),
  }));
}

export async function listDepartments(ctx: Ctx) {
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.department.findMany({ where: { companyId: ctx.companyId }, orderBy: { name: "asc" } }));
}

export async function updateRefPrefix(ctx: Ctx, prefix: string) {
  assertCan(ctx, "settings.manage");
  const clean = cleanCode(prefix);
  if (clean.length < 2) throw new Error("Use a prefix of 2 to 8 letters or digits, for example ALP");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const before = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { refPrefix: true } });
    await tx.company.update({ where: { id: ctx.companyId }, data: { refPrefix: clean } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId,
      action: "settings.ref_prefix_changed", detail: { from: before.refPrefix, to: clean },
    });
  });
}

const deptSchema = z.object({
  name: z.string().trim().min(2, "Enter the department name").max(80),
  code: z.string().transform(cleanCode).refine((v) => v.length >= 2, "Use a code of 2 to 8 letters or digits, for example LEG"),
});

export async function addDepartment(ctx: Ctx, input: z.input<typeof deptSchema>) {
  assertCan(ctx, "settings.manage");
  const data = deptSchema.parse(input);
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const dept = await tx.department.create({ data: { companyId: ctx.companyId, name: data.name, code: data.code } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "department", entityId: dept.id,
      action: "department.created", detail: { name: data.name, code: data.code },
    });
  });
}

export async function setMemberDepartment(ctx: Ctx, membershipId: string, departmentId: string | null) {
  assertCan(ctx, "settings.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const m = await tx.membership.findFirst({ where: { id: membershipId, companyId: ctx.companyId } });
    if (!m) throw new Error("That member was not found.");
    if (departmentId) {
      const d = await tx.department.findFirst({ where: { id: departmentId, companyId: ctx.companyId } });
      if (!d) throw new Error("That department was not found.");
    }
    await tx.membership.update({ where: { id: m.id }, data: { departmentId } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "membership", entityId: m.id,
      action: "member.department_changed", detail: { from: m.departmentId, to: departmentId },
    });
  });
}

const reminderSchema = z.object({
  leadDays: z.string().trim().regex(/^\d{1,3}$/, "Enter the reminder lead time as a whole number of days"),
  escalationDays: z.string().trim().regex(/^\d{1,2}$/, "Enter the escalation time as a whole number of days"),
});

/** How early deadlines show as due soon, and how late before they are escalated (master prompt Section 13.4). */
export async function updateReminderSettings(ctx: Ctx, input: z.input<typeof reminderSchema>) {
  assertCan(ctx, "settings.manage");
  const data = reminderSchema.parse(input);
  const leadDays = Number(data.leadDays);
  const escalationDays = Number(data.escalationDays);
  if (leadDays < 1 || leadDays > 365) throw new Error("The reminder lead time must be between 1 and 365 days");
  if (escalationDays < 1 || escalationDays > 90) throw new Error("The escalation time must be between 1 and 90 days");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const before = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { reminderLeadDays: true, escalationDays: true } });
    await tx.company.update({ where: { id: ctx.companyId }, data: { reminderLeadDays: leadDays, escalationDays } });
    await logActivity(tx, {
      companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId,
      action: "settings.reminders_changed", detail: { from: before, to: { reminderLeadDays: leadDays, escalationDays } },
    });
  });
}
