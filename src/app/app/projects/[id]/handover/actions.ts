"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  addHandoverItem, addProjectDocument, addWarranty, decideCompletion, defectToWorkOrder, fixDefect, raiseDefect, recordHandover, removeWarranty, requestCompletion,
  tickHandoverItem, verifyDefect, withdrawCompletion,
} from "@/lib/services/project-handover";

const path = (id: string) => `/app/projects/${encodeURIComponent(id)}/handover`;

export async function requestCompletionAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await requestCompletion(await requireMember("project.plan"), id, { note: str(form, "note"), defectsMonths: str(form, "defectsMonths") });
    return withNotice(path(id), "Completion requested. Someone else must now approve it.");
  });
}
export async function withdrawCompletionAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await withdrawCompletion(await requireMember("project.plan"), id); return withNotice(path(id), "Request withdrawn."); });
}
export async function decideCompletionAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const decision = str(form, "decision") === "approve" ? "approve" : "reject";
    await decideCompletion(await requireMember("project.approve"), id, decision, str(form, "note"));
    return withNotice(path(id), decision === "approve" ? "Project completed. The handover checklist is ready." : "Completion not accepted.");
  });
}

export async function raiseDefectAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await raiseDefect(await requireMember("project.plan"), id, { title: str(form, "title"), description: str(form, "description"), severity: str(form, "severity") as never, workPackageId: optStr(form, "workPackageId"), dueOn: optStr(form, "dueOn") });
    return withNotice(path(id), "Defect raised.");
  });
}
export async function fixDefectAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await fixDefect(await requireMember("project.plan"), str(form, "defectId"), str(form, "note")); return withNotice(path(id), "Marked as fixed. Someone else must verify it."); });
}
export async function verifyDefectAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const decision = str(form, "decision") === "verify" ? "verify" : "reject";
    await verifyDefect(await requireMember("project.plan"), str(form, "defectId"), decision, str(form, "note"));
    return withNotice(path(id), decision === "verify" ? "Fix verified." : "Sent back for more work.");
  });
}
export async function defectWorkOrderAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const wo = await defectToWorkOrder(await requireMember("maintenance.request"), str(form, "defectId"));
    return withNotice(path(id), `Work order ${wo.ref} raised.`);
  });
}

export async function addWarrantyAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await addWarranty(await requireMember("project.plan"), id, { title: str(form, "title"), provider: str(form, "provider"), coverage: str(form, "coverage"), startsOn: str(form, "startsOn"), endsOn: str(form, "endsOn"), documentId: optStr(form, "documentId") });
    return withNotice(path(id), "Warranty recorded against the asset.");
  });
}
export async function removeWarrantyAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await removeWarranty(await requireMember("project.manage"), str(form, "warrantyId")); return withNotice(path(id), "Warranty removed."); });
}

export async function addDocumentAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    await addProjectDocument(await requireMember("project.plan"), id, str(form, "kind"), str(form, "title"), { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Document added.");
  });
}

export async function tickItemAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const done = str(form, "done") === "yes";
    await tickHandoverItem(await requireMember("project.plan"), str(form, "itemId"), done, str(form, "note"));
    return withNotice(path(id), done ? "Ticked." : "Un-ticked.");
  });
}
export async function addItemAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await addHandoverItem(await requireMember("project.plan"), id, str(form, "title")); return withNotice(path(id), "Checklist item added."); });
}
export async function recordHandoverAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await recordHandover(await requireMember("project.manage"), id, { handedTo: str(form, "handedTo"), note: str(form, "note"), handoverOn: optStr(form, "handoverOn") });
    return withNotice(path(id), "Handover recorded.");
  });
}
