"use server";

import { currentActor } from "@/lib/collab-session";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  addComment, addParticipant, addTask, cancelInvitation, createInvitation, endCollaboration, refreshItem, respondInvitation, resumeCollaboration, revokeItem, revokeParticipant,
  sendInvitation, setTaskStatus, shareDeal, shareDocument, shareNote, shareProperty, suspendCollaboration, updateParticipant,
} from "@/lib/services/collab";

const on = (form: FormData, name: string) => form.get(name) === "on";
const perms = (form: FormData) => ({ canComment: on(form, "canComment"), canTasks: on(form, "canTasks"), canShare: on(form, "canShare"), canDocuments: on(form, "canDocuments"), expiresOn: optStr(form, "expiresOn") ?? null });

/** Run a workspace action and come back to that workspace with a notice. */
async function inWorkspace(form: FormData, notice: string, body: (a: Awaited<ReturnType<typeof currentActor>>["actor"], id: string) => Promise<unknown>) {
  const { actor, base } = await currentActor();
  const id = str(form, "id");
  const back = `${base}/${encodeURIComponent(id)}`;
  return act(back, async () => {
    await body(actor, id);
    return withNotice(back, notice);
  });
}

export async function createInvitationAction(form: FormData) {
  const { actor, base } = await currentActor();
  const kind = str(form, "kind");
  return act(`${base}/new${kind === "SEEKER_AGENT" ? `?agent=${encodeURIComponent(str(form, "agentUserId"))}` : `?company=${encodeURIComponent(str(form, "companyId"))}`}`, async () => {
    const c = await createInvitation(actor, { kind: kind as never, purpose: str(form, "purpose") as never, title: str(form, "title"), scope: str(form, "scope"), terms: str(form, "terms"), endsOn: optStr(form, "endsOn"), agentUserId: optStr(form, "agentUserId"), companyId: optStr(form, "companyId") }, str(form, "intent") === "send");
    return withNotice(`${base}/${c.id}`, c.status === "PENDING" ? "Invitation sent." : "Draft saved. Send it when you are ready.");
  });
}

export const sendAction = async (form: FormData) => inWorkspace(form, "Invitation sent.", (a, id) => sendInvitation(a, id));
export const cancelAction = async (form: FormData) => inWorkspace(form, "Invitation cancelled.", (a, id) => cancelInvitation(a, id, str(form, "reason")));
export const respondAction = async (form: FormData) => inWorkspace(form, str(form, "decision") === "accept" ? "Accepted. The workspace is open." : "Declined.", (a, id) => respondInvitation(a, id, str(form, "decision") === "accept" ? "accept" : "decline", str(form, "note"), form.getAll("person").map(String)));
export const endAction = async (form: FormData) => inWorkspace(form, "Collaboration finished.", (a, id) => endCollaboration(a, id, str(form, "note")));
export const suspendAction = async (form: FormData) => inWorkspace(form, "Collaboration suspended.", (a, id) => suspendCollaboration(a, id, str(form, "reason")));
export const resumeAction = async (form: FormData) => inWorkspace(form, "Collaboration resumed.", (a, id) => resumeCollaboration(a, id));

export const addParticipantAction = async (form: FormData) => inWorkspace(form, "Access given.", (a, id) => addParticipant(a, id, str(form, "userId"), perms(form)));
export const updateParticipantAction = async (form: FormData) => inWorkspace(form, "Access changed.", (a) => updateParticipant(a, str(form, "participantId"), perms(form)));
export const revokeParticipantAction = async (form: FormData) => inWorkspace(form, "Access removed.", (a) => revokeParticipant(a, str(form, "participantId"), str(form, "reason")));

export const sharePropertyAction = async (form: FormData) => inWorkspace(form, "Property shared.", (a, id) => shareProperty(a, id, { listingRef: optStr(form, "listingRef"), assetId: optStr(form, "assetId"), address: on(form, "address"), price: on(form, "price"), note: str(form, "note") }));
export const shareDealAction = async (form: FormData) => inWorkspace(form, "Deal summary shared.", (a, id) => shareDeal(a, id, { dealId: str(form, "dealId"), stage: on(form, "stage"), asking: on(form, "asking"), agreed: on(form, "agreed"), expectedClose: on(form, "expectedClose"), propertyAddress: on(form, "propertyAddress"), note: str(form, "note") }));
export const shareNoteAction = async (form: FormData) => inWorkspace(form, "Note shared.", (a, id) => shareNote(a, id, { title: str(form, "title"), body: str(form, "body") }));
export const shareDocumentAction = async (form: FormData) =>
  inWorkspace(form, "Document shared.", async (a, id) => {
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose a file");
    await shareDocument(a, id, str(form, "title"), { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
  });
export const refreshItemAction = async (form: FormData) => inWorkspace(form, "Updated.", (a) => refreshItem(a, str(form, "itemId")));
export const revokeItemAction = async (form: FormData) => inWorkspace(form, "Taken back. The other side can no longer read it.", (a) => revokeItem(a, str(form, "itemId"), str(form, "reason")));

export const addTaskAction = async (form: FormData) => inWorkspace(form, "Added.", (a, id) => addTask(a, id, { title: str(form, "title"), description: str(form, "description"), milestone: on(form, "milestone"), assigneeId: optStr(form, "assigneeId"), dueOn: optStr(form, "dueOn") }));
export const taskStatusAction = async (form: FormData) => inWorkspace(form, "Saved.", (a) => setTaskStatus(a, str(form, "taskId"), str(form, "status") as never, str(form, "outcome")));
export const commentAction = async (form: FormData) => inWorkspace(form, "Comment added.", (a, id) => addComment(a, id, str(form, "body"), optStr(form, "itemId")));
