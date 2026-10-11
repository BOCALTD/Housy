"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import type { CorrAction } from "@/lib/correspondence-rules";
import {
  actOnCorrespondence, addCorrespondenceAttachment, addCorrespondenceNote, registerCorrespondence,
} from "@/lib/services/correspondence";

const recPath = (id: string) => `/app/correspondence/${encodeURIComponent(id)}`;

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

export async function registerAction(form: FormData) {
  return act("/app/correspondence/new", async () => {
    const member = await requireMember("correspondence.register");
    const file = upload(form, "file");
    const rec = await registerCorrespondence(member, {
      direction: str(form, "direction") as never, subject: str(form, "subject"), description: str(form, "description"),
      category: str(form, "category"), priority: (optStr(form, "priority") ?? "NORMAL") as never,
      confidential: str(form, "confidential") === "on", senderName: str(form, "senderName"),
      recipientName: str(form, "recipientName"), copiedTo: str(form, "copiedTo"), externalRef: str(form, "externalRef"),
      dateReceived: optStr(form, "dateReceived"), responseDeadline: optStr(form, "responseDeadline"),
      assetId: optStr(form, "assetId"), departmentId: optStr(form, "departmentId"), assigneeId: optStr(form, "assigneeId"),
      draftResponse: str(form, "draftResponse"),
    }, file ? { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    return withNotice(recPath(rec.id), `Registered as ${rec.ref}.`);
  });
}

const ACTIONS: CorrAction[] = [
  "assign", "start_review", "require_response", "save_draft", "submit_for_approval",
  "approve", "return_to_draft", "dispatch", "await_reply", "close",
];

const NOTICES: Record<CorrAction, string> = {
  assign: "Assigned.", start_review: "Review started.", require_response: "Marked as needing a response.",
  save_draft: "Draft saved.", submit_for_approval: "Sent for approval.", approve: "Response approved.",
  return_to_draft: "Returned to the drafter.", dispatch: "Recorded as sent.", await_reply: "Now awaiting a reply.",
  close: "Closed.",
};

export async function workflowAction(form: FormData) {
  return runWorkflow(form, str(form, "action") as CorrAction);
}

/** The "Save and send for approval" button on the draft form. */
export async function submitDraftAction(form: FormData) {
  return runWorkflow(form, "submit_for_approval");
}

async function runWorkflow(form: FormData, action: CorrAction) {
  const id = str(form, "id");
  return act(recPath(id), async () => {
    const member = await requireMember("correspondence.view");
    if (!ACTIONS.includes(action)) throw new Error("Unknown action");
    await actOnCorrespondence(member, id, action, {
      expectedStatus: str(form, "expectedStatus"), note: str(form, "note"), assigneeId: optStr(form, "assigneeId"),
      requiredAction: str(form, "requiredAction"), responseDeadline: optStr(form, "responseDeadline"),
      draftResponse: form.has("draftResponse") ? str(form, "draftResponse") : undefined,
      dispatchMethod: str(form, "dispatchMethod"), dispatchedOn: optStr(form, "dispatchedOn"),
    });
    return withNotice(recPath(id), NOTICES[action]);
  });
}

export async function noteAction(form: FormData) {
  const id = str(form, "id");
  return act(recPath(id), async () => {
    const member = await requireMember("correspondence.view");
    await addCorrespondenceNote(member, id, str(form, "note"));
    return withNotice(recPath(id), "Note added.");
  });
}

export async function attachAction(form: FormData) {
  const id = str(form, "id");
  return act(recPath(id), async () => {
    const member = await requireMember("correspondence.register");
    const file = upload(form, "file");
    if (!file) throw new Error("Choose a file to attach");
    await addCorrespondenceAttachment(member, id, str(form, "title"), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return withNotice(recPath(id), "Attachment added.");
  });
}
