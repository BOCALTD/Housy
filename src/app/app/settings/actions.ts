"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { closeWorkspace, pauseWorkspace } from "@/lib/services/workspace-lifecycle";
import { addDepartment, setMemberDepartment, updateReminderSettings, updateRefPrefix } from "@/lib/services/settings";

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

export async function reminderSettingsAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await updateReminderSettings(member, { leadDays: str(form, "leadDays"), escalationDays: str(form, "escalationDays") });
    return withNotice("/app/settings", "Reminder settings saved.");
  });
}

export async function pauseWorkspaceAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await pauseWorkspace(member, str(form, "note"));
    return withNotice("/suspended", "Workspace paused. Resume it here whenever you are ready.");
  });
}

export async function closeWorkspaceAction(form: FormData) {
  return act("/app/settings", async () => {
    const member = await requireMember("settings.manage");
    await closeWorkspace(member, { reason: str(form, "reason"), confirm: str(form, "confirm"), password: String(form.get("password") ?? "") });
    return withNotice("/suspended", "The workspace is closed.");
  });
}
