"use server";

import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { TARGET_KINDS, openCase, replyToCase } from "@/lib/services/trust-cases";

export async function openCaseAction(form: FormData) {
  return act("/trust", async () => {
    const u = await requireUser();
    const files = form.getAll("evidence").filter((f): f is File => f instanceof File && f.size > 0);
    const evidence = await Promise.all(files.map(async (f) => ({ type: f.type, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const kind = str(form, "targetKind");
    const ref = await openCase(u.id, { category: str(form, "category"), targetKind: ((TARGET_KINDS as readonly string[]).includes(kind) ? kind : "OTHER") as never, targetRef: str(form, "targetRef"), description: str(form, "description") }, evidence);
    return withNotice(`/trust/reports/${ref}`, "Report received. You will see updates here and in your notifications.");
  });
}

export async function replyCaseAction(form: FormData) {
  const ref = str(form, "ref");
  return act(`/trust/reports/${encodeURIComponent(ref)}`, async () => {
    const u = await requireUser();
    await replyToCase(u.id, ref, str(form, "body"));
    return withNotice(`/trust/reports/${encodeURIComponent(ref)}`, "Sent.");
  });
}
