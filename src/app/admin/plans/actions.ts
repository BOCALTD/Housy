"use server";

import { CURRENCY_CODES } from "@/lib/regions";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { assignSubscription, cancelSubscription, renewSubscription, savePlan, setPlanEntitlements, setPlanPrices } from "@/lib/services/subscriptions";
import { savePromoCode, setPromoActive } from "@/lib/services/upgrades";
import { saveSettings, saveYearlyMonths } from "@/lib/services/platform-settings";
import { ENTITLEMENT_KEYS } from "@/lib/subscription-rules";

const BACK = "/admin/plans";

export async function savePlanAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    const id = optStr(form, "id") ?? null;
    const plan = await savePlan(admin.id, id, {
      code: str(form, "code"), name: str(form, "name"), audience: str(form, "audience") as never, price: str(form, "price"),
      billingPeriod: str(form, "billingPeriod") as never, trialDays: str(form, "trialDays") as never, graceDays: str(form, "graceDays") as never, readOnlyDays: str(form, "readOnlyDays") as never,
      active: str(form, "active") === "on", sortOrder: (str(form, "sortOrder") || "100") as never, tier: (str(form, "tier") || "BASIC") as never,
    });
    await setPlanEntitlements(admin.id, plan.id, ENTITLEMENT_KEYS.map((key) => ({ key, enabled: str(form, `on_${key}`) === "on", limit: str(form, `limit_${key}`) })));
    if (form.has("cur_USD")) await setPlanPrices(admin.id, plan.id, Object.fromEntries(CURRENCY_CODES.filter((c) => c !== "NGN").map((c) => [c, str(form, `cur_${c}`)])));
    return withNotice(BACK, "Plan saved.");
  });
}

export async function assignAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    await assignSubscription(admin.id, { planId: str(form, "planId"), periodEnd: str(form, "periodEnd"), trial: str(form, "trial") === "on", note: str(form, "note"), email: optStr(form, "email"), companyId: optStr(form, "companyId") });
    return withNotice(BACK, "Subscription saved.");
  });
}

export async function renewAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    await renewSubscription(admin.id, str(form, "subscriptionId"), str(form, "periodEnd"), str(form, "note"));
    return withNotice(BACK, "Subscription renewed.");
  });
}

export async function cancelAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    await cancelSubscription(admin.id, str(form, "subscriptionId"), str(form, "note"));
    return withNotice(BACK, "Subscription cancelled at the end of its period.");
  });
}

export async function settingsAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    await saveSettings(admin.id, {
      inviteExpiryDays: str(form, "inviteExpiryDays") as never, messagesPerMinute: str(form, "messagesPerMinute") as never, newConversationsPerDay: str(form, "newConversationsPerDay") as never,
      contactPolicy: str(form, "contactPolicy") as never, reportMuteThreshold: str(form, "reportMuteThreshold") as never,
    });
    return withNotice(BACK, "Settings saved.");
  });
}

export async function savePromoAction(form: FormData) {
  return act(`${BACK}#promo-h`, async () => {
    const admin = await requirePlatformAdmin();
    const row = await savePromoCode(admin.id, {
      code: str(form, "code"), description: str(form, "description"), kind: str(form, "kind") === "amount" ? "amount" : "percent",
      percentOff: str(form, "percentOff"), amountOff: str(form, "amountOff"), currency: str(form, "currency") || "NGN",
      planIds: form.getAll("planIds").map(String).filter(Boolean), maxRedemptions: str(form, "maxRedemptions"),
      perOwnerOnce: str(form, "perOwnerOnce") === "on", newCustomersOnly: str(form, "newCustomersOnly") === "on",
      startsAt: str(form, "startsAt"), endsAt: str(form, "endsAt"),
    });
    return `${withNotice(BACK, `Code ${row.code} created. Share it with the people it is for.`)}#promo-h`;
  });
}

export async function promoActiveAction(form: FormData) {
  return act(`${BACK}#promo-h`, async () => {
    const admin = await requirePlatformAdmin();
    const on = str(form, "active") === "on";
    await setPromoActive(admin.id, str(form, "id"), on);
    return `${withNotice(BACK, on ? "Code switched on." : "Code switched off. Nobody can use it from now on.")}#promo-h`;
  });
}

export async function yearlyAction(form: FormData) {
  return act(`${BACK}#yearly-h`, async () => {
    const admin = await requirePlatformAdmin();
    await saveYearlyMonths(admin.id, str(form, "months"));
    const n = Number(str(form, "months"));
    return `${withNotice(BACK, n ? `Paying yearly now costs ${n} months (${12 - n} free). Prices update at once; people already paying keep their price until they renew.` : "Paying yearly is switched off. Yearly subscribers renew monthly from their next renewal.")}#yearly-h`;
  });
}
