import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { companyBooking } from "@/lib/services/inspection-bookings";
import { BOOKING_LABEL, DURATIONS, nextSteps, sessionLive, type BookingStatus } from "@/lib/booking-rules";
import { formatDateTime, toLagosLocal } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { BookingTimeline } from "@/components/BookingTimeline";
import { SafetyStartForm } from "@/components/SafetyStartForm";
import { SAFETY_CONSENT_TEXT } from "@/lib/booking-rules";
import { advanceBookingAction, confirmBookingAction } from "../actions";

export const metadata = { title: "Inspection booking" };
export const dynamic = "force-dynamic";

const STEP_LABEL: Partial<Record<BookingStatus, string>> = { EN_ROUTE: "On the way", ARRIVED: "Arrived", IN_PROGRESS: "Start inspection", COMPLETED: "Completed", CANCELLED: "Cancel" };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const { id } = await params;
  const s = await searchParams;
  const member = await requireMember("booking.manage");
  const b = await companyBooking(member, id);
  if (!b) notFound();
  const status = b.status as BookingStatus;
  const steps = nextSteps(status, "COMPANY").filter((x) => x !== "CONFIRMED" && x !== "RESCHEDULED");
  const canSchedule = ["REQUESTED", "CONFIRMED", "RESCHEDULED"].includes(status);
  const live = b.sessions.filter((x) => sessionLive(x));
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Inspection {b.ref}</p>
        <h1>{b.listing?.title ?? "Inspection"}</h1>
        <p className="muted">{b.requesterName}{b.requesterPhone ? ` · ${b.requesterPhone}` : ""} · {BOOKING_LABEL[status]}</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      {live.some((x) => x.emergencyAt) ? <p className="flash error" role="alert"><strong>Emergency alert raised in a safety session for this inspection.</strong> <Link href={`/app/safety/${live.find((x) => x.emergencyAt)!.id}`}>Open it now</Link>.</p> : null}
      <div className="two">
        <section className="card stack">
          <h2>Request</h2>
          <ul className="check-list">
            <li>Asked for {formatDateTime(b.preferredAt)}{b.alternativeAt ? `, or ${formatDateTime(b.alternativeAt)}` : ""}</li>
            {b.message ? <li>“{b.message}”</li> : null}
            {b.scheduledAt ? <li><strong>Confirmed for {formatDateTime(b.scheduledAt)}</strong> ({b.durationMinutes} minutes) with {b.team.find((t) => t.userId === b.assignedUserId)?.name ?? "—"}{b.meetingPoint ? ` · meet at ${b.meetingPoint}` : ""}</li> : null}
          </ul>
          {b.scheduledAt && b.status !== "CANCELLED" && b.status !== "COMPLETED" ? <p><a className="btn" href={`/app/bookings/${b.id}/calendar`}>Add to calendar</a></p> : null}
          <BookingTimeline status={b.status} events={b.events} />
          {steps.length ? (
            <div className="stack">
              {steps.map((to) => (
                <form key={to} action={advanceBookingAction} className="row">
                  <input type="hidden" name="id" value={b.id} /><input type="hidden" name="to" value={to} />
                  {to === "CANCELLED" || to === "COMPLETED" ? <input name="note" aria-label={to === "CANCELLED" ? "Reason for cancelling" : "Outcome"} placeholder={to === "CANCELLED" ? "Why it is cancelled" : "Outcome (optional)"} maxLength={500} required={to === "CANCELLED"} /> : null}
                  <button className={`btn${to === "CANCELLED" ? " danger" : to === "COMPLETED" ? " primary" : ""}`} type="submit">{STEP_LABEL[to] ?? BOOKING_LABEL[to]}</button>
                </form>
              ))}
            </div>
          ) : null}
        </section>
        <div className="stack-lg">
          {canSchedule ? (
            <section className="card stack">
              <h2>{status === "CONFIRMED" ? "Change the time" : "Confirm a time"}</h2>
              <form action={confirmBookingAction} className="stack">
                <input type="hidden" name="id" value={b.id} />
                <label className="field">Date and time (Lagos)<input type="datetime-local" name="scheduledAt" required defaultValue={toLagosLocal(b.scheduledAt ?? b.preferredAt)} /></label>
                <label className="field">How long<select name="durationMinutes" defaultValue={String(b.durationMinutes)}>{DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}</select></label>
                <label className="field">Who will meet them<select name="assignedUserId" required defaultValue={b.assignedUserId ?? (member.role === "AGENT" ? member.userId : "")}><option value="">Choose…</option>{b.team.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}</select></label>
                <label className="field">Meeting point (optional)<input name="meetingPoint" maxLength={300} defaultValue={b.meetingPoint} placeholder="For example: estate gate, Admiralty Way" /></label>
                <label className="field">Note (optional)<input name="note" maxLength={500} /></label>
                <button className="btn primary" type="submit">{status === "CONFIRMED" ? "Save new time" : "Confirm"}</button>
              </form>
            </section>
          ) : null}
          <section className="card stack">
            <h2>Safety</h2>
            {b.sessions.length ? <ul className="check-list">{b.sessions.map((x) => <li key={x.id}><Link href={`/app/safety/${x.id}`}>{sessionLive(x) ? "Session on" : "Session ended"}{x.emergencyAt ? " · EMERGENCY" : ""}</Link> · started {formatDateTime(x.startedAt)}</li>)}</ul> : <p className="small muted">No safety session from your team for this inspection.</p>}
            {["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(status) ? <SafetyStartForm bookingRef={b.ref} consentText={SAFETY_CONSENT_TEXT} back={`/app/bookings/${b.id}`} /> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
