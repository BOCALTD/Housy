"use server";

import { requireMember } from "@/lib/auth";
import { act, withNotice } from "@/lib/forms";
import { ACCOUNTS } from "@/lib/accounting-rules";
import { saveAccountingCodes } from "@/lib/services/accounting";

export async function saveCodesAction(form: FormData) {
  return act("/app/reports/accounting", async () => {
    const member = await requireMember("settings.manage");
    const raw = Object.fromEntries(Object.keys(ACCOUNTS).map((k) => [k, String(form.get(k) ?? "")]));
    await saveAccountingCodes(member, raw);
    return withNotice("/app/reports/accounting", "Account codes saved. The next export uses them.");
  });
}
