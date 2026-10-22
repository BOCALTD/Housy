"use server";

import { requireMember } from "@/lib/auth";
import { act, messageFor, str } from "@/lib/forms";
import { API_SCOPES } from "@/lib/api-rules";
import { createApiKey, revokeApiKey } from "@/lib/services/api-keys";

export type NewKeyState = { key?: string; name?: string; error?: string };

/** Returns the new key to the page once. It is never put in the address bar, a cookie or a log. */
export async function createApiKeyAction(_prev: NewKeyState, form: FormData): Promise<NewKeyState> {
  try {
    const member = await requireMember("api.manage");
    const scopes = form.getAll("scope").map(String).filter((s) => (API_SCOPES as readonly string[]).includes(s)) as (typeof API_SCOPES)[number][];
    const name = str(form, "name");
    const r = await createApiKey(member, { name, scopes, days: Number.parseInt(str(form, "days"), 10) || 0 });
    return { key: r.key, name };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function revokeApiKeyAction(form: FormData) {
  return act("/app/api-keys", async () => {
    const member = await requireMember("api.manage");
    await revokeApiKey(member, str(form, "id"));
    return "/app/api-keys?notice=" + encodeURIComponent("Key revoked. Programs using it stop working at once.");
  });
}
