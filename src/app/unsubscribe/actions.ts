"use server";

import { redirect } from "next/navigation";
import { str } from "@/lib/forms";
import { applyUnsubscribe } from "@/lib/services/delivery";

export async function unsubscribeAction(form: FormData) {
  const scope = await applyUnsubscribe(str(form, "t"));
  redirect(scope ? `/unsubscribe?done=${scope}` : "/unsubscribe");
}
