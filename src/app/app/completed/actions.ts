"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { requestDisplay, withdrawDisplay } from "@/lib/services/completed";

const BACK = "/app/completed";
export async function requestDisplayAction(form: FormData) {
  return act(BACK, async () => { await requestDisplay(await requireMember("crm.manage"), str(form, "dealId"), { statement: str(form, "statement"), confirmed: str(form, "confirmed") === "on" }); return withNotice(BACK, "Sent to the platform for checking."); });
}
export async function withdrawDisplayAction(form: FormData) {
  return act(BACK, async () => { await withdrawDisplay(await requireMember("crm.manage"), str(form, "dealId")); return withNotice(BACK, "Withdrawn. It no longer shows."); });
}
