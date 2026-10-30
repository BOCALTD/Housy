import { withTenant } from "../db";
import { logActivity } from "../audit";
import { assertCan, type Ctx } from "./context";
import { checkChoices, templateFor, type IndustryKey } from "../industry-templates";
import { addCommissionRule } from "./commission";
import { createObligation } from "./obligations";
import { todayInLagos, toDateOnlyString } from "../dates";
import { can } from "../permissions";

export type Choices = {
  departments: string[];            // codes
  checklists: string[];             // names
  obligations: Record<string, string>; // id -> first due date
  commission: Record<string, string>;  // id -> percentage
  reminders: boolean;
};

/** What the company already has, so the preview can mark what applying would add and what is already there. */
export async function setupState(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [company, departments, checklists, rules, obligations] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { industryTemplate: true, reminderLeadDays: true, escalationDays: true } }),
      tx.department.findMany({ where: { companyId: ctx.companyId }, select: { code: true } }),
      tx.inspectionTemplate.findMany({ where: { companyId: ctx.companyId }, select: { name: true } }),
      tx.commissionRule.findMany({ where: { companyId: ctx.companyId }, select: { name: true } }),
      tx.obligation.findMany({ where: { companyId: ctx.companyId, assetId: null }, select: { title: true } }),
    ]);
    return {
      current: company.industryTemplate as IndustryKey | "",
      reminders: { leadDays: company.reminderLeadDays, escalationDays: company.escalationDays },
      has: { departments: new Set(departments.map((d) => d.code)), checklists: new Set(checklists.map((c) => c.name)), rules: new Set(rules.map((r) => r.name)), obligations: new Set(obligations.map((o) => o.title)) },
    };
  });
}

/**
 * Apply the parts of a template the administrator ticked. Only what is missing is added (a department code, checklist, rule or
 * obligation that already exists is left as it is), every date and rate comes from the administrator, and the whole set-up is
 * recorded in the activity log.
 */
export async function applyIndustryTemplate(ctx: Ctx, key: string, c: Choices) {
  assertCan(ctx, "settings.manage");
  const t = templateFor(key);
  if (!t) throw new Error("Choose a kind of business");
  const problems = checkChoices(t, c, toDateOnlyString(todayInLagos()));
  if (problems.length) throw new Error(problems.join(". "));
  const state = await setupState(ctx);
  const added = { departments: 0, checklists: 0, obligations: 0, rules: 0, reminders: false };

  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    for (const d of t.departments.filter((x) => c.departments.includes(x.code) && !state.has.departments.has(x.code))) {
      await tx.department.create({ data: { companyId: ctx.companyId, name: d.name, code: d.code } });
      added.departments += 1;
    }
    for (const k of t.checklists.filter((x) => c.checklists.includes(x.name) && !state.has.checklists.has(x.name))) {
      const row = await tx.inspectionTemplate.create({ data: { companyId: ctx.companyId, name: k.name, assetClass: k.assetClass, createdById: ctx.userId } });
      await tx.inspectionTemplateItem.createMany({ data: k.items.map((it, i) => ({ companyId: ctx.companyId, templateId: row.id, category: it.category, prompt: it.prompt, sortOrder: i + 1 })) });
      added.checklists += 1;
    }
    if (c.reminders) {
      await tx.company.update({ where: { id: ctx.companyId }, data: { reminderLeadDays: t.reminders.leadDays, escalationDays: t.reminders.escalationDays } });
      added.reminders = true;
    }
    await tx.company.update({ where: { id: ctx.companyId }, data: { industryTemplate: t.key } });
  });
  // Obligations and commission rules go through their own services, with their own checks and permissions.
  for (const [id, date] of Object.entries(c.obligations)) {
    const o = t.obligations.find((x) => x.id === id)!;
    if (state.has.obligations.has(o.title) || !can(ctx.role, "obligation.manage")) continue;
    await createObligation(ctx, { kind: o.kind, title: o.title, authority: o.authority, dueDate: date, recurrenceMonths: o.months ? String(o.months) : "", requiresProfessionalReview: o.review, notes: `${o.why} Added from the ${t.name.toLowerCase()} template; enter the amount when it is assessed.` } as never);
    added.obligations += 1;
  }
  for (const [id, rate] of Object.entries(c.commission)) {
    const r = t.commission.find((x) => x.id === id)!;
    if (state.has.rules.has(r.name) || !can(ctx.role, "crm.configure")) continue;
    await addCommissionRule(ctx, { name: r.name, applies: r.applies, method: "PERCENT", rate });
    added.rules += 1;
  }
  await withTenant(ctx.companyId, ctx.userId, (tx) => logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "settings.industry_template_applied", detail: { template: t.key, ...added } }));
  return added;
}

/** The first steps for the company's template, for the dashboard. */
export async function companyTemplate(ctx: Ctx) {
  const row = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { industryTemplate: true } }));
  return templateFor(row.industryTemplate);
}
