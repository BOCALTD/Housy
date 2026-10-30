/**
 * Phase 17q: offline field work. The inspector downloads their inspections, records them on the device, and sends them later.
 * A resend applies once, the office's own changes are merged rather than overwritten, the sign-in and role are checked when
 * the work arrives (not when it was downloaded), and a closed inspection is never changed.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { cancelInspection, createTemplate, getInspection, listInspections, saveInspectionRecord, scheduleInspection } from "../../src/lib/services/inspections";
import { fieldPack, submitFromDevice, syncFieldPhoto, syncFieldRecord } from "../../src/lib/services/field-kit";
import { resolveConflicts } from "../../src/lib/field-merge";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

async function setup(label: string) {
  const admin = await newCompany(label);
  const officer = await addMember(admin, "OFFICER", "foff");
  const other = await addMember(admin, "OFFICER", "foth");
  const manager = await addMember(admin, "MANAGER", "fmgr");
  const asset = await createAsset(admin, { name: `${label} block`, assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" });
  await createTemplate(admin, { name: "Field check", assetClass: "COMMERCIAL", checklist: "Roof | Gutters clear\nSecurity | Locks work\nElectrical | Board labelled" });
  const templateId = (await listInspections(admin)).templates.find((t) => t.name === "Field check")!.id;
  const ins = await scheduleInspection(admin, asset.id, { templateId, purpose: "ROUTINE", scheduledFor: relativeDate(1), inspectorId: officer.membershipId });
  return { admin, officer, other, manager, asset, ins };
}

test("a record made offline applies once, merges with office changes and asks about real clashes", async () => {
  const { officer, other, manager, ins } = await setup("field");
  const pack = await fieldPack(officer);
  const p = pack.inspections.find((x) => x.id === ins.id)!;
  assert.ok(p, "the inspection assigned to the officer is in their pack");
  assert.equal(p.items.length, 3);
  assert.equal((await fieldPack(other)).inspections.some((x) => x.id === ins.id), false, "another officer's pack does not include it");

  // Meanwhile the office records the location and a roof answer.
  const [roof, locks, board] = p.items.map((i) => i.id);
  await saveInspectionRecord(manager, ins.id, { location: "Front gate", responses: { [roof]: { result: "ATTENTION", note: "Leaves" } } });

  const base = p.record;
  const mine = { ...base, conductedOn: today(), conditionRating: "GOOD", summary: "Sound overall", responses: { ...base.responses, [roof]: { result: "FAIL", note: "Blocked" }, [locks]: { result: "PASS", note: "" }, [board]: { result: "PASS", note: "" } } };
  const clientId = randomUUID();
  const send = { clientId, inspectionId: ins.id, base, mine, findings: [{ clientId: randomUUID(), title: "Blocked gutter", severity: "MEDIUM", safetyRisk: false }] };
  const r = await syncFieldRecord(officer, send);
  assert.equal(r.outcome, "conflicts");
  if (r.outcome === "closed") throw new Error("unexpected");
  assert.deepEqual(r.conflicts.map((c) => c.key), [`item:${roof}`]);
  assert.equal(r.conflicts[0].office, "Needs attention: Leaves");
  const findingId = Object.values(r.findings)[0];
  assert.ok(findingId);

  const full = (await getInspection(manager, ins.id))!.inspection;
  assert.equal(full.location, "Front gate", "the office's change stays");
  assert.equal(full.summary, "Sound overall", "the officer's change applies");
  assert.equal(full.responses.find((x) => x.id === roof)!.result, "ATTENTION", "the clash keeps the office value until the officer decides");
  assert.equal(full.responses.find((x) => x.id === locks)!.result, "PASS");

  // The same send again (a retry after a dropped connection) changes nothing and creates no second finding.
  const again = await syncFieldRecord(officer, send);
  assert.deepEqual(again, r);
  const findings = await withTenant(officer.companyId, officer.userId, (tx) => tx.inspectionFinding.count({ where: { inspectionId: ins.id } }));
  assert.equal(findings, 1);

  // The officer chooses their own roof answer; sent against the office copy, it applies cleanly.
  const chosen = resolveConflicts(r.record, mine, [`item:${roof}`]);
  const r2 = await syncFieldRecord(officer, { clientId: randomUUID(), inspectionId: ins.id, base: r.record, mine: chosen, findings: [] });
  assert.equal(r2.outcome, "applied");
  const after2 = (await getInspection(manager, ins.id))!.inspection;
  assert.equal(after2.responses.find((x) => x.id === roof)!.note, "Blocked");

  // A photo of the new defect, sent twice, is stored once.
  const ph = { clientId: randomUUID(), inspectionId: ins.id, findingId, caption: "Gutter" };
  const p1 = await syncFieldPhoto(officer, ph, { name: "g.png", type: "image/png", bytes: PNG });
  const p2 = await syncFieldPhoto(officer, ph, { name: "g.png", type: "image/png", bytes: PNG });
  assert.equal(p1.outcome, "saved");
  assert.deepEqual(p2, p1);
  const photos = await withTenant(officer.companyId, officer.userId, (tx) => tx.evidencePhoto.count({ where: { subjectType: "inspection_finding", subjectId: findingId } }));
  assert.equal(photos, 1);

  // Permissions are checked when the work arrives.
  await assert.rejects(syncFieldRecord(other, { clientId: randomUUID(), inspectionId: ins.id, base: r.record, mine: chosen, findings: [] }), /assigned inspector/);
  const viewer = await addMember(manager, "VIEWER", "fview");
  await assert.rejects(syncFieldRecord(viewer, { clientId: randomUUID(), inspectionId: ins.id, base: r.record, mine: chosen, findings: [] }), /permission/i);
  await assert.rejects(syncFieldRecord(officer, { clientId: "x", inspectionId: ins.id, base: r.record, mine: chosen }), /device/);

  assert.equal((await submitFromDevice(officer, ins.id)).outcome, "submitted");
  assert.equal((await submitFromDevice(officer, ins.id)).outcome, "already");
});

test("work sent for an inspection the office has closed changes nothing", async () => {
  const { admin, officer, ins } = await setup("fclose");
  const p = (await fieldPack(officer)).inspections.find((x) => x.id === ins.id)!;
  await cancelInspection(admin, ins.id, "Tenant asked to reschedule");
  const r = await syncFieldRecord(officer, { clientId: randomUUID(), inspectionId: ins.id, base: p.record, mine: { ...p.record, summary: "Done anyway" }, findings: [] });
  assert.deepEqual(r, { outcome: "closed", status: "CANCELLED" });
  assert.equal((await getInspection(admin, ins.id))!.inspection.summary, "");
});
