"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  addBranch, addClientActivity, addLeadSource, addRequirement, addTeam, archiveClient, assignLead, completeFollowUp, createClient, createLead, createLeadFromEnquiry,
  dismissDuplicate, mergeClients, reassignClient, setLeadSourceActive, setLeadStatus, setMatchStatus, setMemberPlacement, setRequirementActive, setTeamLead,
  updateClient, updateQualification,
} from "@/lib/services/crm";

const client = (id: string) => `/app/crm/clients/${encodeURIComponent(id)}`;
const flag = (form: FormData, name: string) => form.get(name) === "on";

function clientFields(form: FormData) {
  return {
    kind: (optStr(form, "kind") ?? "INDIVIDUAL") as never, name: str(form, "name"), email: str(form, "email"), phone: str(form, "phone"), address: str(form, "address"),
    city: str(form, "city"), notes: str(form, "notes"), confidential: flag(form, "confidential"), marketingConsent: flag(form, "marketingConsent"), notDuplicate: flag(form, "notDuplicate"),
    ownerId: optStr(form, "ownerId"),
  };
}

export async function createClientAction(form: FormData) {
  return act("/app/crm/clients", async () => {
    const member = await requireMember("crm.manage");
    const c = await createClient(member, clientFields(form));
    return withNotice(client(c.id), `${c.ref} created.`);
  });
}

export async function updateClientAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await updateClient(member, id, clientFields(form));
    return withNotice(client(id), "Saved.");
  });
}

export async function archiveClientAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    const restore = optStr(form, "restore") === "yes";
    await archiveClient(member, id, restore);
    return withNotice(client(id), restore ? "Client restored." : "Client archived.");
  });
}

export async function reassignClientAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.assign");
    await reassignClient(member, id, str(form, "ownerId"), str(form, "reason"));
    return withNotice(client(id), "Client reassigned.");
  });
}

export async function dismissDuplicateAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await dismissDuplicate(member, id, str(form, "otherId"));
    return withNotice(client(id), "Marked as different clients.");
  });
}

export async function mergeClientsAction(form: FormData) {
  const keep = str(form, "clientId");
  return act(client(keep), async () => {
    const member = await requireMember("crm.merge");
    await mergeClients(member, keep, str(form, "otherId"));
    return withNotice(client(keep), "Clients merged.");
  });
}

export async function createLeadAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    const lead = await createLead(member, id, {
      title: str(form, "title"), sourceId: optStr(form, "sourceId"), listingId: optStr(form, "listingId"), ownerId: optStr(form, "ownerId"), budgetMax: optStr(form, "budgetMax"),
      timeline: (optStr(form, "timeline") ?? "UNKNOWN") as never, financing: (optStr(form, "financing") ?? "UNKNOWN") as never, decisionMaker: flag(form, "decisionMaker"),
    });
    return withNotice(client(id), `${lead.ref} opened.`);
  });
}

export async function makeLeadFromEnquiryAction(form: FormData) {
  return act("/app/crm", async () => {
    const member = await requireMember("crm.manage");
    const r = await createLeadFromEnquiry(member, str(form, "enquiryId"));
    return withNotice(client(r.client.id), `${r.lead.ref} opened from the enquiry.`);
  });
}

export async function updateQualificationAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await updateQualification(member, str(form, "leadId"), {
      title: str(form, "title"), budgetMax: optStr(form, "budgetMax"), timeline: (optStr(form, "timeline") ?? "UNKNOWN") as never,
      financing: (optStr(form, "financing") ?? "UNKNOWN") as never, decisionMaker: flag(form, "decisionMaker"),
    });
    return withNotice(client(id), "Qualification saved.");
  });
}

export async function leadStatusAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await setLeadStatus(member, str(form, "leadId"), str(form, "to") as never, str(form, "reason"));
    return withNotice(client(id), "Lead updated.");
  });
}

export async function assignLeadAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.assign");
    await assignLead(member, str(form, "leadId"), str(form, "ownerId"), str(form, "reason"));
    return withNotice(client(id), "Lead reassigned.");
  });
}

export async function addActivityAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await addClientActivity(member, id, {
      kind: str(form, "kind") as never, subject: str(form, "subject"), body: str(form, "body"), leadId: optStr(form, "leadId"), dueOn: optStr(form, "dueOn"), assigneeId: optStr(form, "assigneeId"),
    });
    return withNotice(client(id), "Saved.");
  });
}

export async function completeFollowUpAction(form: FormData) {
  const back = optStr(form, "back") ?? "/app/crm";
  return act(back, async () => {
    const member = await requireMember("crm.manage");
    await completeFollowUp(member, str(form, "activityId"), str(form, "outcome"));
    return withNotice(back, "Follow-up done.");
  });
}

export async function addRequirementAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await addRequirement(member, id, {
      purpose: str(form, "purpose") as never, assetClass: (optStr(form, "assetClass") ?? "") as never, city: str(form, "city"), state: str(form, "state"), bedroomsMin: optStr(form, "bedroomsMin"),
      budgetMin: optStr(form, "budgetMin"), budgetMax: str(form, "budgetMax"), notes: str(form, "notes"), leadId: optStr(form, "leadId"),
    });
    return withNotice(client(id), "Requirement saved.");
  });
}

export async function requirementActiveAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await setRequirementActive(member, str(form, "requirementId"), optStr(form, "active") === "yes");
    return withNotice(client(id), "Saved.");
  });
}

export async function matchStatusAction(form: FormData) {
  const id = str(form, "clientId");
  return act(client(id), async () => {
    const member = await requireMember("crm.manage");
    await setMatchStatus(member, str(form, "requirementId"), str(form, "listingId"), str(form, "status") as never, str(form, "note"));
    return withNotice(client(id), "Saved.");
  });
}

// Setup
export async function addSourceAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await addLeadSource(member, str(form, "name"));
    return withNotice("/app/crm/setup", "Source added.");
  });
}
export async function sourceActiveAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await setLeadSourceActive(member, str(form, "sourceId"), optStr(form, "active") === "yes");
    return withNotice("/app/crm/setup", "Saved.");
  });
}
export async function addBranchAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await addBranch(member, { name: str(form, "name"), code: str(form, "code") });
    return withNotice("/app/crm/setup", "Branch added.");
  });
}
export async function addTeamAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await addTeam(member, { name: str(form, "name"), branchId: optStr(form, "branchId"), leadId: optStr(form, "leadId") });
    return withNotice("/app/crm/setup", "Team added.");
  });
}
export async function teamLeadAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await setTeamLead(member, str(form, "teamId"), optStr(form, "leadId") ?? null);
    return withNotice("/app/crm/setup", "Saved.");
  });
}
export async function placementAction(form: FormData) {
  return act("/app/crm/setup", async () => {
    const member = await requireMember("crm.configure");
    await setMemberPlacement(member, str(form, "membershipId"), optStr(form, "branchId") ?? null, optStr(form, "teamId") ?? null);
    return withNotice("/app/crm/setup", "Saved.");
  });
}

/** Plan a follow-up from the "gone quiet" suggestions, and stay on the overview. */
export async function planFollowUpAction(form: FormData) {
  return act("/app/crm", async () => {
    const member = await requireMember("crm.manage");
    await addClientActivity(member, str(form, "clientId"), { kind: "FOLLOW_UP", subject: str(form, "subject"), body: "", leadId: optStr(form, "leadId"), dueOn: optStr(form, "dueOn") });
    return withNotice("/app/crm", "Follow-up planned.");
  });
}
