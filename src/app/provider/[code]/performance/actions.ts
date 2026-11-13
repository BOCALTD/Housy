"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { providerContext } from "@/lib/services/verification-network";
import { respondToComplaint } from "@/lib/services/verification-quality";

export async function respondAction(form: FormData) {
  const code = str(form, "code");
  const page = `/provider/${encodeURIComponent(code)}/performance`;
  return act(page, async () => {
    const user = await requireUser();
    const ctx = await providerContext(user.id, code);
    if (!ctx) throw new Error("You are not a member of this organisation.");
    await respondToComplaint(ctx, str(form, "complaint"), str(form, "response"));
    return withNotice(page, "Your account was sent to Housy.");
  });
}
