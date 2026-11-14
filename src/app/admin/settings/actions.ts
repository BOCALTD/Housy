"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  CAPTCHA_PLACES, COMMISSION_KINDS, saveCaptcha, saveCloudflare, saveCommission, savePaystackKeys, savePaymentRoutes, saveStripeKeys, saveLiveChat, saveWatermark, configForAdmin, LIVE_CHAT_PLACES, type LiveChatPlace, type LiveChatProvider, type CaptchaPlace, type CaptchaProvider, type CommissionKind,
} from "@/lib/services/platform-config";

import { endMaintenance, scheduleMaintenance } from "@/lib/services/maintenance-mode";
import { formatDateTime } from "@/lib/dates";

const PAGE = "/admin/settings";

export async function maintenanceAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const emergency = str(form, "emergency") === "1";
    const r = await scheduleMaintenance(a.id, { start: str(form, "start"), end: str(form, "end"), message: str(form, "message"), emergency });
    return withNotice(PAGE, emergency ? `Maintenance scheduled from ${formatDateTime(r.start)}. Everyone is being told now.` : `Maintenance scheduled from ${formatDateTime(r.start)}. Everyone is told 24 hours before.`);
  });
}

export async function endMaintenanceAction() {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const r = await endMaintenance(a.id);
    return withNotice(PAGE, r === "ended" ? "Maintenance ended. The site is open to everyone." : "The planned maintenance is cancelled.");
  });
}

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

export async function stripeAction(form: FormData) {
  const clear = str(form, "clear") === "1";
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    await saveStripeKeys(a.id, { secret: str(form, "secret"), public: str(form, "public"), webhook: str(form, "webhook"), clear });
    return withNotice(PAGE, clear ? "The saved Stripe keys were removed." : "Stripe keys saved. Make one small real payment to prove them.");
  });
}

export async function routesAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const routes: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("route_") && typeof v === "string") routes[k.slice(6)] = v;
    await savePaymentRoutes(a.id, routes);
    return withNotice(PAGE, "Payment method for each country saved.");
  });
}

export async function liveChatAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const places = form.getAll("places").filter((p): p is LiveChatPlace => typeof p === "string" && (LIVE_CHAT_PLACES as readonly string[]).includes(p));
    const provider = str(form, "provider") as LiveChatProvider;
    await saveLiveChat(a.id, { provider, id: str(form, "id"), places });
    return withNotice(PAGE, provider === "none" ? "Live chat is off." : "Live chat saved. Open the site in another browser to try the Chat button.");
  });
}

export async function watermarkSwitchAction(form: FormData) {
  const housy = str(form, "housy") === "1";
  const scope = str(form, "scope") === "new" ? "new" : "all";
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const position = (await configForAdmin()).watermark.position;
    const r = await saveWatermark(a.id, { housy, position, scope });
    return withNotice(PAGE, scope === "all"
      ? `Housy's mark is ${housy ? "on" : "off"} for all properties (${r.changed} already posted) and new ones.`
      : `Housy's mark is ${housy ? "on" : "off"} for properties posted from now on. Those already posted are unchanged.`);
  });
}

export async function watermarkPositionAction(form: FormData) {
  return act(PAGE, async () => {
    const a = await requirePlatformAdmin();
    const housy = (await configForAdmin()).watermark.housy;
    await saveWatermark(a.id, { housy, position: str(form, "position"), scope: "new" });
    return withNotice(PAGE, "Position saved.");
  });
}
