"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { addStarterPosts, deletePost, savePost, unpublishPost } from "@/lib/services/blog";

const BACK = "/admin/blog";

export async function savePostAction(form: FormData) {
  const id = str(form, "id");
  return act(id ? `${BACK}/${id}` : `${BACK}/new`, async () => {
    const a = await requirePlatformAdmin();
    const f = form.get("cover");
    const cover = f instanceof File && f.size > 0 ? { type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    const publish = str(form, "intent") === "publish";
    const p = await savePost(a.id, a.name || "Housy team", id || null, {
      title: str(form, "title"), slug: str(form, "slug"), excerpt: str(form, "excerpt"), body: str(form, "body"), category: str(form, "category"),
      tags: str(form, "tags"), coverAlt: str(form, "coverAlt"), featured: form.get("featured") === "on", publish,
    }, cover);
    revalidatePath("/blog"); revalidatePath(`/blog/${p.slug}`); revalidatePath("/sitemap.xml");
    return withNotice(`${BACK}/${p.id}`, publish ? "Published. It is live on the blog and in the sitemap." : "Draft saved.");
  });
}

export async function unpublishAction(form: FormData) {
  const id = str(form, "id");
  return act(`${BACK}/${id}`, async () => {
    const a = await requirePlatformAdmin();
    await unpublishPost(a.id, id);
    revalidatePath("/blog");
    return withNotice(`${BACK}/${id}`, "Taken off the blog. It is a draft again.");
  });
}

export async function deletePostAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    if (form.get("confirm") !== "on") throw new Error("Tick the box to confirm deleting the post");
    await deletePost(a.id, str(form, "id"));
    revalidatePath("/blog");
    return withNotice(BACK, "Post deleted.");
  });
}

export async function startersAction() {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const n = await addStarterPosts(a.id, a.name || "Housy team");
    return withNotice(BACK, n ? `${n} starter guide${n === 1 ? "" : "s"} added as drafts. Add a cover to each, read it through, then publish.` : "The starter guides are already here.");
  });
}
