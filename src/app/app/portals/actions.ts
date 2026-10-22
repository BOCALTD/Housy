"use server";

import { headers } from "next/headers";
import { requireMember } from "@/lib/auth";
import { act, messageFor, str, withNotice } from "@/lib/forms";
import { inviteOwner, inviteVendor, reissueInvite, revokeGrant, setGrantAssets } from "@/lib/services/portals";

export type InviteState = { link?: string; who?: string; error?: string };

async function linkFor(token: string) {
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const host = h.get("host") ?? "localhost:3000";
  const base = configured && /^https?:\/\//.test(configured) ? configured.replace(/\/$/, "") : `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  return `${base}/portal/accept/${encodeURIComponent(token)}`;
}

/** Returns the invitation link to the page once; it never goes in the address bar. */
export async function inviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  try {
    const member = await requireMember("portal.manage");
    const kind = str(form, "kind");
    const input = { email: str(form, "email"), displayName: str(form, "displayName") };
    const token = kind === "VENDOR"
      ? await inviteVendor(member, { ...input, contractorId: str(form, "contractorId") })
      : await inviteOwner(member, { ...input, assetIds: form.getAll("assetId").map(String) });
    return { link: await linkFor(token), who: input.displayName };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function reissueAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  try {
    const member = await requireMember("portal.manage");
    const token = await reissueInvite(member, str(form, "id"));
    return { link: await linkFor(token), who: str(form, "who") };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function revokeAction(form: FormData) {
  return act("/app/portals", async () => {
    const member = await requireMember("portal.manage");
    await revokeGrant(member, str(form, "id"));
    return withNotice("/app/portals", "Access removed. The portal closes for them at once.");
  });
}

export async function assetsAction(form: FormData) {
  return act("/app/portals", async () => {
    const member = await requireMember("portal.manage");
    await setGrantAssets(member, str(form, "id"), form.getAll("assetId").map(String));
    return withNotice("/app/portals", "The properties this owner can see were updated.");
  });
}
