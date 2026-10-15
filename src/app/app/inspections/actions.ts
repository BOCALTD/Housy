"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  addFinding, addInspectionPhoto, cancelInspection, createTemplate, decideInspection, installStarterTemplates,
  saveInspectionRecord, scheduleInspection, setTemplateActive, submitInspection,
} from "@/lib/services/inspections";

const insPath = (id: string) => `/app/inspections/${encodeURIComponent(id)}`;

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

async function toUpload(file: File) {
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function scheduleInspectionAction(form: FormData) {
  return act("/app/inspections", async () => {
    const member = await requireMember("inspection.manage");
    const row = await scheduleInspection(member, str(form, "assetId"), {
      templateId: optStr(form, "templateId"), leaseId: optStr(form, "leaseId"), purpose: str(form, "purpose") as never,
      scheduledFor: str(form, "scheduledFor"), inspectorId: optStr(form, "inspectorId"), responsibleId: optStr(form, "responsibleId"),
      location: str(form, "location"), participants: str(form, "participants"), recurrenceMonths: optStr(form, "recurrenceMonths"),
    });
    return withNotice(insPath(row.id), `Inspection ${row.ref} scheduled.`);
  });
}

export async function installStartersAction() {
  return act("/app/inspections/templates", async () => {
    const member = await requireMember("inspection.manage");
    const added = await installStarterTemplates(member);
    return withNotice("/app/inspections/templates", added ? `${added} starter template${added === 1 ? "" : "s"} added.` : "The starter templates are already there.");
  });
}

export async function createTemplateAction(form: FormData) {
  return act("/app/inspections/templates", async () => {
    const member = await requireMember("inspection.manage");
    await createTemplate(member, { name: str(form, "name"), assetClass: optStr(form, "assetClass"), checklist: str(form, "checklist") });
    return withNotice("/app/inspections/templates", "Template created.");
  });
}

export async function toggleTemplateAction(form: FormData) {
  return act("/app/inspections/templates", async () => {
    const member = await requireMember("inspection.manage");
    await setTemplateActive(member, str(form, "templateId"), str(form, "active") === "true");
    return withNotice("/app/inspections/templates", "Template updated.");
  });
}

export async function saveRecordAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.conduct");
    const responses: Record<string, { result: never; note: string }> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("result:") && typeof value === "string") {
        const rid = key.slice("result:".length);
        responses[rid] = { result: value as never, note: str(form, `note:${rid}`) };
      }
    }
    await saveInspectionRecord(member, id, {
      conductedOn: optStr(form, "conductedOn"), location: str(form, "location"), participants: str(form, "participants"),
      conditionRating: optStr(form, "conditionRating"), summary: str(form, "summary"), recommendedActions: str(form, "recommendedActions"),
      estimatedRepair: optStr(form, "estimatedRepair"), followUpBy: optStr(form, "followUpBy"),
      operatingHours: optStr(form, "operatingHours"), technicalNotes: str(form, "technicalNotes"), responses,
    });
    return withNotice(insPath(id), "Saved.");
  });
}

export async function addFindingAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.conduct");
    const file = upload(form, "photo");
    await addFinding(member, id, {
      title: str(form, "title"), description: str(form, "description"), location: str(form, "location"),
      severity: str(form, "severity") as never, safetyRisk: str(form, "safetyRisk") === "on",
      estimatedCost: optStr(form, "estimatedCost"), recommendedAction: str(form, "recommendedAction"),
    }, file ? { ...(await toUpload(file)), phase: "EVIDENCE", caption: str(form, "title") } : null);
    return withNotice(insPath(id), "Finding added.");
  });
}

export async function addPhotoAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.conduct");
    const file = upload(form, "photo");
    if (!file) throw new Error("Choose a photograph to upload");
    await addInspectionPhoto(member, id, optStr(form, "findingId") ?? null, { phase: optStr(form, "phase"), caption: str(form, "caption") }, await toUpload(file));
    return withNotice(insPath(id), "Photograph added.");
  });
}

export async function submitInspectionAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.conduct");
    await submitInspection(member, id);
    return withNotice(insPath(id), "Submitted for approval.");
  });
}

export async function approveInspectionAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.approve");
    const next = await decideInspection(member, id, "approve", str(form, "note"));
    return withNotice(insPath(id), next ? `Approved. The next inspection (${next.ref}) is scheduled.` : "Approved.");
  });
}

export async function returnInspectionAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.approve");
    await decideInspection(member, id, "return", str(form, "note"));
    return withNotice(insPath(id), "Returned to the inspector for correction.");
  });
}

export async function cancelInspectionAction(form: FormData) {
  const id = str(form, "inspectionId");
  return act(insPath(id), async () => {
    const member = await requireMember("inspection.manage");
    await cancelInspection(member, id, str(form, "reason"));
    return withNotice(insPath(id), "Inspection cancelled.");
  });
}
