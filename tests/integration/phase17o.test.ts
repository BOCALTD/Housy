/**
 * Phase 17o: industry templates. The administrator sees what a template adds, keeps only what they tick, enters their own dates
 * and rates, and applying again adds only what is missing. Only the company's top administrator can apply one.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { applyIndustryTemplate, companyTemplate, setupState } from "../../src/lib/services/industry-setup";
import { addDepartment } from "../../src/lib/services/settings";
import { addMember, newCompany } from "./helpers";

after(() => prisma.$disconnect());
const inDays = (n: number) => new Date(Date.now() + (n + 1) * 864e5).toISOString().slice(0, 10);

test("a letting agency set-up adds what was ticked, with the administrator's dates and rates, and only once", async () => {
  const co = await newCompany("tpl");
  await addDepartment(co, { name: "Legal team", code: "LEG" });
  const manager = await addMember(co, "MANAGER", "tplm");
  const choice = { departments: ["LET", "PM", "LEG"], checklists: ["Move-in inspection", "Move-out inspection"], obligations: { insurance: inDays(40) }, commission: { letting: "7.5" }, reminders: true };
  await assert.rejects(applyIndustryTemplate(manager, "LETTING", choice), /permission/i);
  await assert.rejects(applyIndustryTemplate(co, "LETTING", { ...choice, obligations: { insurance: "" } }), /next due/);
  await assert.rejects(applyIndustryTemplate(co, "NOPE", choice), /kind of business/);

  const r = await applyIndustryTemplate(co, "LETTING", choice);
  assert.deepEqual(r, { departments: 2, checklists: 2, obligations: 1, rules: 1, reminders: true }, "LEG already existed, so it is not added again");
  const db = await withTenant(co.companyId, co.userId, async (tx) => ({
    company: await tx.company.findUniqueOrThrow({ where: { id: co.companyId } }),
    deps: await tx.department.findMany({ where: { companyId: co.companyId } }),
    legal: await tx.department.findFirstOrThrow({ where: { companyId: co.companyId, code: "LEG" } }),
    lists: await tx.inspectionTemplate.findMany({ where: { companyId: co.companyId }, include: { items: true } }),
    obligation: await tx.obligation.findFirstOrThrow({ where: { companyId: co.companyId, title: "Building insurance renewal" } }),
    rule: await tx.commissionRule.findFirstOrThrow({ where: { companyId: co.companyId, name: "Letting fee" } }),
  }));
  assert.equal(db.company.industryTemplate, "LETTING");
  assert.equal(db.company.reminderLeadDays, 30);
  assert.equal(db.legal.name, "Legal team", "an existing department is left as it was");
  assert.equal(db.deps.length, 3);
  assert.ok(db.lists.find((l) => l.name === "Move-in inspection")!.items.length >= 8);
  assert.equal(db.obligation.dueDate.toISOString().slice(0, 10), inDays(40));
  assert.equal(db.obligation.recurrenceMonths, 12);
  assert.equal(db.obligation.amountKobo, null, "no amount is invented");
  assert.equal(db.rule.rateBps, 750);
  assert.equal((await companyTemplate(co))?.key, "LETTING");

  // Applying again adds nothing that is already there.
  const again = await applyIndustryTemplate(co, "LETTING", { ...choice, obligations: {}, commission: {}, reminders: false });
  assert.deepEqual(again, { departments: 0, checklists: 0, obligations: 0, rules: 0, reminders: false });
  const st = await setupState(co);
  assert.ok(st.has.checklists.has("Move-in inspection") && st.has.rules.has("Letting fee"));
});
