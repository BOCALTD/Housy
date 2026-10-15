"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  cancelDeal, cancelViewing, completeDeal, counterOffer, createDeal, decideAcceptance, moveStage, raiseDispute, reassignDeal, recordOffer, recordViewingOutcome, reopenNegotiation,
  rejectOffer, requestAcceptance, rescheduleViewing, resolveDispute, scheduleViewing, setHold, withdrawAcceptanceRequest, withdrawOffer,
} from "@/lib/services/deal";

const deal = (id: string) => `/app/deals/${encodeURIComponent(id)}`;

export async function createDealAction(form: FormData) {
  const clientId = str(form, "clientId");
  return act(`/app/crm/clients/${encodeURIComponent(clientId)}`, async () => {
    const member = await requireMember("crm.manage");
    const d = await createDeal(member, {
      clientId, leadId: optStr(form, "leadId"), assetId: str(form, "assetId"), type: optStr(form, "type") as never, title: str(form, "title"), asking: optStr(form, "asking"),
      expectedCloseOn: optStr(form, "expectedCloseOn"), ownerId: optStr(form, "ownerId"),
    });
    return withNotice(deal(d.id), `${d.ref} opened.`);
  });
}

const run = (field: string, notice: string, perm: "crm.manage" | "crm.approve" | "crm.assign", fn: (m: Awaited<ReturnType<typeof requireMember>>, form: FormData, id: string) => Promise<unknown>) =>
  async (form: FormData) => {
    const id = str(form, "dealId");
    return act(deal(id), async () => {
      const member = await requireMember(perm);
      await fn(member, form, str(form, field));
      return withNotice(deal(id), notice);
    });
  };

export const moveStageAction = run("dealId", "Stage updated.", "crm.manage", (m, f, id) => moveStage(m, id, str(f, "to") as never, str(f, "reason")));
export const holdAction = run("dealId", "Saved.", "crm.manage", (m, f, id) => setHold(m, id, optStr(f, "hold") === "yes", str(f, "reason")));
export const cancelDealAction = run("dealId", "Deal cancelled.", "crm.manage", (m, f, id) => cancelDeal(m, id, str(f, "reason")));
export const disputeAction = run("dealId", "Dispute recorded.", "crm.manage", (m, f, id) => raiseDispute(m, id, str(f, "reason")));
export const resolveDisputeAction = run("dealId", "Dispute settled.", "crm.approve", (m, f, id) => resolveDispute(m, id, str(f, "outcome"), optStr(f, "then") === "cancel" ? "cancel" : "resume"));
export const reassignAction = run("dealId", "Deal reassigned.", "crm.assign", (m, f, id) => reassignDeal(m, id, str(f, "ownerId"), str(f, "reason")));
export const completeAction = run("dealId", "Deal completed.", "crm.approve", (m, f, id) => completeDeal(m, id, str(f, "note")));
export const reopenAction = run("dealId", "Negotiation reopened.", "crm.approve", (m, f, id) => reopenNegotiation(m, id, str(f, "reason")));

export const scheduleViewingAction = run("dealId", "Viewing booked.", "crm.manage", (m, f, id) =>
  scheduleViewing(m, id, { date: str(f, "date"), time: str(f, "time"), minutes: str(f, "minutes"), agentId: optStr(f, "agentId"), meetingPoint: str(f, "meetingPoint") }));
export const rescheduleViewingAction = run("viewingId", "Viewing moved.", "crm.manage", (m, f, id) => rescheduleViewing(m, id, { date: str(f, "date"), time: str(f, "time"), minutes: str(f, "minutes") }));
export const cancelViewingAction = run("viewingId", "Viewing cancelled.", "crm.manage", (m, f, id) => cancelViewing(m, id, str(f, "reason")));
export const viewingOutcomeAction = run("viewingId", "Saved.", "crm.manage", (m, f, id) => recordViewingOutcome(m, id, str(f, "result") as never, str(f, "outcome")));

const offerFields = (f: FormData) => ({ amount: str(f, "amount"), conditions: str(f, "conditions"), validUntil: optStr(f, "validUntil"), note: str(f, "note") });
export const recordOfferAction = run("dealId", "Offer recorded.", "crm.manage", (m, f, id) => recordOffer(m, id, { ...offerFields(f), side: str(f, "side") as never }));
export const counterOfferAction = run("offerId", "Counteroffer recorded.", "crm.manage", (m, f, id) => counterOffer(m, id, offerFields(f)));
export const rejectOfferAction = run("offerId", "Offer rejected.", "crm.manage", (m, f, id) => rejectOffer(m, id, str(f, "reason")));
export const withdrawOfferAction = run("offerId", "Offer withdrawn.", "crm.manage", (m, f, id) => withdrawOffer(m, id, str(f, "note")));
export const requestAcceptanceAction = run("offerId", "Sent for approval.", "crm.manage", (m, _f, id) => requestAcceptance(m, id));
export const withdrawAcceptanceAction = run("offerId", "Request withdrawn.", "crm.manage", (m, _f, id) => withdrawAcceptanceRequest(m, id));
export const decideAcceptanceAction = run("offerId", "Decision recorded.", "crm.approve", (m, f, id) => decideAcceptance(m, id, optStr(f, "decision") === "approve" ? "approve" : "reject", str(f, "note")));
