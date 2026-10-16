"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { openAwardDispute } from "@/lib/services/awards";

export async function awardDisputeAction(form: FormData) {
  const back = `/awards/${str(form, "month")}`;
  return act(back, async () => { const u = await requireUser(); await openAwardDispute(u.id, str(form, "runId"), str(form, "reason")); return withNotice(back, "Your dispute was sent to the platform team."); });
}
