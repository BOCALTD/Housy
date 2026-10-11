"use server";

import { act, str, withNotice } from "@/lib/forms";
import { withdrawLead } from "@/lib/services/verification";

export async function withdrawAction(form: FormData) {
  const ref = str(form, "ref");
  const t = str(form, "t");
  const back = `/verification/${encodeURIComponent(ref)}?t=${encodeURIComponent(t)}`;
  return act(back, async () => {
    await withdrawLead(ref, t);
    return withNotice(back, "Your request was withdrawn.");
  });
}
