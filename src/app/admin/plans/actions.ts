"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { assignSubscription, cancelSubscription, renewSubscription, savePlan, setPlanEntitlements } from "@/lib/services/subscriptions";
import { saveSettings } from "@/lib/services/platform-settings";
import { ENTITLEMENT_KEYS } from "@/lib/subscription-rules";

const BACK = "/admin/plans";

export async function savePlanAction(form: FormData) {
  return act(BACK, async () => {
    const admin = await requirePlatformAdmin();
    const id = optStr(form, "id") ?? null;
    const plan = await savePlan(admin.id, id, {
      code: str(form, "code"), name: str(form, "name"), audience: str(form, "audience") as never, price: str(form, "price"),
      billingPeriod: str(form, "billingPeriod") as never, trialDays: str(form, "trialDays"), graceDays: str(form, "graceDays"), readOnlyDays: str(form, "readOnlyDays"),
      active: str(form, "active") === "on", sortOrder: str(form, "sortOrder") || "100",
    });
    await setPlanEntitlements(admin.id, plan.id, ENTITLEMENT_KEYS.map((key) => ({ key, enabled: str(form, `on_${key}`) === "on", limit: str(form, `limit_${key}`) })));
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
      inviteExpiryDays: str(form, "inviteExpiryDays"), messagesPerMinute: str(form, "messagesPerMinute"), newConversationsPerDay: str(form, "newConversationsPerDay"),
      contactPolicy: str(form, "contactPolicy") as never, reportMuteThreshold: str(form, "reportMuteThreshold"),
    });
    return withNotice(BACK, "Settings saved.");
  });
}
