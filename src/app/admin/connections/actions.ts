"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { GROUPS, MANAGED, makePushKeys, runtimeEnv, saveManaged, type Group } from "@/lib/runtime-env";
import { configuredDriver } from "@/lib/email-drivers";
import { PLATFORM_NAME } from "@/lib/labels";

const BACK = "/admin/connections";

export async function saveConnectionsAction(form: FormData) {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const group = str(form, "group") as Group;
    if (!(group in GROUPS)) throw new Error("Choose a section");
    const values: Record<string, string> = {};
    for (const m of MANAGED.filter((x) => x.group === group)) values[m.name] = String(form.get(m.name) ?? "");
    if (group === "security" && values.REQUIRE_ADMIN_MFA === "on" && !a.mfaEnabledAt) throw new Error("Turn on two-step sign-in for your own account first (My account, Security), so you are not locked out");
    const changed = await saveManaged(a.id, group, values, form.getAll("clear").map(String));
    return withNotice(BACK, changed.length ? `${GROUPS[group].title}: saved.` : "Nothing changed.");
  });
}

export async function testEmailAction() {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    const driver = configuredDriver(await runtimeEnv());
    if (!driver) throw new Error("Email is not connected yet. Choose a provider and save it first.");
    const r = await driver.send({ to: a.email, subject: `${PLATFORM_NAME}: test email`, text: `This is a test from Admin, Connections. If you can read it, email is working.`, html: `<p>This is a test from Admin, Connections. If you can read it, email is working.</p>` });
    if (!r.ok) throw new Error(`The email was not sent: ${r.error.replace(/[\r\n]+/g, " ").slice(0, 200)}. Check the details and try again.`);
    return withNotice(BACK, `Test email sent to ${a.email}. Check the inbox (and the spam folder).`);
  });
}

export async function makePushKeysAction() {
  return act(BACK, async () => {
    const a = await requirePlatformAdmin();
    await makePushKeys(a.id);
    return withNotice(BACK, "Push notification keys made and saved. People turn notifications on from Notification settings.");
  });
}
