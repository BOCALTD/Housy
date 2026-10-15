"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import type { Method } from "@/lib/valuation-rules";
import {
  addComparable, addEntry, addValuationDocument, assignValuation, cancelInstruction, createInstruction, decideReport, issueValuation, removeComparable,
  removeEntry, removeWorksheet, reviseReport, saveReportDraft, saveWorksheet, submitReport, updateInstruction, verifyComparable,
} from "@/lib/services/valuation";

const path = (id: string) => `/app/valuations/${encodeURIComponent(id)}`;

export async function createInstructionAction(form: FormData) {
  return act("/app/valuations", async () => {
    const member = await requireMember("valuation.manage");
    const inst = await createInstruction(member, {
      assetId: str(form, "assetId"), clientName: str(form, "clientName"), clientReference: str(form, "clientReference"), purpose: str(form, "purpose") as never,
      purposeNote: str(form, "purposeNote"), basis: (optStr(form, "basis") ?? "MARKET_VALUE") as never, premise: (optStr(form, "premise") ?? "STANDARD") as never,
      assetDescription: str(form, "assetDescription"), scope: str(form, "scope"), instructionDate: optStr(form, "instructionDate"), valuationDate: optStr(form, "valuationDate"),
      inspectionDate: optStr(form, "inspectionDate"), dueDate: optStr(form, "dueDate"), assignedToId: optStr(form, "assignedToId"),
      professionalName: str(form, "professionalName"), professionalBody: str(form, "professionalBody"), registrationNo: str(form, "registrationNo"),
    });
    return withNotice(path(inst.id), `${inst.ref} created.`);
  });
}

export async function updateInstructionAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await updateInstruction(member, id, {
      purposeNote: str(form, "purposeNote"), basis: str(form, "basis") as never, premise: str(form, "premise") as never, assetDescription: str(form, "assetDescription"),
      scope: str(form, "scope"), valuationDate: optStr(form, "valuationDate"), inspectionDate: optStr(form, "inspectionDate"), dueDate: optStr(form, "dueDate"),
      professionalName: str(form, "professionalName"), professionalBody: str(form, "professionalBody"), registrationNo: str(form, "registrationNo"),
    });
    return withNotice(path(id), "Saved.");
  });
}

export async function assignAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.manage");
    await assignValuation(member, id, optStr(form, "assignedToId") ?? null);
    return withNotice(path(id), "Assignment saved.");
  });
}

export async function cancelAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.manage");
    await cancelInstruction(member, id, str(form, "reason"));
    return withNotice(path(id), "Instruction cancelled.");
  });
}

export async function issueAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.manage");
    await issueValuation(member, id, optStr(form, "issuedOn"));
    return withNotice(path(id), "Recorded as issued to the client.");
  });
}

export async function worksheetAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    const raw: Record<string, string> = {};
    for (const k of ["subjectArea", "grossRent", "vacancy", "operatingCosts", "capRate", "landValue", "costPerSqm", "buildingArea", "depreciation"]) raw[k] = str(form, k);
    await saveWorksheet(member, id, str(form, "method") as Method, raw, str(form, "note"));
    return withNotice(path(id), "Worksheet calculated.");
  });
}

export async function removeWorksheetAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await removeWorksheet(member, id, str(form, "method") as Method);
    return withNotice(path(id), "Worksheet removed.");
  });
}

export async function addComparableAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await addComparable(member, id, {
      kind: (optStr(form, "kind") ?? "SALE") as never, address: str(form, "address"), evidenceDate: str(form, "evidenceDate"), price: str(form, "price"), area: str(form, "area"),
      adjustment: optStr(form, "adjustment"), adjustmentNote: str(form, "adjustmentNote"), weight: optStr(form, "weight"), source: str(form, "source"),
    });
    return withNotice(path(id), "Comparable added.");
  });
}

export async function removeComparableAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await removeComparable(member, str(form, "comparableId"));
    return withNotice(path(id), "Comparable removed.");
  });
}

export async function verifyComparableAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await verifyComparable(member, str(form, "comparableId"));
    return withNotice(path(id), "Marked as checked against its source.");
  });
}

export async function addEntryAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await addEntry(member, id, str(form, "kind") as never, str(form, "text"));
    return withNotice(path(id), "Recorded.");
  });
}

export async function removeEntryAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await removeEntry(member, str(form, "entryId"));
    return withNotice(path(id), "Removed.");
  });
}

export async function addDocumentAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file to upload");
    await addValuationDocument(member, id, str(form, "title"), { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Document added.");
  });
}

export async function saveDraftAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await saveReportDraft(member, id, {
      summary: str(form, "summary"), conclusion: str(form, "conclusion"), concludedValue: optStr(form, "concludedValue"), reconciliationNote: str(form, "reconciliationNote"),
      aiAssisted: form.get("aiAssisted") === "on", aiNote: str(form, "aiNote"),
    });
    return withNotice(path(id), "Draft saved.");
  });
}

export async function submitReportAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.prepare");
    await submitReport(member, id);
    return withNotice(path(id), "Sent for approval. The evidence is now locked.");
  });
}

export async function decideReportAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.approve");
    const decision = str(form, "decision") === "approve" ? "approve" : "reject";
    await decideReport(member, id, decision, str(form, "note"), form.get("confirmReviewed") === "on");
    return withNotice(path(id), decision === "approve" ? "Report approved." : "Report returned to the preparer.");
  });
}

export async function reviseReportAction(form: FormData) {
  const id = str(form, "instructionId");
  return act(path(id), async () => {
    const member = await requireMember("valuation.manage");
    await reviseReport(member, id, str(form, "reason"));
    return withNotice(path(id), "A new version is open for editing. The approved version stands until it is approved.");
  });
}
