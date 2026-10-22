"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { act, str, withNotice } from "@/lib/forms";
import { reviewListing } from "@/lib/services/listings";
import { saveProvider } from "@/lib/services/verification";
import { addProviderMember, removeProviderMember } from "@/lib/services/portals";

const LEAD_STATUSES = ["SUBMITTED", "CONTACTED", "IN_PROGRESS", "CLOSED", "DECLINED"] as const;

async function review(form: FormData, decision: "approve" | "reject") {
  return act("/admin", async () => {
    const admin = await requirePlatformAdmin();
    await reviewListing(admin.id, str(form, "listingId"), decision, str(form, "note"));
    return withNotice("/admin", decision === "approve" ? "Listing published." : "Listing returned to the company.");
  });
}

export async function approveListingAction(form: FormData) {
  return review(form, "approve");
}

export async function rejectListingAction(form: FormData) {
  return review(form, "reject");
}

export async function saveProviderAction(form: FormData) {
  return act("/admin", async () => {
    await requirePlatformAdmin();
    const id = str(form, "id") || null;
    await saveProvider(id, {
      name: str(form, "name"), shortName: str(form, "shortName"), profile: str(form, "profile"),
      services: str(form, "services"), coverage: str(form, "coverage"), link: str(form, "link"),
      status: str(form, "status") as never, placement: str(form, "placement") as never,
      featured: str(form, "featured") === "on",
    });
    return withNotice("/admin", "Provider saved.") + "#providers";
  });
}

export async function leadStatusAction(form: FormData) {
  return act("/admin", async () => {
    await requirePlatformAdmin();
    const status = str(form, "status");
    if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw new Error("Choose a valid status");
    const lead = await prisma.providerLead.findUnique({ where: { id: str(form, "leadId") } });
    if (!lead) throw new Error("Lead not found");
    if (lead.status === "WITHDRAWN") throw new Error("The requester withdrew this lead. It cannot be reopened.");
    await prisma.providerLead.update({ where: { id: lead.id }, data: { status: status as (typeof LEAD_STATUSES)[number] } });
    return withNotice("/admin", "Lead updated.") + "#leads";
  });
}

export async function addProviderMemberAction(form: FormData) {
  return act("/admin", async () => {
    const admin = await requirePlatformAdmin();
    await addProviderMember(admin.id, str(form, "providerId"), str(form, "email"));
    return withNotice("/admin", "Person added to the provider portal.") + "#providers";
  });
}

export async function removeProviderMemberAction(form: FormData) {
  return act("/admin", async () => {
    const admin = await requirePlatformAdmin();
    await removeProviderMember(admin.id, str(form, "id"));
    return withNotice("/admin", "Person removed from the provider portal.") + "#providers";
  });
}
