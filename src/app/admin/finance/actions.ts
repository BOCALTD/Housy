"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { adjust } from "@/lib/services/finance";

export async function adjustAction(form: FormData) {
  return act("/admin/finance", async () => {
    const a = await requirePlatformAdmin();
    await adjust(a.id, { ledger: str(form, "ledger"), account: str(form, "account"), amount: str(form, "amount"), note: str(form, "note") });
    return withNotice("/admin/finance", "Correction entered in the books.");
  });
}
