"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  addMaterial, addWorkOrderPhoto, approveWorkOrder, assignWorkOrder, cancelWorkOrder, closeWorkOrder, completeWorkOrder,
  createContractor, createSchedule, generateDueWorkOrders, removeMaterial, reopenWorkOrder, reportWorkOrder, setContractorActive,
  setProgress, setScheduleActive, triageWorkOrder,
} from "@/lib/services/maintenance";
import { decideSubmission } from "@/lib/services/portals";

const woPath = (id: string) => `/app/maintenance/${encodeURIComponent(id)}`;

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

export async function reportWorkOrderAction(form: FormData) {
  const back = optStr(form, "back") ?? "/app/maintenance";
  return act(back, async () => {
    const member = await requireMember("maintenance.request");
    const wo = await reportWorkOrder(member, str(form, "assetId"), {
      title: str(form, "title"), description: str(form, "description"), priority: (optStr(form, "priority") ?? "NORMAL") as never,
      riskLevel: (optStr(form, "riskLevel") ?? "LOW") as never, safetyRisk: str(form, "safetyRisk") === "on",
      requesterName: str(form, "requesterName"), leaseId: optStr(form, "leaseId"), findingId: optStr(form, "findingId"),
      targetDate: optStr(form, "targetDate"), estimatedCost: optStr(form, "estimatedCost"),
    });
    return withNotice(woPath(wo.id), `Work order ${wo.ref} raised.`);
  });
}

export async function triageAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.manage");
    await triageWorkOrder(member, id, {
      priority: str(form, "priority") as never, riskLevel: str(form, "riskLevel") as never, safetyRisk: str(form, "safetyRisk") === "on",
      targetDate: optStr(form, "targetDate"), estimatedCost: optStr(form, "estimatedCost"), note: str(form, "note"),
    });
    return withNotice(woPath(id), "Triaged.");
  });
}

export async function approveAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.approve");
    await approveWorkOrder(member, id, { approvedCost: str(form, "approvedCost"), note: str(form, "note") });
    return withNotice(woPath(id), "Cost approved.");
  });
}

export async function assignAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.manage");
    await assignWorkOrder(member, id, { assigneeId: optStr(form, "assigneeId"), contractorId: optStr(form, "contractorId"), targetDate: optStr(form, "targetDate") });
    return withNotice(woPath(id), "Assigned.");
  });
}

export async function progressAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.work");
    await setProgress(member, id, str(form, "to") as never, str(form, "note"));
    return withNotice(woPath(id), "Status updated.");
  });
}

export async function addMaterialAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.work");
    await addMaterial(member, id, { description: str(form, "description"), quantity: str(form, "quantity"), unit: str(form, "unit"), unitCost: str(form, "unitCost") });
    return withNotice(woPath(id), "Material added.");
  });
}

export async function removeMaterialAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.work");
    await removeMaterial(member, id, str(form, "materialId"));
    return withNotice(woPath(id), "Material removed.");
  });
}

export async function addPhotoAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.work");
    const file = upload(form, "photo");
    if (!file) throw new Error("Choose a photograph to upload");
    await addWorkOrderPhoto(member, id, { phase: str(form, "phase"), caption: str(form, "caption") }, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return withNotice(woPath(id), "Photograph added.");
  });
}

export async function completeAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.work");
    await completeWorkOrder(member, id, {
      completedOn: str(form, "completedOn"), notes: str(form, "notes"), evidenceRef: str(form, "evidenceRef"), actualCost: optStr(form, "actualCost"),
      downtimeFrom: optStr(form, "downtimeFrom"), downtimeTo: optStr(form, "downtimeTo"),
    });
    return withNotice(woPath(id), "Marked as completed. Someone else now needs to verify it.");
  });
}

export async function closeAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.verify");
    await closeWorkOrder(member, id, str(form, "note"));
    return withNotice(woPath(id), "Verified and closed.");
  });
}

export async function reopenAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.verify");
    await reopenWorkOrder(member, id, str(form, "note"));
    return withNotice(woPath(id), "Sent back for more work.");
  });
}

export async function cancelAction(form: FormData) {
  const id = str(form, "workOrderId");
  return act(woPath(id), async () => {
    const member = await requireMember("maintenance.manage");
    await cancelWorkOrder(member, id, str(form, "reason"));
    return withNotice(woPath(id), "Work order cancelled.");
  });
}

export async function createContractorAction(form: FormData) {
  return act("/app/maintenance/contractors", async () => {
    const member = await requireMember("maintenance.manage");
    await createContractor(member, { name: str(form, "name"), trade: str(form, "trade"), phone: str(form, "phone"), email: str(form, "email"), notes: str(form, "notes") });
    return withNotice("/app/maintenance/contractors", "Contractor added.");
  });
}

export async function toggleContractorAction(form: FormData) {
  return act("/app/maintenance/contractors", async () => {
    const member = await requireMember("maintenance.manage");
    await setContractorActive(member, str(form, "contractorId"), str(form, "active") === "true");
    return withNotice("/app/maintenance/contractors", "Contractor updated.");
  });
}

export async function createScheduleAction(form: FormData) {
  return act("/app/maintenance/schedules", async () => {
    const member = await requireMember("maintenance.manage");
    await createSchedule(member, str(form, "assetId"), {
      title: str(form, "title"), description: str(form, "description"), priority: (optStr(form, "priority") ?? "NORMAL") as never,
      intervalMonths: str(form, "intervalMonths"), nextDueOn: str(form, "nextDueOn"), leadDays: optStr(form, "leadDays"),
      contractorId: optStr(form, "contractorId"), assigneeId: optStr(form, "assigneeId"), estimatedCost: optStr(form, "estimatedCost"),
    });
    return withNotice("/app/maintenance/schedules", "Recurring job added.");
  });
}

export async function toggleScheduleAction(form: FormData) {
  return act("/app/maintenance/schedules", async () => {
    const member = await requireMember("maintenance.manage");
    await setScheduleActive(member, str(form, "scheduleId"), str(form, "active") === "true");
    return withNotice("/app/maintenance/schedules", "Recurring job updated.");
  });
}

export async function generateAction() {
  return act("/app/maintenance", async () => {
    const member = await requireMember("maintenance.manage");
    const n = await generateDueWorkOrders(member);
    return withNotice("/app/maintenance", n ? `${n} work order${n === 1 ? "" : "s"} created from recurring jobs.` : "Nothing is due from the recurring jobs.");
  });
}

export async function decideSubmissionAction(form: FormData) {
  const back = woPath(str(form, "workOrderId"));
  return act(back, async () => {
    const m = await requireMember("maintenance.manage");
    const accept = str(form, "decision") === "accept";
    await decideSubmission(m, str(form, "id"), accept, str(form, "note"));
    return withNotice(back, accept ? "Accepted. The vendor has been told." : "Returned to the vendor with your note.") + "#vendor";
  });
}
