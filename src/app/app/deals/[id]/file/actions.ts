"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { addDealDocument, addDealTask, linkCorrespondence, recordDealPayment, reverseDealPayment, setDealTaskStatus } from "@/lib/services/deal-file";
import { addClientActivity } from "@/lib/services/crm";

const path = (id: string) => `/app/deals/${encodeURIComponent(id)}/file`;

export async function addDocumentAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    await addDealDocument(await requireMember("crm.manage"), id, str(form, "kind"), str(form, "title"), { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(path(id), "Document added.");
  });
}

export async function recordPaymentAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await recordDealPayment(await requireMember("crm.manage"), id, {
      kind: str(form, "kind") as never, amount: str(form, "amount"), paidOn: str(form, "paidOn"), method: str(form, "method"), reference: str(form, "reference"), note: str(form, "note"),
    });
    return withNotice(path(id), "Payment recorded.");
  });
}

export async function reversePaymentAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await reverseDealPayment(await requireMember("crm.approve"), str(form, "paymentId"), str(form, "reason"));
    return withNotice(path(id), "Payment reversed.");
  });
}

export async function linkCorrespondenceAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await linkCorrespondence(await requireMember("crm.manage"), id, str(form, "correspondenceId"), optStr(form, "unlink") === "yes");
    return withNotice(path(id), optStr(form, "unlink") === "yes" ? "Unlinked." : "Linked.");
  });
}

export async function addTaskAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await addDealTask(await requireMember("crm.manage"), id, { title: str(form, "title"), description: str(form, "description"), dueOn: optStr(form, "dueOn"), assigneeId: optStr(form, "assigneeId") });
    return withNotice(path(id), "Task added.");
  });
}

export async function taskStatusAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await setDealTaskStatus(await requireMember("crm.manage"), str(form, "taskId"), str(form, "status") as never, str(form, "outcome"));
    return withNotice(path(id), "Saved.");
  });
}

export async function addConversationAction(form: FormData) {
  const id = str(form, "dealId");
  return act(path(id), async () => {
    await addClientActivity(await requireMember("crm.manage"), str(form, "clientId"), {
      kind: str(form, "kind") as never, subject: str(form, "subject"), body: str(form, "body"), dealId: id, dueOn: optStr(form, "dueOn"), assigneeId: optStr(form, "assigneeId"),
    });
    return withNotice(path(id), "Saved.");
  });
}
