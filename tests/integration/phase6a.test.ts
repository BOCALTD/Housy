/**
 * Phase 6a: inspections against a real PostgreSQL database through the runtime role.
 * Templates, scheduling, recording, findings, photographs, second-person approval, recurrence,
 * condition history and company isolation.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import {
  addFinding, addInspectionPhoto, cancelInspection, conditionHistory, createTemplate, decideInspection, getInspection,
  installStarterTemplates, listInspections, saveInspectionRecord, scheduleInspection, setTemplateActive, submitInspection,
} from "../../src/lib/services/inspections";
import { getPhotoForDownload } from "../../src/lib/services/photos";
import { addMonthsClamped, parseDateOnly } from "../../src/lib/dates";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"));

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "off");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const asset = await createAsset(admin, { name: `${label} building`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  await createTemplate(admin, { name: "Quick check", assetClass: "COMMERCIAL", checklist: "Roof | Gutters clear\nSecurity | Locks work\nElectrical | Board labelled" });
  const templateId = (await listInspections(admin)).templates[0].id;
  return { admin, officer, manager, asset, templateId };
}

const answers = async (ctx: Awaited<ReturnType<typeof newCompany>>, id: string, result: "PASS" | "FAIL" = "PASS") => {
  const r = (await getInspection(ctx, id))!.inspection.responses;
  return Object.fromEntries(r.map((x) => [x.id, { result, note: result === "FAIL" ? "Defective" : "" }]));
};

test("a checklist is copied into the inspection and later template changes do not alter it", async () => {
  const { admin, officer, asset, templateId } = await setup("tmpl");
  await assert.rejects(createTemplate(officer, { name: "Mine", checklist: "A | Some check" }), /permission/i);
  await assert.rejects(createTemplate(admin, { name: "Quick check", checklist: "A | Some check" }), /already exists/);
  await assert.rejects(createTemplate(admin, { name: "Empty", checklist: "  " }), /at least one/);
  assert.equal(await installStarterTemplates(admin), 6);
  assert.equal(await installStarterTemplates(admin), 0);

  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(3), inspectorId: officer.membershipId });
  assert.match(ins.ref, /^INS-\d{4}-0001$/);
  const second = await scheduleInspection(admin, asset.id, { purpose: "ROUTINE", scheduledFor: relativeDate(4) });
  assert.match(second.ref, /-0002$/);
  assert.equal((await getInspection(admin, ins.id))!.inspection.responses.length, 3);
  assert.equal((await getInspection(admin, second.id))!.inspection.responses.length, 0);

  await setTemplateActive(admin, templateId, false);
  await assert.rejects(scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(3) }), /switched off/);
  assert.equal((await getInspection(admin, ins.id))!.inspection.responses.length, 3);
  await assert.rejects(scheduleInspection(admin, asset.id, { purpose: "ROUTINE", scheduledFor: relativeDate(3), inspectorId: "not-a-member" }), /active member/);
});

test("only the assigned inspector or a manager records, and submission needs a complete record", async () => {
  const { admin, officer, manager, asset, templateId } = await setup("record");
  const other = await addMember(admin, "OFFICER", "other");
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-1), inspectorId: officer.membershipId });

  await assert.rejects(saveInspectionRecord(other, ins.id, { conductedOn: relativeDate(0) }), /assigned inspector or a manager/);
  await assert.rejects(saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(2) }), /future/);
  await assert.rejects(saveInspectionRecord(officer, ins.id, { responses: { "nope": { result: "PASS", note: "" } } }), /does not belong/);
  await assert.rejects(submitInspection(officer, ins.id), /date the inspection was carried out/);

  await saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(0), conditionRating: "GOOD", summary: "All fine here" });
  await assert.rejects(submitInspection(officer, ins.id), /every checklist item/);
  await saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(0), conditionRating: "GOOD", summary: "All fine here", responses: await answers(officer, ins.id) });
  await assert.rejects(submitInspection(other, ins.id), /assigned inspector or a manager/);
  await submitInspection(manager, ins.id);
  const saved = (await getInspection(admin, ins.id))!.inspection;
  assert.equal(saved.status, "SUBMITTED");
  await assert.rejects(saveInspectionRecord(officer, ins.id, { summary: "Changed after submit" }), /can no longer be edited/);
  await assert.rejects(addFinding(officer, ins.id, { title: "Late finding", severity: "LOW" }), /can no longer be edited/);
  await assert.rejects(submitInspection(officer, ins.id), /already been submitted/);
});

test("approval needs a third person, can be returned, and repeats on schedule", async () => {
  const { admin, officer, manager, asset, templateId } = await setup("approve");
  const ins = await scheduleInspection(admin, asset.id, {
    templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-1), inspectorId: officer.membershipId, recurrenceMonths: "6",
  });
  await saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(-1), conditionRating: "FAIR", summary: "Minor items", responses: await answers(officer, ins.id) });
  await submitInspection(officer, ins.id);

  await assert.rejects(decideInspection(officer, ins.id, "approve", ""), /permission/i);
  // A manager who submits cannot approve their own submission.
  const ins2 = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-1), inspectorId: officer.membershipId });
  await saveInspectionRecord(manager, ins2.id, { conductedOn: relativeDate(-1), conditionRating: "GOOD", summary: "Fine overall", responses: await answers(manager, ins2.id) });
  await submitInspection(manager, ins2.id);
  await assert.rejects(decideInspection(manager, ins2.id, "approve", ""), /someone other than/);
  await decideInspection(admin, ins2.id, "approve", "");

  await assert.rejects(decideInspection(admin, ins.id, "return", "no"), /what needs correcting/i);
  await decideInspection(admin, ins.id, "return", "Add a note on the roof");
  let row = (await getInspection(admin, ins.id))!.inspection;
  assert.equal(row.status, "SCHEDULED");
  assert.equal(row.returnNote, "Add a note on the roof");
  await submitInspection(officer, ins.id);
  const next = await decideInspection(manager, ins.id, "approve", "");
  assert.ok(next);
  assert.match(next.ref, /^INS-\d{4}-\d{4}$/);
  await assert.rejects(decideInspection(manager, ins.id, "approve", ""), /Only a submitted/);

  row = (await getInspection(admin, ins.id))!.inspection;
  assert.equal(row.status, "APPROVED");
  assert.equal(row.rolledTo?.id, next.id);
  const follow = (await getInspection(admin, next.id))!.inspection;
  assert.equal(follow.scheduledFor.getTime(), addMonthsClamped(parseDateOnly(relativeDate(-1)), 6).getTime());
  assert.equal(follow.responses.length, 3);
  assert.equal(follow.inspectorId, officer.membershipId);
  assert.equal(follow.recurrenceMonths, 6);
  assert.equal(follow.status, "SCHEDULED");
});

test("approving the same inspection at once schedules only one follow-up", async () => {
  const { admin, officer, manager, asset, templateId } = await setup("approverace");
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-1), inspectorId: officer.membershipId, recurrenceMonths: "3" });
  await saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(-1), conditionRating: "GOOD", summary: "Fine overall", responses: await answers(officer, ins.id) });
  await submitInspection(officer, ins.id);
  const results = await Promise.allSettled([decideInspection(admin, ins.id, "approve", ""), decideInspection(manager, ins.id, "approve", ""), decideInspection(admin, ins.id, "approve", "")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const followUps = await withTenant(admin.companyId, admin.userId, (tx) => tx.inspection.count({ where: { rolledFromId: ins.id } }));
  assert.equal(followUps, 1);
});

test("findings and photographs are recorded, validated and kept", async () => {
  const { admin, officer, asset, templateId } = await setup("photo");
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(-1), inspectorId: officer.membershipId });
  const finding = await addFinding(officer, ins.id, { title: "Cracked step", severity: "HIGH", estimatedCost: "75,000", safetyRisk: true, recommendedAction: "Repair" },
    { name: "step.png", type: "image/png", bytes: PNG, phase: "BEFORE", caption: "Before repair" });
  await assert.rejects(addFinding(officer, ins.id, { title: "x", severity: "LOW" }), /Name the defect/);
  await assert.rejects(addInspectionPhoto(officer, ins.id, finding.id, {}, { name: "a.pdf", type: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]) }), /JPG, PNG or WEBP/);
  await assert.rejects(addInspectionPhoto(officer, ins.id, finding.id, {}, { name: "a.png", type: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) }), /do not match/);
  await assert.rejects(addInspectionPhoto(officer, ins.id, "missing", {}, { name: "a.png", type: "image/png", bytes: PNG }), /Finding not found/);
  const extra = await addInspectionPhoto(officer, ins.id, null, { phase: "EVIDENCE", caption: "Front view" }, { name: "front.png", type: "image/png", bytes: PNG });

  const data = (await getInspection(admin, ins.id))!;
  assert.equal(data.inspection.findings.length, 1);
  assert.equal(data.photos.length, 2);
  assert.equal(data.photos.find((p) => p.subjectId === finding.id)?.phase, "BEFORE");
  const dl = await getPhotoForDownload(admin, extra.id);
  assert.deepEqual(Array.from(dl!.bytes), Array.from(PNG));
  // Photograph records cannot be edited by the runtime role.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) => tx.evidencePhoto.update({ where: { id: extra.id }, data: { caption: "changed" } })));
});

test("condition history lists approved inspections and shows the change", async () => {
  const { admin, officer, manager, asset, templateId } = await setup("history");
  for (const [days, rating] of [[-60, "GOOD"], [-30, "POOR"]] as const) {
    const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "CONDITION_SURVEY", scheduledFor: relativeDate(days), inspectorId: officer.membershipId });
    await saveInspectionRecord(officer, ins.id, {
      conductedOn: relativeDate(days), conditionRating: rating, summary: "Survey recorded", responses: await answers(officer, ins.id, rating === "POOR" ? "FAIL" : "PASS"),
    });
    await submitInspection(officer, ins.id);
    await decideInspection(manager, ins.id, "approve", "");
  }
  const h = await conditionHistory(admin, asset.id);
  assert.deepEqual(h.map((x) => x.rating), ["GOOD", "POOR"]);
  assert.equal(h[0].change, null);
  assert.equal(h[1].change, 2);
});

test("a scheduled inspection can be cancelled once, and an inconsistent record is flagged", async () => {
  const { admin, officer, asset, templateId } = await setup("cancel");
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(5), inspectorId: officer.membershipId });
  await assert.rejects(cancelInspection(officer, ins.id, "Not needed"), /permission/i);
  await assert.rejects(cancelInspection(admin, ins.id, "no"), /reason/);
  await saveInspectionRecord(officer, ins.id, { conductedOn: relativeDate(0), conditionRating: "EXCELLENT", summary: "Looks fine", responses: await answers(officer, ins.id, "FAIL") });
  assert.ok((await getInspection(admin, ins.id))!.warnings.some((w) => /although 3 checklist items failed/.test(w)));
  await cancelInspection(admin, ins.id, "Tenant moved out");
  await assert.rejects(cancelInspection(admin, ins.id, "Again please"), /Only a scheduled/);
  const list = await listInspections(admin);
  assert.equal(list.scheduled.length + list.overdue.length, 0);
});

test("inspections are private to the company", async () => {
  const a = await setup("isoa");
  const b = await newCompany("isob");
  const ins = await scheduleInspection(a.admin, a.asset.id, { templateId: a.templateId, purpose: "ROUTINE", scheduledFor: relativeDate(1) });
  assert.equal(await getInspection(b, ins.id), null);
  await assert.rejects(scheduleInspection(b, a.asset.id, { purpose: "ROUTINE", scheduledFor: relativeDate(1) }), /not found/i);
  await assert.rejects(scheduleInspection(b, (await createAsset(b, { name: "Beta land", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" })).id, { templateId: a.templateId, purpose: "ROUTINE", scheduledFor: relativeDate(1) }), /Template not found/);
  await assert.rejects(saveInspectionRecord(b, ins.id, { summary: "Mine now" }), /not found/i);
  await assert.rejects(cancelInspection(b, ins.id, "Not yours to cancel"), /not found/i);
  assert.equal((await listInspections(b)).templates.length, 0);
  await addFinding(a.admin, ins.id, { title: "Leaking pipe", severity: "LOW" }, { name: "p.png", type: "image/png", bytes: PNG });
  const pid = (await getInspection(a.admin, ins.id))!.photos[0].id;
  assert.equal(await getPhotoForDownload(b, pid), null);
});
