/**
 * Phase 4 (master prompt Section 50, acceptance criteria): a company can register an incoming letter,
 * assign it, track a response deadline, attach supporting documents, approve a reply and close the record
 * with a complete audit history. Runs against a real database through the restricted runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { inviteMember, acceptInvitation } from "../../src/lib/services/companies";
import { createAsset } from "../../src/lib/services/assets";
import { addDepartment, listDepartments, updateRefPrefix, setMemberDepartment } from "../../src/lib/services/settings";
import {
  registerCorrespondence, actOnCorrespondence, getCorrespondence, listCorrespondence, correspondenceSummary,
  addCorrespondenceNote, getCorrespondenceAttachment,
} from "../../src/lib/services/correspondence";
import {
  createPhysicalFile, issuePhysicalFile, returnPhysicalFile, listPhysicalFiles, fileMovements,
} from "../../src/lib/services/files";
import { rateLimit } from "../../src/lib/ratelimit";
import { newCompany, withRole, PDF_BYTES, PASSWORD } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

async function addMember(admin: Ctx, role: "MANAGER" | "OFFICER" | "VIEWER", name: string): Promise<Ctx> {
  const token = await inviteMember(admin, { email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, role });
  const { userId } = await acceptInvitation(token, { name, password: PASSWORD });
  const m = await withTenant(admin.companyId, userId, (tx) => tx.membership.findFirstOrThrow({ where: { companyId: admin.companyId, userId } }));
  return { userId, companyId: admin.companyId, membershipId: m.id, role };
}

test("an incoming letter goes from registration to a closed record with a full history", async () => {
  const admin = await newCompany("corr");
  const manager = await addMember(admin, "MANAGER", "Mariam");
  const officer = await addMember(admin, "OFFICER", "Obi");

  await updateRefPrefix(admin, "alp");
  await addDepartment(admin, { name: "Legal", code: "leg" });
  const legal = (await listDepartments(admin)).find((d) => d.code === "LEG")!;
  await setMemberDepartment(admin, officer.membershipId, legal.id);
  const asset = await createAsset(admin, { name: "Plot 12", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" });

  const year = new Date().getUTCFullYear();
  const letter = await registerCorrespondence(officer, {
    direction: "INCOMING", subject: "Notice of rent review", senderName: "Lagos State Lands Bureau", recipientName: "Test corr",
    dateReceived: "2026-10-01", responseDeadline: "2026-10-05", departmentId: legal.id, assetId: asset.id, category: "Government and regulatory",
  }, { name: "notice.pdf", type: "application/pdf", bytes: PDF_BYTES });
  assert.match(letter.ref, new RegExp(`^ALP/LEG/(${year}|${year + 1})/0001$`));
  assert.equal(letter.status, "REGISTERED");

  const second = await registerCorrespondence(officer, {
    direction: "INCOMING", subject: "Second", senderName: "Tenant", recipientName: "Us", dateReceived: "2026-10-02",
  });
  assert.match(second.ref, /^ALP\/\d{4}\/0002$/, "the sequence continues and the department part is optional");

  // Officers cannot assign; managers can. Deadline passed, so it shows as overdue.
  await assert.rejects(actOnCorrespondence(officer, letter.id, "assign", { expectedStatus: "REGISTERED", assigneeId: officer.membershipId }), /manager/);
  await actOnCorrespondence(manager, letter.id, "assign", { expectedStatus: "REGISTERED", assigneeId: officer.membershipId });
  assert.ok((await listCorrespondence(officer, { view: "overdue" })).some((c) => c.id === letter.id));
  assert.ok((await correspondenceSummary(officer)).mine >= 1);

  // A stale form is refused instead of silently overwriting someone else's change.
  await assert.rejects(actOnCorrespondence(officer, letter.id, "start_review", { expectedStatus: "REGISTERED" }), /Someone else updated/);
  await actOnCorrespondence(officer, letter.id, "start_review", { expectedStatus: "ASSIGNED" });
  await assert.rejects(actOnCorrespondence(officer, letter.id, "dispatch", { expectedStatus: "UNDER_REVIEW", dispatchMethod: "Email" }), /cannot be moved/);
  await actOnCorrespondence(officer, letter.id, "require_response", { expectedStatus: "UNDER_REVIEW", requiredAction: "Object to the proposed increase", responseDeadline: "2027-01-31" });
  await actOnCorrespondence(officer, letter.id, "save_draft", { expectedStatus: "RESPONSE_REQUIRED", draftResponse: "We acknowledge your notice and object to the proposed review." });
  await actOnCorrespondence(officer, letter.id, "submit_for_approval", { expectedStatus: "DRAFT_RESPONSE" });

  // Approval: officers cannot approve, and the drafter can never approve their own response.
  await assert.rejects(actOnCorrespondence(officer, letter.id, "approve", { expectedStatus: "AWAITING_APPROVAL" }), /manager/);
  await assert.rejects(actOnCorrespondence(manager, letter.id, "return_to_draft", { expectedStatus: "AWAITING_APPROVAL", note: "" }), /what needs to change/);
  await actOnCorrespondence(manager, letter.id, "return_to_draft", { expectedStatus: "AWAITING_APPROVAL", note: "Cite clause 4.2 of the lease" });
  await actOnCorrespondence(officer, letter.id, "submit_for_approval", { expectedStatus: "DRAFT_RESPONSE", draftResponse: "We object to the proposed review under clause 4.2 of the lease." });
  await actOnCorrespondence(manager, letter.id, "approve", { expectedStatus: "AWAITING_APPROVAL" });
  await actOnCorrespondence(officer, letter.id, "dispatch", { expectedStatus: "APPROVED", dispatchMethod: "Courier", dispatchedOn: "2026-10-06" });
  await actOnCorrespondence(officer, letter.id, "await_reply", { expectedStatus: "SENT" });
  await assert.rejects(actOnCorrespondence(officer, letter.id, "close", { expectedStatus: "AWAITING_REPLY", note: "" }), /resolved/);
  await addCorrespondenceNote(officer, letter.id, "Called the Bureau, reply expected next week");
  await actOnCorrespondence(officer, letter.id, "close", { expectedStatus: "AWAITING_REPLY", note: "Bureau withdrew the review in writing" });

  const full = await getCorrespondence(admin, letter.id);
  assert.ok(full);
  assert.equal(full.rec.status, "CLOSED");
  assert.equal(full.rec.approvedById, manager.userId);
  assert.equal(full.rec.dispatchMethod, "Courier");
  const kinds = full.rec.actions.map((a) => a.kind);
  for (const k of ["REGISTERED", "ASSIGN", "START_REVIEW", "REQUIRE_RESPONSE", "SAVE_DRAFT", "SUBMIT_FOR_APPROVAL", "RETURN_TO_DRAFT", "APPROVE", "DISPATCH", "AWAIT_REPLY", "NOTE", "CLOSE"]) {
    assert.ok(kinds.includes(k), `history should include ${k}`);
  }
  assert.equal(full.rec.attachments.length, 1);
  assert.ok(await getCorrespondenceAttachment(officer, full.rec.attachments[0].id));

  // The history cannot be edited by the application.
  await assert.rejects(withTenant(admin.companyId, admin.userId, (tx) =>
    tx.correspondenceAction.updateMany({ where: { correspondenceId: letter.id }, data: { note: "tampered" } })));
});

test("an outgoing letter needs approval from someone other than its author", async () => {
  const admin = await newCompany("outgoing");
  const manager = await addMember(admin, "MANAGER", "Musa");
  const letter = await registerCorrespondence(manager, {
    direction: "OUTGOING", subject: "Notice to tenant", senderName: "Us", recipientName: "Corner Pharmacy Ltd",
    draftResponse: "Please note that the service charge for the next quarter is now due.",
  });
  assert.equal(letter.status, "DRAFT_RESPONSE");
  await actOnCorrespondence(manager, letter.id, "submit_for_approval", { expectedStatus: "DRAFT_RESPONSE" });
  await assert.rejects(actOnCorrespondence(manager, letter.id, "approve", { expectedStatus: "AWAITING_APPROVAL" }), /Someone other than the person who drafted/);
  await actOnCorrespondence(admin, letter.id, "approve", { expectedStatus: "AWAITING_APPROVAL" });
  await assert.rejects(actOnCorrespondence(manager, letter.id, "dispatch", { expectedStatus: "APPROVED", dispatchMethod: "Email", dispatchedOn: "2999-01-01" }), /future/);
});

test("confidential correspondence is hidden from staff who are not involved", async () => {
  const admin = await newCompany("confidential");
  const officerA = await addMember(admin, "OFFICER", "Ada");
  const officerB = await addMember(admin, "OFFICER", "Bola");
  const viewer = await addMember(admin, "VIEWER", "Vic");
  const secret = await registerCorrespondence(officerA, {
    direction: "INCOMING", subject: "Acquisition negotiation", senderName: "Seller's lawyer", recipientName: "Us",
    dateReceived: "2026-10-01", confidential: true,
  }, { name: "offer.pdf", type: "application/pdf", bytes: PDF_BYTES });
  const full = await getCorrespondence(officerA, secret.id);
  assert.ok(full, "the person who registered it can see it");
  assert.equal(await getCorrespondence(officerB, secret.id), null, "another officer cannot");
  assert.equal(await getCorrespondence(viewer, secret.id), null, "a viewer cannot");
  assert.ok(!(await listCorrespondence(officerB)).some((c) => c.id === secret.id));
  assert.equal(await getCorrespondenceAttachment(officerB, full.rec.attachments[0].id), null, "nor download its attachment");
  await assert.rejects(addCorrespondenceNote(officerB, secret.id, "peek"), /not found/);
  assert.ok(await getCorrespondence(admin, secret.id), "managers and admins can");
  await assert.rejects(registerCorrespondence(viewer, { direction: "INCOMING", subject: "x letter", senderName: "a b", recipientName: "c d", dateReceived: "2026-10-01" }), /permission/);
});

test("another company cannot see or act on correspondence or files", async () => {
  const alpha = await newCompany("iso-a");
  const beta = await newCompany("iso-b");
  const letter = await registerCorrespondence(alpha, { direction: "INCOMING", subject: "Private letter", senderName: "Owner", recipientName: "Alpha", dateReceived: "2026-10-01" });
  const file = await createPhysicalFile(alpha, { fileNumber: "F-001", title: "Title deeds" });
  assert.equal(await getCorrespondence(beta, letter.id), null);
  assert.equal((await listCorrespondence(beta)).length, 0);
  await assert.rejects(actOnCorrespondence(beta, letter.id, "close", { expectedStatus: "REGISTERED", note: "closing someone else's letter" }), /not found/);
  await assert.rejects(addCorrespondenceNote(beta, letter.id, "hello"), /not found/);
  await assert.rejects(issuePhysicalFile(beta, file.id, { holderId: beta.membershipId, expectedReturnOn: "2099-01-01" }), /not found/);
  assert.equal((await listPhysicalFiles(beta)).length, 0);
  assert.equal((await fileMovements(beta, file.id)).length, 0);

  // Reference numbers are per company: Beta's first letter is also number 1.
  const b1 = await registerCorrespondence(beta, { direction: "INCOMING", subject: "Beta letter", senderName: "X Ltd", recipientName: "Beta", dateReceived: "2026-10-01" });
  assert.match(b1.ref, /\/0001$/);
});

test("physical files are issued, tracked and returned one holder at a time", async () => {
  const admin = await newCompany("files");
  const officer = await addMember(admin, "OFFICER", "Femi");
  const file = await createPhysicalFile(officer, { fileNumber: "F-100", title: "Plot 12 title deeds", location: "Cabinet B" });
  await assert.rejects(createPhysicalFile(officer, { fileNumber: "F-100", title: "Duplicate" }), /already in the register/);
  await assert.rejects(issuePhysicalFile(officer, file.id, { holderId: officer.membershipId, expectedReturnOn: "2000-01-01" }), /past/);
  await issuePhysicalFile(officer, file.id, { holderId: officer.membershipId, expectedReturnOn: "2099-01-01", purpose: "Valuation" });
  await assert.rejects(issuePhysicalFile(admin, file.id, { holderId: admin.membershipId, expectedReturnOn: "2099-01-01" }), /not in the registry/);
  const issued = (await listPhysicalFiles(officer, { view: "issued" })).find((f) => f.id === file.id);
  assert.ok(issued && issued.holderId === officer.membershipId);
  await returnPhysicalFile(officer, file.id);
  await assert.rejects(returnPhysicalFile(officer, file.id), /already in the registry/);
  const moves = await fileMovements(officer, file.id);
  assert.equal(moves.length, 1);
  assert.ok(moves[0].returnedOn);
  await assert.rejects(createPhysicalFile(withRole(admin, "VIEWER"), { fileNumber: "F-2", title: "Nope" }), /permission/);
});

test("rate limits are shared through the database", async () => {
  const key = `test:${Date.now()}:${Math.random()}`;
  assert.equal(await rateLimit(key, 2, 60_000), true);
  assert.equal(await rateLimit(key, 2, 60_000), true);
  assert.equal(await rateLimit(key, 2, 60_000), false, "the third attempt in the window is refused");
});
