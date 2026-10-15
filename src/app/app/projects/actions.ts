"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  achieveMilestone, activateProject, addMilestone, addWorkPackage, cancelProject, createProject, decideBudget, decideCommitment, decideInvoice, decideVariation,
  holdProject, markInvoicePaid, recordForecast, recordInvoice, removeMilestone, removeWorkPackage, requestCommitment, requestVariation, resumeProject,
  setProgress, submitBudget, updateProject, updateWorkPackage,
} from "@/lib/services/project";

const path = (id: string) => `/app/projects/${encodeURIComponent(id)}`;
const dec = (form: FormData) => (str(form, "decision") === "approve" ? "approve" : "reject") as "approve" | "reject";

export async function createProjectAction(form: FormData) {
  return act("/app/projects", async () => {
    const member = await requireMember("project.manage");
    const p = await createProject(member, {
      assetId: str(form, "assetId"), title: str(form, "title"), kind: str(form, "kind") as never, description: str(form, "description"), managerId: optStr(form, "managerId"),
      plannedStart: str(form, "plannedStart"), plannedEnd: str(form, "plannedEnd"), contingency: optStr(form, "contingency"),
    });
    return withNotice(path(p.id), `${p.ref} created.`);
  });
}

export async function updateProjectAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const member = await requireMember("project.manage");
    await updateProject(member, id, {
      title: str(form, "title"), description: str(form, "description"), managerId: optStr(form, "managerId"), plannedStart: str(form, "plannedStart"),
      plannedEnd: str(form, "plannedEnd"), contingency: optStr(form, "contingency"),
    });
    return withNotice(path(id), "Saved.");
  });
}

export async function startAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await activateProject(await requireMember("project.manage"), id); return withNotice(path(id), "Project started."); });
}
export async function holdAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await holdProject(await requireMember("project.manage"), id, str(form, "reason")); return withNotice(path(id), "Project put on hold."); });
}
export async function resumeAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await resumeProject(await requireMember("project.manage"), id); return withNotice(path(id), "Project resumed."); });
}
export async function cancelAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await cancelProject(await requireMember("project.manage"), id, str(form, "reason")); return withNotice(path(id), "Project cancelled."); });
}

const pkgInput = (form: FormData) => ({
  title: str(form, "title"), description: str(form, "description"), responsibleId: optStr(form, "responsibleId"), contractorId: optStr(form, "contractorId"),
  plannedStart: str(form, "plannedStart"), plannedEnd: str(form, "plannedEnd"), budget: optStr(form, "budget"),
});

export async function addPackageAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const r = await addWorkPackage(await requireMember("project.plan"), id, pkgInput(form));
    return withNotice(path(id), r.warnings.length ? `Work package added. Note: ${r.warnings.join(" ")}` : "Work package added.");
  });
}
export async function updatePackageAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const r = await updateWorkPackage(await requireMember("project.plan"), str(form, "packageId"), pkgInput(form));
    return withNotice(path(id), r.warnings.length ? `Saved. Note: ${r.warnings.join(" ")}` : "Saved.");
  });
}
export async function removePackageAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await removeWorkPackage(await requireMember("project.plan"), str(form, "packageId")); return withNotice(path(id), "Work package removed."); });
}
export async function progressAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await setProgress(await requireMember("project.plan"), str(form, "packageId"), str(form, "status"), str(form, "percent"), str(form, "note"));
    return withNotice(path(id), "Progress recorded.");
  });
}

export async function addMilestoneAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await addMilestone(await requireMember("project.plan"), id, { title: str(form, "title"), dueOn: str(form, "dueOn"), workPackageId: optStr(form, "workPackageId") });
    return withNotice(path(id), "Milestone added.");
  });
}
export async function achieveMilestoneAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await achieveMilestone(await requireMember("project.plan"), str(form, "milestoneId"), optStr(form, "achievedOn")); return withNotice(path(id), "Milestone recorded as achieved."); });
}
export async function removeMilestoneAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await removeMilestone(await requireMember("project.plan"), str(form, "milestoneId")); return withNotice(path(id), "Milestone removed."); });
}

export async function submitBudgetAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await submitBudget(await requireMember("project.plan"), id); return withNotice(path(id), "Budget sent for approval."); });
}
export async function decideBudgetAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const d = dec(form);
    await decideBudget(await requireMember("project.approve"), id, d, str(form, "note"));
    return withNotice(path(id), d === "approve" ? "Budget approved." : "Budget returned for changes.");
  });
}

export async function requestCommitmentAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const c = await requestCommitment(await requireMember("project.cost"), id, {
      supplierName: str(form, "supplierName"), contractorId: optStr(form, "contractorId"), description: str(form, "description"), amount: str(form, "amount"), workPackageId: optStr(form, "workPackageId"),
    });
    return withNotice(path(id), `${c.ref} sent for approval.`);
  });
}
export async function decideCommitmentAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const d = dec(form);
    await decideCommitment(await requireMember("project.approve"), str(form, "commitmentId"), d, str(form, "note"));
    return withNotice(path(id), d === "approve" ? "Commitment approved." : "Commitment rejected.");
  });
}

export async function recordInvoiceAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    await recordInvoice(await requireMember("project.cost"), str(form, "commitmentId"), { invoiceNo: str(form, "invoiceNo"), invoiceDate: str(form, "invoiceDate"), dueDate: optStr(form, "dueDate"), amount: str(form, "amount") });
    return withNotice(path(id), "Invoice recorded and waiting for approval.");
  });
}
export async function decideInvoiceAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const d = dec(form);
    await decideInvoice(await requireMember("project.approve"), str(form, "invoiceId"), d, str(form, "note"));
    return withNotice(path(id), d === "approve" ? "Invoice approved." : "Invoice rejected.");
  });
}
export async function payInvoiceAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await markInvoicePaid(await requireMember("project.approve"), str(form, "invoiceId"), optStr(form, "paidOn")); return withNotice(path(id), "Invoice marked as paid."); });
}

export async function requestVariationAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const v = await requestVariation(await requireMember("project.cost"), id, {
      target: str(form, "target") as never, commitmentId: optStr(form, "commitmentId"), workPackageId: optStr(form, "workPackageId"), title: str(form, "title"), reason: str(form, "reason"),
      amount: str(form, "amount"), timeImpactDays: optStr(form, "timeImpactDays"),
    });
    return withNotice(path(id), `${v.ref} sent for approval.`);
  });
}
export async function decideVariationAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => {
    const d = dec(form);
    await decideVariation(await requireMember("project.approve"), str(form, "variationId"), d, str(form, "note"));
    return withNotice(path(id), d === "approve" ? "Variation approved." : "Variation rejected.");
  });
}

export async function forecastAction(form: FormData) {
  const id = str(form, "projectId");
  return act(path(id), async () => { await recordForecast(await requireMember("project.cost"), str(form, "packageId"), str(form, "etc"), str(form, "note")); return withNotice(path(id), "Forecast recorded."); });
}
