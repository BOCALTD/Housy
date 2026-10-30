"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { addTrack, setTrackActive } from "@/lib/services/music";

const BACK = "/admin/music";
export async function addTrackAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose the audio file");
    await addTrack(a.id, {
      title: str(form, "title"), artist: str(form, "artist"), genre: str(form, "genre") as never, licenceName: str(form, "licenceName"),
      licenceSource: str(form, "licenceSource"), licenceNote: str(form, "licenceNote"), creditRequired: form.get("creditRequired") === "on", confirmed: (form.get("confirmed") === "on") as true,
    }, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
    return withNotice(BACK, "Track added. Agents can choose it when they post a reel.");
  });
}
export async function trackActiveAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const on = str(form, "on") === "yes";
    await setTrackActive(a.id, str(form, "id"), on);
    return withNotice(BACK, on ? "Track switched back on." : "Track withdrawn. It can no longer be chosen, and reels that play it alongside stop playing it.");
  });
}
