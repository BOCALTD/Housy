"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeLocalPath } from "@/lib/security";
import { confirmIdentity } from "@/lib/services/reauth";

export async function confirmAction(form: FormData) {
  const back = safeLocalPath(String(form.get("back") ?? ""), "/") || "/";
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(back)}`);
  const r = await confirmIdentity(session.id, String(form.get("password") ?? ""), String(form.get("code") ?? ""));
  if (r.ok) redirect(back);
  if (r.signedOut) {
    (await cookies()).delete("sid");
    redirect(`/login?next=${encodeURIComponent(back)}&error=${encodeURIComponent(r.error)}`);
  }
  redirect(`/confirm?back=${encodeURIComponent(back)}&error=${encodeURIComponent(r.error)}`);
}
