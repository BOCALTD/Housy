"use server";

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  addProviderDocument, changeProviderStaffRole, inviteProviderStaff, providerContext, removeProviderDocument, removeProviderStaff,
  revokeProviderInvitation, setProviderCoverage, setProviderOfferings, setProviderStaffStatus, updateProviderProfile,
} from "@/lib/services/verification-network";
import { SERVICE_CODES } from "@/lib/verification-network-rules";
import { headers } from "next/headers";

async function ctxFor(form: FormData) {
  const user = await requireUser();
  const ctx = await providerContext(user.id, str(form, "code"));
  if (!ctx) notFound();
  return ctx;
}
const at = (form: FormData, sub: string) => `/provider/${encodeURIComponent(str(form, "code"))}${sub}`;

export async function saveProfileAction(form: FormData) {
  return act(at(form, "/profile"), async () => {
    const ctx = await ctxFor(form);
    const file = form.get("logo");
    const logo = file instanceof File && file.size > 0 ? { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
    await updateProviderProfile(ctx, { name: str(form, "name"), shortName: str(form, "shortName"), profile: str(form, "profile"), contactEmail: str(form, "contactEmail"), contactPhone: str(form, "contactPhone"), link: str(form, "link") }, logo);
    return withNotice(at(form, "/profile"), "Profile saved.");
  });
}

export async function saveServicesAction(form: FormData) {
  return act(at(form, "/profile#services"), async () => {
    const ctx = await ctxFor(form);
    const rows = SERVICE_CODES.filter((c) => form.has(`svc.${c}.present`)).map((c) => ({ categoryCode: c, active: str(form, `svc.${c}.active`) === "yes", priceNaira: str(form, `svc.${c}.price`), turnaroundDays: str(form, `svc.${c}.days`) || "10", notes: str(form, `svc.${c}.notes`) }));
    await setProviderOfferings(ctx, rows);
    return withNotice(at(form, "/profile#services"), "Services saved.");
  });
}

export async function saveCoverageAction(form: FormData) {
  return act(at(form, "/profile#coverage"), async () => {
    const ctx = await ctxFor(form);
    await setProviderCoverage(ctx, form.getAll("states").map(String));
    return withNotice(at(form, "/profile#coverage"), "Coverage saved.");
  });
}

export async function addDocAction(form: FormData) {
  return act(at(form, "/documents"), async () => {
    const ctx = await ctxFor(form);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to add.");
    await addProviderDocument(ctx, { kind: str(form, "kind"), title: str(form, "title"), expiresOn: str(form, "expiresOn") }, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return withNotice(at(form, "/documents"), "Document added.");
  });
}

export async function removeDocAction(form: FormData) {
  return act(at(form, "/documents"), async () => {
    const ctx = await ctxFor(form);
    await removeProviderDocument(ctx, str(form, "id"));
    return withNotice(at(form, "/documents"), "Document removed.");
  });
}

export async function inviteAction(form: FormData) {
  return act(at(form, "/staff"), async () => {
    const ctx = await ctxFor(form);
    const token = await inviteProviderStaff(ctx, { email: str(form, "email"), role: str(form, "role") as never });
    const h = await headers();
    const link = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/verification-partners/activate/${encodeURIComponent(token)}`;
    return `${at(form, "/staff")}?invite=${encodeURIComponent(link)}&notice=${encodeURIComponent("Invitation created. Send the link below; it is shown only now.")}`;
  });
}

export async function revokeInviteAction(form: FormData) {
  return act(at(form, "/staff"), async () => { const ctx = await ctxFor(form); await revokeProviderInvitation(ctx, str(form, "id")); return withNotice(at(form, "/staff"), "Invitation cancelled."); });
}
export async function roleAction(form: FormData) {
  return act(at(form, "/staff"), async () => { const ctx = await ctxFor(form); await changeProviderStaffRole(ctx, str(form, "id"), str(form, "role")); return withNotice(at(form, "/staff"), "Role changed."); });
}
export async function statusAction(form: FormData) {
  return act(at(form, "/staff"), async () => { const ctx = await ctxFor(form); await setProviderStaffStatus(ctx, str(form, "id"), str(form, "active") === "yes"); return withNotice(at(form, "/staff"), str(form, "active") === "yes" ? "Access restored." : "Access suspended."); });
}
export async function removeStaffAction(form: FormData) {
  return act(at(form, "/staff"), async () => { const ctx = await ctxFor(form); await removeProviderStaff(ctx, str(form, "id")); return withNotice(at(form, "/staff"), "Removed from the organisation."); });
}
