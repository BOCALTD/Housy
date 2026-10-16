"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { disputeReward } from "@/lib/services/rewards";

export async function disputeRewardAction(form: FormData) {
  return act("/rewards", async () => {
    const user = await requireUser();
    await disputeReward(user.id, str(form, "rewardId"), str(form, "reason"));
    return withNotice("/rewards", "Your dispute was sent. An administrator who was not involved will decide.");
  });
}
