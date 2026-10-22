"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/booking-rules";
import { advanceBooking, confirmBooking } from "@/lib/services/inspection-bookings";

const path = (id: string) => `/app/bookings/${encodeURIComponent(id)}`;

export async function confirmBookingAction(form: FormData) {
  const id = str(form, "id");
  return act(path(id), async () => {
    const m = await requireMember("booking.manage");
    await confirmBooking(m, id, { scheduledAt: str(form, "scheduledAt"), durationMinutes: str(form, "durationMinutes"), assignedUserId: str(form, "assignedUserId"), meetingPoint: str(form, "meetingPoint"), note: str(form, "note") });
    return withNotice(path(id), "Confirmed. The person who asked has been told the time and place.");
  });
}

export async function advanceBookingAction(form: FormData) {
  const id = str(form, "id");
  return act(path(id), async () => {
    const m = await requireMember("booking.manage");
    const to = str(form, "to") as BookingStatus;
    if (!(BOOKING_STATUSES as readonly string[]).includes(to)) throw new Error("Unknown step");
    await advanceBooking(m, id, to, str(form, "note"));
    return withNotice(path(id), "Updated.");
  });
}
