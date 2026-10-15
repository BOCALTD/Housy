"use server";

import { currentActor } from "@/lib/collab-session";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { blockUser, reportMessage, requestInspection, respondInspection, sendMessage, sendPropertyCard, startConversation, unblockUser } from "@/lib/services/messaging";

async function inThread(form: FormData, notice: string | null, body: (a: Awaited<ReturnType<typeof currentActor>>["actor"], id: string) => Promise<unknown>) {
  const { actor } = await currentActor();
  const id = str(form, "id");
  const back = `/messages/${encodeURIComponent(id)}`;
  return act(back, async () => {
    await body(actor, id);
    return notice ? withNotice(back, notice) : back;
  });
}

export async function startAction(form: FormData) {
  const { actor } = await currentActor();
  const to = str(form, "toUserId");
  const collab = optStr(form, "collaborationId");
  const here = `/messages/new?to=${encodeURIComponent(to)}${collab ? `&collab=${encodeURIComponent(collab)}` : ""}`;
  return act(here, async () => {
    const c = await startConversation(actor, { toUserId: to, subject: str(form, "subject"), body: str(form, "body"), collaborationId: collab });
    return `/messages/${c.id}`;
  });
}

export const sendAction = async (form: FormData) => inThread(form, null, (a, id) => sendMessage(a, id, str(form, "body"), optStr(form, "replyToId")));
export const cardAction = async (form: FormData) => inThread(form, "Property shared.", (a, id) => sendPropertyCard(a, id, str(form, "listingRef"), str(form, "note")));
export const inspectAction = async (form: FormData) => inThread(form, "Inspection request sent.", (a, id) => requestInspection(a, id, { listingRef: optStr(form, "listingRef"), date: str(form, "date"), time: str(form, "time"), note: str(form, "note") }));
export const inspectReplyAction = async (form: FormData) => inThread(form, "Answer sent.", (a) => respondInspection(a, str(form, "requestId"), str(form, "decision") === "accept" ? "accept" : "decline", str(form, "note")));
export const reportAction = async (form: FormData) => inThread(form, "Thank you. The platform will look at it.", (a) => reportMessage(a, str(form, "messageId"), str(form, "reason")));
export const blockAction = async (form: FormData) => inThread(form, "Blocked. They can no longer message you.", (a) => blockUser(a, str(form, "userId")));
export const unblockAction = async (form: FormData) => inThread(form, "Unblocked.", (a) => unblockUser(a, str(form, "userId")));
