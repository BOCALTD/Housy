"use server";

import { requireMember } from "@/lib/auth";
import { act, messageFor, str, withNotice } from "@/lib/forms";
import { siteOrigin } from "@/lib/origin";
import { addToClientFile, createClientLink, removeFromClientFile, revokeClientLink } from "@/lib/services/client-files";

const back = (clientId: string) => `/app/crm/files/${encodeURIComponent(clientId)}`;

export async function addPropertyAction(form: FormData) {
  const clientId = str(form, "clientId");
  return act(back(clientId), async () => {
    const member = await requireMember("crm.manage");
    await addToClientFile(member, { clientId, assetId: str(form, "assetId"), role: (str(form, "role") || "OWNER") as never });
    return withNotice(back(clientId), "Property added to the client's file.");
  });
}

export async function removePropertyAction(form: FormData) {
  const clientId = str(form, "clientId");
  return act(back(clientId), async () => {
    const member = await requireMember("crm.manage");
    await removeFromClientFile(member, clientId, str(form, "assetId"));
    return withNotice(back(clientId), "Removed from the file. Its records stay with the property.");
  });
}

export async function revokeLinkAction(form: FormData) {
  const clientId = str(form, "clientId");
  return act(back(clientId), async () => {
    const member = await requireMember("crm.manage");
    await revokeClientLink(member, str(form, "linkId"));
    return withNotice(back(clientId), "Link closed. The client can no longer open it.");
  });
}

export type ShareState = { url?: string; error?: string };

/** Returns the client link to the page once; it is never put in the address bar or stored in the clear. */
export async function shareAction(_prev: ShareState, form: FormData): Promise<ShareState> {
  try {
    const member = await requireMember("crm.manage");
    const token = await createClientLink(member, { clientId: str(form, "clientId"), assetId: str(form, "assetId"), sections: form.getAll("section").map(String), days: Number(str(form, "days")) || 30 });
    return { url: `${await siteOrigin()}/c/${token}` };
  } catch (err) {
    return { error: messageFor(err) };
  }
}
