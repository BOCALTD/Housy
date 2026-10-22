"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { messageFor } from "@/lib/forms";
import { addDevice, removeDevice, sendTestPush } from "@/lib/services/push";

export type PushResultState = { ok?: string; error?: string };

export async function addDeviceAction(input: { endpoint: string; p256dh: string; auth: string; label: string }): Promise<PushResultState> {
  try {
    const user = await requireUser();
    await addDevice(user.id, { endpoint: String(input.endpoint ?? ""), p256dh: String(input.p256dh ?? ""), auth: String(input.auth ?? ""), label: String(input.label ?? "") });
    revalidatePath("/me/notification-settings");
    return { ok: "Notifications are on for this device." };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function removeDeviceAction(idOrEndpoint: string): Promise<PushResultState> {
  try {
    const user = await requireUser();
    await removeDevice(user.id, String(idOrEndpoint ?? ""));
    revalidatePath("/me/notification-settings");
    return { ok: "Notifications are off for that device." };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function testPushAction(): Promise<PushResultState> {
  try {
    const user = await requireUser();
    const r = await sendTestPush(user.id);
    return r.delivered ? { ok: `Test sent to ${r.delivered} of ${r.devices} device${r.devices === 1 ? "" : "s"}. It should appear in a few seconds.` } : { error: "The push service did not accept the test. Try turning notifications off and on again on this device." };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function removeDeviceFormAction(form: FormData) {
  await removeDeviceAction(String(form.get("id") ?? ""));
}
