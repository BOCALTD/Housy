"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { providerContext } from "@/lib/services/verification-network";
import { setPayoutDetails } from "@/lib/services/verification-finance";

export async function payoutDetailsAction(form: FormData) {
  const code = str(form, "code");
  const page = `/provider/${encodeURIComponent(code)}/finance`;
  return act(page, async () => {
    const user = await requireUser();
    const ctx = await providerContext(user.id, code);
    if (!ctx) throw new Error("You are not a member of this organisation.");
    const keys = ["country", "bankName", "accountName", "accountNumber", "routingNumber", "sortCode", "institutionNumber", "transitNumber", "iban", "bic", "bsb"];
    await setPayoutDetails(ctx, Object.fromEntries(keys.map((k) => [k, str(form, k)])));
    return withNotice(page, "Payout bank account saved. Everyone who handles your organisation's money has been told.");
  });
}
