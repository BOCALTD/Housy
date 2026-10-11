"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { addDepartment, setMemberDepartment, updateRefPrefix } from "@/lib/services/settings";

export async function prefixAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await updateRefPrefix(member, str(form, "refPrefix"));
    return withNotice("/app/settings", "Reference prefix saved. New correspondence uses it.");
  });
}

export async function departmentAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await addDepartment(member, { name: str(form, "name"), code: str(form, "code") });
    return withNotice("/app/settings", "Department added.");
  });
}

export async function memberDepartmentAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await setMemberDepartment(member, str(form, "membershipId"), optStr(form, "departmentId") ?? null);
    return withNotice("/app/settings", "Member updated.");
  });
}
