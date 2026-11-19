"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { cleanSlug, discardLegalDraft, publishLegal, saveLegalDraft } from "@/lib/services/legal-pages";

export async function newLegalPageAction(form: FormData) {
  return act("/admin/legal", async () => {
    await requirePlatformAdmin();
    return `/admin/legal/${cleanSlug(str(form, "slug"))}`;
  });
}

export async function saveLegalAction(form: FormData) {
  const slug = str(form, "slug");
  const back = `/admin/legal/${encodeURIComponent(slug)}`;
  return act(back, async () => {
    const a = await requirePlatformAdmin();
    const d = { title: str(form, "title"), summary: str(form, "summary"), body: String(form.get("body") ?? ""), changeNote: str(form, "changeNote"), material: form.get("material") === "on", effectiveFrom: str(form, "effectiveFrom") };
    const row = await saveLegalDraft(a.id, slug, d);
    if (str(form, "intent") === "publish") {
      const p = await publishLegal(a.id, slug);
      revalidatePath(`/legal/${p.slug}`); revalidatePath("/legal");
      return withNotice(back, `Version ${p.version} published${p.effectiveFrom ? `; it takes effect on the date you set` : ""}.${p.material ? " Signed-in people will be asked to agree again once it is in effect." : ""}`);
    }
    return withNotice(back, `Draft of version ${row.version} saved. Only administrators can see it until you publish it.`);
  });
}

export async function discardLegalAction(form: FormData) {
  const slug = str(form, "slug");
  return act(`/admin/legal/${encodeURIComponent(slug)}`, async () => {
    const a = await requirePlatformAdmin();
    await discardLegalDraft(a.id, slug);
    return withNotice("/admin/legal", "Draft discarded.");
  });
}
