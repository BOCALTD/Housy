import { BOOKING_LABEL, type BookingStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";

const STEPS: BookingStatus[] = ["REQUESTED", "CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"];

/** Where a booking is on its way from request to completion, then every recorded step. */
export function BookingTimeline({ status, events }: { status: string; events: { id: string; toStatus: string; note: string; createdAt: Date }[] }) {
  const at = STEPS.indexOf(status as BookingStatus);
  return (
    <div className="stack">
      {status === "CANCELLED" ? <p className="flash error">Cancelled</p> : (
        <ol className="steps-line" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "now" : undefined} aria-current={i === at ? "step" : undefined}>{BOOKING_LABEL[s]}</li>)}
        </ol>
      )}
      <details className="inline"><summary>History ({events.length})</summary>
        <ul className="timeline">{events.map((e) => <li key={e.id}><span><strong>{BOOKING_LABEL[e.toStatus as BookingStatus] ?? e.toStatus}</strong> · <span className="small muted">{formatDateTime(e.createdAt)}</span>{e.note ? <div className="small">{e.note}</div> : null}</span></li>)}</ul>
      </details>
    </div>
  );
}
