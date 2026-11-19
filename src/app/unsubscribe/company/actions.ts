"use server";

import { redirect } from "next/navigation";
import { str } from "@/lib/forms";
import { optOutBulk } from "@/lib/services/bulk-messaging";

export async function companyOptOutAction(form: FormData) {
  const t = str(form, "t");
  try { await optOutBulk(t); } catch { redirect("/unsubscribe/company"); }
  redirect(`/unsubscribe/company?t=${encodeURIComponent(t)}&done=1`);
}
