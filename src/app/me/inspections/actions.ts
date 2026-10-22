"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { act, messageFor, str, withNotice } from "@/lib/forms";
import { cancelByRequester } from "@/lib/services/inspection-bookings";
import { checkIn, endSession, raiseEmergency, recordPing, startSafetySession } from "@/lib/services/safety";

export async function cancelInspectionAction(form: FormData) {
  const ref = str(form, "ref");
  return act(`/me/inspections/${encodeURIComponent(ref)}`, async () => {
    const u = await requireUser();
    await cancelByRequester(u.id, ref, str(form, "reason"));
    return withNotice(`/me/inspections/${encodeURIComponent(ref)}`, "Inspection cancelled. The company has been told.");
  });
}

export async function startSafetyAction(form: FormData) {
  const ref = str(form, "ref");
  const back = str(form, "back") || `/me/inspections/${encodeURIComponent(ref)}`;
  return act(back.startsWith("/") ? back : "/", async () => {
    const u = await requireUser();
    const r = await startSafetySession(u.id, ref, { expectedMinutes: Number(str(form, "expectedMinutes")), consent: (str(form, "consent") === "yes") as true, trustedName: str(form, "trustedName"), trustedPhone: str(form, "trustedPhone"), trustedEmail: str(form, "trustedEmail") });
    return `/safety/session/${r.id}${r.shareToken ? `?link=${encodeURIComponent(r.shareToken)}` : ""}`;
  });
}

// Called from the live safety page while it is open. Each returns a short result rather than redirecting.
export async function pingAction(sessionId: string, lat: number, lng: number, accuracy: number | null) {
  try { const u = await requireUser(); return { ok: true, ...(await recordPing(u.id, sessionId, { lat, lng, accuracy })) }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
export async function checkInAction(sessionId: string) {
  try { const u = await requireUser(); await checkIn(u.id, sessionId); revalidatePath(`/safety/session/${sessionId}`); return { ok: true }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
export async function endSafetyAction(sessionId: string, how: "CHECKED_OUT" | "STOPPED") {
  try { const u = await requireUser(); await endSession(u.id, sessionId, how === "CHECKED_OUT" ? "CHECKED_OUT" : "STOPPED"); revalidatePath(`/safety/session/${sessionId}`); return { ok: true }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
export async function emergencyAction(sessionId: string, note: string) {
  try { const u = await requireUser(); const ref = await raiseEmergency(u.id, sessionId, note); revalidatePath(`/safety/session/${sessionId}`); return { ok: true, ref }; } catch (e) { return { ok: false, error: messageFor(e) }; }
}
