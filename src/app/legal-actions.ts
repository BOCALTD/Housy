"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { acceptLegal } from "@/lib/services/legal-pages";
import { safeLocalPath } from "@/lib/security";

/** The signed-in person agrees to the updated terms and privacy policy. */
export async function acceptLegalAction(form: FormData) {
  const u = await requireUser();
  await acceptLegal(u.id);
  revalidatePath("/", "layout");
  const back = safeLocalPath(String(form.get("back") ?? ""), "") || (await headers()).get("x-housy-path") || "/";
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent("Thank you. Your agreement is recorded.")}`);
}
