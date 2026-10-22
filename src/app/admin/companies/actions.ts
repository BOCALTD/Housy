"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { openCompanyRecords, restoreCompany, suspendCompany } from "@/lib/services/governance";

const path = (id: string) => `/admin/companies/${encodeURIComponent(id)}`;

export async function suspendCompanyAction(form: FormData) {
  const id = str(form, "id");
  return act(path(id), async () => {
    const admin = await requirePlatformAdmin();
    if (str(form, "confirm") !== "yes") throw new Error("Tick the box to confirm");
    await suspendCompany(admin.id, id, { reason: str(form, "reason") });
    return withNotice(path(id), "Company suspended. Its administrators have been told why.");
  });
}
export async function restoreCompanyAction(form: FormData) {
  const id = str(form, "id");
  return act(path(id), async () => {
    const admin = await requirePlatformAdmin();
    await restoreCompany(admin.id, id, str(form, "note"));
    return withNotice(path(id), "Company restored.");
  });
}
export async function openRecordsAction(form: FormData) {
  const id = str(form, "id");
  return act(path(id), async () => {
    const admin = await requirePlatformAdmin();
    await openCompanyRecords(admin.id, id, { purpose: str(form, "purpose"), caseRef: str(form, "caseRef"), note: str(form, "note") });
    return withNotice(`${path(id)}#records`, "Records open for one hour. The company's administrators have been told.");
  });
}
