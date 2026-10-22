import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myBookings } from "@/lib/services/inspection-bookings";
import { BOOKING_LABEL, isOpen, type BookingStatus } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "My inspections" };
export const dynamic = "force-dynamic";

export default async function MyInspections({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const user = await requireUser();
  const rows = await myBookings(user.id);
  const open = rows.filter((r) => isOpen(r.status as BookingStatus)), past = rows.filter((r) => !isOpen(r.status as BookingStatus));
  const item = (r: (typeof rows)[number]) => (
    <li key={r.id} className="row between" style={{ width: "100%" }}>
      <span><Link href={`/me/inspections/${r.ref}`}><strong>{r.listing?.title ?? "A property"}</strong></Link><span className="small muted"> · {r.ref} · {r.scheduledAt ? formatDateTime(r.scheduledAt) : `asked for ${formatDateTime(r.preferredAt)}`}</span></span>
      <Pill status={r.status === "CANCELLED" ? "SUSPENDED" : r.status === "COMPLETED" ? "ACTIVE" : "PENDING"} label={BOOKING_LABEL[r.status as BookingStatus]} />
    </li>
  );
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>My inspections</h1><p className="muted">Inspections you have asked for. Request one from any property page.</p></div>
      <Flash searchParams={{ error: sp(s, "error"), notice: sp(s, "notice") }} />
      <section className="card stack"><h2>Coming up</h2>{open.length ? <ShowMore limit={6} noun="more" items={open.map(item)} /> : <p className="muted">Nothing booked. <Link href="/browse">Find a property</Link>.</p>}</section>
      {past.length ? <details className="card inline"><summary>Past and cancelled ({past.length})</summary><ShowMore limit={6} noun="more" items={past.map(item)} /></details> : null}
    </div>
  );
}
