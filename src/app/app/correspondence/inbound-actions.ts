"use server";

import { requireMember } from "@/lib/auth";
import { act, withNotice } from "@/lib/forms";
import { companyInboundAddress } from "@/lib/services/inbound-email";

export async function newInboundAddressAction() {
  return act("/app/correspondence", async () => {
    const m = await requireMember("settings.manage");
    await companyInboundAddress(m, true);
    return withNotice("/app/correspondence", "New address made. The old one no longer works.");
  });
}
