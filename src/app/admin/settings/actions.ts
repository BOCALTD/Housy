"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  CAPTCHA_PLACES, COMMISSION_KINDS, saveCaptcha, saveCloudflare, saveCommission, savePaystackKeys, type CaptchaPlace, type CaptchaProvider, type CommissionKind,
} from "@/lib/services/platform-config";

const PAGE = "/admin/settings";

export async function paystackAction(form: FormData) {
  const clear = str(form, "clear") === "1";
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    await savePaystackKeys(a.id, { secret: str(form, "secret"), public: str(form, "public"), clear });
    return withNotice(PAGE, clear ? "The saved Paystack keys were removed." : "Paystack keys saved. Make one small real payment to prove them.");
  });
}
export async function captchaAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const places = form.getAll("places").map(String).filter((p): p is CaptchaPlace => (CAPTCHA_PLACES as readonly string[]).includes(p));
    await saveCaptcha(a.id, { provider: str(form, "provider") as CaptchaProvider, siteKey: str(form, "siteKey"), secret: str(form, "secret"), places });
    return withNotice(PAGE, str(form, "provider") === "none" ? "The person check is off." : "Person check saved. Open the sign-in page in a private window to see it.");
  });
}
export async function cloudflareAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    await saveCloudflare(a.id, form.get("trust") === "on");
    return withNotice(PAGE, "Cloudflare setting saved.");
  });
}
export async function commissionAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    await saveCommission(a.id, Object.fromEntries(COMMISSION_KINDS.map((k) => [k, str(form, k)])) as Record<CommissionKind, string>);
    return withNotice(PAGE, "Commission saved. It applies to payments made from now on.");
  });
}
