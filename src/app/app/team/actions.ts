"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { changeMemberRole, inviteMember } from "@/lib/services/companies";
import type { Role } from "@/lib/permissions";

export async function inviteAction(form: FormData) {
  return act("/app/team", async () => {
    const member = await requireMember("team.manage");
    const token = await inviteMember(member, { email: str(form, "email"), role: str(form, "role") as Role });
    // No email provider is configured yet, so the link is shown once to the administrator to share.
    return `/app/team?invite=${encodeURIComponent(token)}`;
  });
}

export async function updateMemberAction(form: FormData) {
  return act("/app/team", async () => {
    const member = await requireMember("team.manage");
    const status = str(form, "status") === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await changeMemberRole(member, str(form, "membershipId"), str(form, "role") as Role, status);
    return withNotice("/app/team", "Member updated.");
  });
}
