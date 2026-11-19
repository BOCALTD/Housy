"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { cancelBulk, sendBulk } from "@/lib/services/bulk-messaging";

const BACK = "/app/bulk-messages";

export async function sendBulkAction(form: FormData) {
  return act(BACK, async () => {
    const m = await requireMember("message.bulk");
    const b = await sendBulk(m, { audience: str(form, "audience") as never, assetId: str(form, "assetId"), subject: str(form, "subject"), body: str(form, "body") });
    return withNotice(BACK, `Sending to ${b.recipients.toLocaleString("en-NG")} ${b.recipients === 1 ? "person" : "people"}. It goes out over the next few minutes.`);
  });
}

export async function cancelBulkAction(form: FormData) {
  return act(BACK, async () => {
    const n = await cancelBulk(await requireMember("message.bulk"), str(form, "bulkId"));
    return withNotice(BACK, n ? `Stopped. ${n.toLocaleString("en-NG")} emails will not be sent.` : "Stopped. Everything had already been sent.");
  });
}
