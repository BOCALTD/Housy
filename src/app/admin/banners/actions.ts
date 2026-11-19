"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { moveBanner, removeBanner, saveBanner, setBannerActive, setPromoLayout } from "@/lib/services/banners";

const BACK = "/admin/banners";
const fileBytes = async (form: FormData, key: string) => {
  const f = form.get(key);
  return f instanceof File && f.size > 0 ? new Uint8Array(await f.arrayBuffer()) : null;
};

export async function layoutAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const on = str(form, "on") === "on";
    const undo = await setPromoLayout(a.id, on);
    return withNotice(BACK, on ? "Promo layout switched on. Banners and festive offers show again." : "Promo layout switched off. No banners or festive offers show; promotion prices on properties stay.", undo);
  });
}

export async function saveBannerAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const id = str(form, "id") || null;
    await saveBanner(a.id, id, {
      title: str(form, "title"), linkUrl: str(form, "linkUrl"), places: form.getAll("places").map(String) as never,
      fold: str(form, "fold") as never, float: form.get("float") === "on", startsAt: str(form, "startsAt"), endsAt: str(form, "endsAt"),
    }, { desktop: await fileBytes(form, "desktop"), mobile: await fileBytes(form, "mobile"), dropMobile: form.get("dropMobile") === "on" });
    return withNotice(BACK, id ? "Banner saved." : "Banner added. It shows in the places you chose while the promo layout is on.");
  });
}

export async function bannerActiveAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const on = str(form, "on") === "on";
    const undo = await setBannerActive(a.id, str(form, "id"), on);
    return withNotice(BACK, on ? "Banner showing." : "Banner hidden.", undo);
  });
}

export async function removeBannerAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const undo = await removeBanner(a.id, str(form, "id"));
    return withNotice(BACK, "Banner removed.", undo);
  });
}

export async function moveBannerAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    await moveBanner(a.id, str(form, "id"), str(form, "dir") === "up" ? "up" : "down");
    return BACK;
  });
}
