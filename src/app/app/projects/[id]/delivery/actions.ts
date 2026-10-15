"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { useOnProject } from "@/lib/services/inventory";
import {
  addProcurement, addQualityCheck, addQualityPhoto, addRisk, addSitePhoto, appointParty, cancelProcurement, endParty, orderProcurement, recordDelivery,
  recordProgressUpdate, recordQualityResult, recordSiteInspection, updateRisk, waiveQualityCheck,
} from "@/lib/services/project-delivery";

const path = (id: string) => `/app/projects/${encodeURIComponent(id)}/delivery`;

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

export async function appointPartyAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await appointParty(await requireMember("project.plan"), id, { role: str(form, "role") as never, contractorId: optStr(form, "contractorId"), name: str(form, "name"), scope: str(form, "scope"), email: str(form, "email"), phone: str(form, "phone"), appointedOn: optStr(form, "appointedOn") });
    return withNotice(path(id), "Appointed.");
  });
}
export async function endPartyAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await endParty(await requireMember("project.plan"), str(form, "partyId")); return withNotice(path(id), "Appointment ended."); });
}

export async function addProcurementAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await addProcurement(await requireMember("project.plan"), id, { description: str(form, "description"), quantity: str(form, "quantity"), unit: str(form, "unit"), requiredBy: str(form, "requiredBy"), workPackageId: optStr(form, "workPackageId"), note: str(form, "note") });
    return withNotice(path(id), "Requirement added.");
  });
}
export async function orderProcurementAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await orderProcurement(await requireMember("project.cost"), str(form, "itemId"), { supplierName: str(form, "supplierName"), commitmentId: optStr(form, "commitmentId"), orderedOn: optStr(form, "orderedOn") });
    return withNotice(path(id), "Marked as ordered.");
  });
}
export async function deliveryAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await recordDelivery(await requireMember("project.plan"), str(form, "itemId"), { quantity: str(form, "quantity"), deliveredOn: optStr(form, "deliveredOn"), inventoryItemId: optStr(form, "inventoryItemId") });
    return withNotice(path(id), "Delivery recorded.");
  });
}
export async function cancelProcurementAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await cancelProcurement(await requireMember("project.plan"), str(form, "itemId")); return withNotice(path(id), "Cancelled."); });
}

export async function useStockAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await useOnProject(await requireMember("project.plan"), str(form, "itemId"), id, { quantity: str(form, "quantity"), workPackageId: optStr(form, "workPackageId") });
    return withNotice(path(id), "Stock issued to the project.");
  });
}

const riskInput = (form: FormData) => ({
  title: str(form, "title"), description: str(form, "description"), category: str(form, "category"), likelihood: str(form, "likelihood"), impact: str(form, "impact"),
  ownerId: optStr(form, "ownerId"), mitigation: str(form, "mitigation"), reviewOn: optStr(form, "reviewOn"),
});
export async function addRiskAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await addRisk(await requireMember("project.plan"), id, riskInput(form)); return withNotice(path(id), "Risk recorded."); });
}
export async function updateRiskAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await updateRisk(await requireMember("project.plan"), str(form, "riskId"), { ...riskInput(form), status: str(form, "status") as never, closeNote: str(form, "closeNote") });
    return withNotice(path(id), "Risk updated.");
  });
}

export async function siteInspectionAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const member = await requireMember("project.plan");
    const s = await recordSiteInspection(member, id, { inspectedOn: str(form, "inspectedOn"), workPackageId: optStr(form, "workPackageId"), summary: str(form, "summary"), actions: str(form, "actions"), outcome: str(form, "outcome") as never });
    const f = upload(form, "photo");
    if (f) await addSitePhoto(member, s.id, { caption: str(form, "caption") }, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Site inspection recorded.");
  });
}
export async function sitePhotoAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const f = upload(form, "photo");
    if (!f) throw new Error("Choose a photograph");
    await addSitePhoto(await requireMember("project.plan"), str(form, "inspectionId"), { caption: str(form, "caption") }, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Photograph added.");
  });
}

export async function progressUpdateAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await recordProgressUpdate(await requireMember("project.plan"), id, { reportDate: optStr(form, "reportDate"), summary: str(form, "summary"), issues: str(form, "issues"), nextSteps: str(form, "nextSteps") });
    return withNotice(path(id), "Progress report recorded.");
  });
}

export async function addQualityAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await addQualityCheck(await requireMember("project.plan"), str(form, "packageId"), { title: str(form, "title"), standard: str(form, "standard") }); return withNotice(path(id), "Quality check added."); });
}
export async function qualityResultAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const member = await requireMember("project.plan");
    await recordQualityResult(member, str(form, "checkId"), str(form, "result"), str(form, "note"));
    const f = upload(form, "photo");
    if (f) await addQualityPhoto(member, str(form, "checkId"), { caption: str(form, "note") }, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Result recorded.");
  });
}
export async function waiveQualityAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await waiveQualityCheck(await requireMember("project.approve"), str(form, "checkId"), str(form, "reason")); return withNotice(path(id), "Check waived."); });
}
