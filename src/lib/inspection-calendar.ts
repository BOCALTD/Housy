import type { IcsEvent } from "./ics";

type Booking = {
  id: string; ref: string; status: string; scheduledAt: Date | null; durationMinutes: number; meetingPoint: string;
  rescheduleCount: number; updatedAt: Date; requesterName: string;
};
type Listing = { title: string; city: string; state: string } | null;

/** One inspection as a calendar event, worded for the person who asked or for the company's staff. Null until a time is confirmed. */
export function bookingEvent(b: Booking, listing: Listing, view: "REQUESTER" | "STAFF", o: { origin: string; meetingWith?: string | null }): IcsEvent | null {
  if (!b.scheduledAt || b.status === "REQUESTED") return null;
  const place = listing ? `${listing.city}, ${listing.state}` : "";
  const title = listing?.title ?? "Property inspection";
  const url = view === "REQUESTER" ? `${o.origin}/me/inspections/${encodeURIComponent(b.ref)}` : `${o.origin}/app/bookings/${b.id}`;
  const description = view === "REQUESTER"
    ? [
        `Inspection ${b.ref}.`,
        o.meetingWith ? `Meeting you: ${o.meetingWith}.` : "",
        "Check the agent's trust level before you go, never pay money at an inspection, and start a safety session from the inspection page if you want someone to follow your visit.",
        url,
      ].filter(Boolean).join("\n")
    : [`Inspection ${b.ref}.`, `Visitor: ${b.requesterName}.`, "Open the booking for contact details and to update its status.", url].join("\n");
  return {
    uid: `${b.id}@housy-inspections`,
    start: b.scheduledAt,
    minutes: b.durationMinutes,
    title: view === "REQUESTER" ? `Property inspection: ${title}` : `Inspection ${b.ref}: ${title}`,
    description,
    location: [b.meetingPoint, place].filter(Boolean).join(" · "),
    url,
    cancelled: b.status === "CANCELLED",
    sequence: b.rescheduleCount,
    updated: b.updatedAt,
    alarmMinutes: 60,
  };
}
