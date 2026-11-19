"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { MEDIA_PROVIDERS, saveMediaConfig, type MediaProvider } from "@/lib/media-store";

export async function mediaAction(form: FormData) {
  return act("/admin/settings", async () => {
    const a = await requirePlatformAdmin();
    const p = str(form, "provider");
    const provider = ((MEDIA_PROVIDERS as readonly string[]).includes(p) ? p : "db") as MediaProvider;
    await saveMediaConfig(a.id, { provider, endpoint: str(form, "endpoint"), region: str(form, "region"), bucket: str(form, "bucket"), accessKey: str(form, "accessKey"), secret: str(form, "secret") });
    return withNotice("/admin/settings", provider === "db" ? "New videos are kept in the database." : provider === "disk" ? "Checked: new videos are kept in the server folder." : "Checked: new videos are kept in the bucket.");
  });
}
