"use server";

import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { act, str, withNotice, messageFor } from "@/lib/forms";
import { createEnquiry } from "@/lib/services/listings";
import { viewerKeyFor } from "@/lib/services/ads";
import { unwatchListing, watchListing } from "@/lib/services/alerts";
import { requireUser } from "@/lib/auth";
import { parsePrefs, recordRecommendationEvent, submitLead } from "@/lib/services/verification";

const PREF_COOKIE = "pv_pref";
const VISITOR_COOKIE = "pv_vid";

async function clientKey() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** An anonymous, random visitor id used only to separate analytics events. Not linked to personal data. */
async function visitorKey() {
  const existing = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  (await cookies()).set(VISITOR_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production" });
  return id;
}

export async function enquiryAction(form: FormData) {
  const ref = str(form, "ref");
  const back = `/properties/${encodeURIComponent(ref)}`;
  return act(back, async () => {
    const ad = str(form, "ad");
    await createEnquiry(ref, { name: str(form, "name"), contact: str(form, "contact"), message: str(form, "message") }, await clientKey(), ad ? { adRef: ad, viewerKey: viewerKeyFor(await clientKey(), (await headers()).get("user-agent") ?? "") } : undefined);
    return withNotice(back, "Your enquiry was sent to the listing company.");
  });
}

type EventName = "IMPRESSION" | "CONFIRMED_INTEREST" | "DECLINED" | "LATER";

/** Records a modal event and, for Not interested / Maybe later, remembers the choice on this device. */
export async function recommendationEventAction(input: { providerId: string; listingRef: string; trigger: string; event: EventName }) {
  const allowed: EventName[] = ["IMPRESSION", "CONFIRMED_INTEREST", "DECLINED", "LATER"];
  if (!allowed.includes(input.event)) return { ok: false };
  const session = await getSession();
  try {
    await recordRecommendationEvent({ ...input, userId: session?.user.id ?? null, visitorKey: await visitorKey() });
  } catch {
    return { ok: false };
  }
  if (input.event === "DECLINED" || input.event === "LATER") {
    const prefs = parsePrefs((await cookies()).get(PREF_COOKIE)?.value);
    if (input.event === "DECLINED") prefs.declinedAt = Date.now();
    else prefs.laterAt = Date.now();
    (await cookies()).set(PREF_COOKIE, JSON.stringify(prefs), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === "production" });
  }
  return { ok: true };
}

/** Submits a consented verification request. Returns the reference and the private status link. */
export async function submitLeadAction(form: FormData): Promise<{ ok: true; ref: string; statusUrl: string } | { ok: false; error: string }> {
  try {
    const session = await getSession();
    const { ref, token } = await submitLead({
      providerId: str(form, "providerId"), listingRef: str(form, "listingRef"), name: str(form, "name"),
      contactMethod: str(form, "contactMethod") as never, contactValue: str(form, "contactValue"),
      note: str(form, "note"), consent: str(form, "consent") as never,
    }, session?.user.id ?? null, await clientKey());
    return { ok: true, ref, statusUrl: `/verification/${ref}?t=${encodeURIComponent(token)}` };
  } catch (err) {
    return { ok: false, error: messageFor(err) };
  }
}

export async function clearVerificationPrefsAction() {
  (await cookies()).delete(PREF_COOKIE);
}

export async function watchAction(form: FormData) {
  const ref = str(form, "ref");
  const back = `/properties/${encodeURIComponent(ref)}`;
  return act(back, async () => {
    const u = await requireUser();
    if (str(form, "on") === "1") { await watchListing(u.id, ref); return withNotice(back, "You are watching this property. We will tell you if it stops being available."); }
    await unwatchListing(u.id, ref); return withNotice(back, "You stopped watching this property.");
  });
}

export async function requestInspectionAction(form: FormData) {
  const ref = str(form, "ref");
  const back = `/properties/${encodeURIComponent(ref)}`;
  return act(back, async () => {
    const user = await requireUser();
    const { requestInspection } = await import("@/lib/services/inspection-bookings");
    const bookingRef = await requestInspection(user.id, ref, { name: str(form, "name"), phone: str(form, "phone"), preferredAt: str(form, "preferredAt"), alternativeAt: str(form, "alternativeAt") || undefined, message: str(form, "message") });
    return withNotice(`/me/inspections/${bookingRef}`, "Inspection requested. The company will confirm a time; you will see it here and in your notifications.");
  });
}
