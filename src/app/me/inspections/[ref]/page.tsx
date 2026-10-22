import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { myBooking } from "@/lib/services/inspection-bookings";
import { ownSessionsForBooking } from "@/lib/services/safety";
import { BOOKING_LABEL, SAFETY_CONSENT_TEXT, nextSteps, sessionLive, type BookingStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, sp, type SP } from "@/components/ui";
import { BookingTimeline } from "@/components/BookingTimeline";
import { SafetyStartForm } from "@/components/SafetyStartForm";
import { cancelInspectionAction } from "../actions";

export const metadata = { title: "Inspection" };
export const dynamic = "force-dynamic";

export default async function MyInspection({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await params;
  const s = await searchParams;
  const user = await requireUser();
  const b = await myBooking(user.id, ref);
  if (!b) notFound();
  const sessions = await ownSessionsForBooking(user.id, b.id);
  const live = sessions.find((x) => sessionLive(x));
  const canCancel = nextSteps(b.status as BookingStatus, "REQUESTER").includes("CANCELLED");
  const safetyOk = ["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(b.status);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Inspection {b.ref}</p>
        <h1>{b.listing?.title ?? "Inspection"}</h1>
        <p className="muted">{b.listing ? <><Link href={`/properties/${b.listing.publicRef}`}>{b.listing.publicRef}</Link> · {b.listing.city}, {b.listing.state} · </> : null}{BOOKING_LABEL[b.status as BookingStatus]}</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <div className="two">
        <section className="card stack">
          <h2>When and where</h2>
          {b.scheduledAt ? (
            <ul className="check-list"><li>{formatDateTime(b.scheduledAt)} for about {b.durationMinutes} minutes</li>{b.meetingPoint ? <li>Meet at: {b.meetingPoint}</li> : null}{b.agent ? <li>Meeting you: <Link href={`/agents/${b.agent.userId}`}>{b.agent.displayName}</Link> (check their trust level)</li> : null}</ul>
          ) : <p className="muted">You asked for {formatDateTime(b.preferredAt)}{b.alternativeAt ? ` or ${formatDateTime(b.alternativeAt)}` : ""}. The company will confirm a time.</p>}
          {b.scheduledAt && b.status !== "CANCELLED" && b.status !== "COMPLETED" ? <p><a className="btn" href={`/me/inspections/${encodeURIComponent(b.ref)}/calendar`}>Add to my calendar</a></p> : null}
          <BookingTimeline status={b.status} events={b.events} />
          {canCancel ? (
            <details className="inline"><summary>Cancel this inspection</summary>
              <form action={cancelInspectionAction} className="stack"><input type="hidden" name="ref" value={b.ref} /><label className="field">Reason (optional)<input name="reason" maxLength={500} /></label><button className="btn danger" type="submit">Cancel inspection</button></form>
            </details>
          ) : null}
        </section>
        <section className="card stack">
          <h2>Stay safe</h2>
          <ul className="check-list small">
            <li>Do not pay anything before you have inspected and checked the documents.</li>
            <li>Tell someone where you are going, or turn on a safety session below.</li>
            <li>Check the agent&apos;s and company&apos;s trust level, and meet in daylight where you can.</li>
          </ul>
          {live ? <Link className="btn primary" href={`/safety/session/${live.id}`}>Open your safety session (on)</Link>
            : safetyOk ? <SafetyStartForm bookingRef={b.ref} consentText={SAFETY_CONSENT_TEXT} back={`/me/inspections/${b.ref}`} />
            : <p className="small muted">A safety session can be turned on once the company confirms the inspection.</p>}
          <p className="small"><Link href={`/trust?category=INSPECTION_SAFETY&targetKind=BOOKING&targetRef=${b.ref}`}>Report a problem with this inspection</Link></p>
        </section>
      </div>
    </div>
  );
}
