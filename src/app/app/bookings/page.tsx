import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { companyBookings } from "@/lib/services/inspection-bookings";
import { BOOKING_LABEL, isOpen, type BookingStatus } from "@/lib/booking-rules";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Inspection bookings" };
export const dynamic = "force-dynamic";

const lagosDay = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);

export default async function BookingsPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const member = await requireMember("booking.manage");
  const rows = await companyBookings(member);
  const waiting = rows.filter((r) => r.status === "REQUESTED");
  const upcoming = rows.filter((r) => isOpen(r.status as BookingStatus) && r.status !== "REQUESTED" && r.scheduledAt);
  const done = rows.filter((r) => !isOpen(r.status as BookingStatus));
  const days = [...new Set(upcoming.map((r) => lagosDay(r.scheduledAt!)))].sort();
  const row = (r: (typeof rows)[number]) => (
    <Link key={r.id} href={`/app/bookings/${r.id}`} className="booking-row">
      <span><strong>{r.scheduledAt ? formatDateTime(r.scheduledAt).split(", ").pop() : formatDateTime(r.preferredAt)}</strong> · {r.listing?.title ?? "Listing"}<span className="small muted"> · {r.requesterName}{r.agentName ? ` · with ${r.agentName}` : ""}</span></span>
      <Pill status={r.status === "REQUESTED" ? "OPEN" : r.status === "CANCELLED" ? "SUSPENDED" : "ACTIVE"} label={BOOKING_LABEL[r.status as BookingStatus]} />
    </Link>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Inspection bookings</h1>
        <p className="muted">Requests from people who want to inspect your listings. Confirm a time and who will meet them; the system refuses times that clash with that person&apos;s other inspections.{member.role === "AGENT" ? " You see the ones assigned to you and new requests." : ""}</p>
      </div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="card stack"><h2>Waiting for a time ({waiting.length})</h2>
        {waiting.length ? <ShowMore limit={6} noun="more requests" items={waiting.map((r) => <li key={r.id}>{row(r)}</li>)} /> : <p className="muted">No new requests.</p>}
      </section>
      <section className="card stack"><h2>Calendar</h2>
        {days.length === 0 ? <p className="muted">Nothing confirmed yet.</p> : days.slice(0, 14).map((d) => (
          <div key={d} className="day-group"><h3>{formatDate(new Date(`${d}T00:00:00Z`))}</h3>{upcoming.filter((r) => lagosDay(r.scheduledAt!) === d).map(row)}</div>
        ))}
        {days.length > 14 ? <p className="small muted">Showing the next 14 days with inspections.</p> : null}
      </section>
      {done.length ? <details className="card inline"><summary>Completed and cancelled in the last 30 days ({done.length})</summary><ShowMore limit={8} noun="more" items={done.map((r) => <li key={r.id}>{row(r)}</li>)} /></details> : null}
    </div>
  );
}
