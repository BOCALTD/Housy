import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { companySession } from "@/lib/services/safety";
import { sessionLive } from "@/lib/booking-rules";
import { formatDateTime } from "@/lib/dates";
import { ShowMore } from "@/components/ui";

export const metadata = { title: "Safety session" };
export const dynamic = "force-dynamic";

export default async function CompanySafety({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember("booking.manage");
  const s = await companySession(member, (await params).id);
  if (!s) notFound();
  const live = sessionLive(s);
  return (
    <div className="stack-lg">
      {live ? <meta httpEquiv="refresh" content="60" /> : null}
      <div className="stack" style={{ gap: 6 }}><p className="eyebrow">Safety session</p><h1>{s.personName}</h1>
        <p className="muted">{live ? "On" : "Ended"} · started {formatDateTime(s.startedAt)} · expected end {formatDateTime(s.expectedEndAt)}</p></div>
      {s.emergencyAt ? <p className="flash error" role="alert"><strong>Emergency alert at {formatDateTime(s.emergencyAt)}.</strong> {s.emergencyNote} Call them, and if you cannot reach them call 112.</p> : null}
      <section className="card stack">
        <ul className="check-list">
          {s.checkedInAt ? <li>Checked in {formatDateTime(s.checkedInAt)}</li> : <li>Not checked in yet</li>}
          {s.checkedOutAt ? <li>Checked out {formatDateTime(s.checkedOutAt)}</li> : null}
          {s.lastLat != null && live ? <li>Last location {formatDateTime(s.lastAt!)}: <a href={`https://www.openstreetmap.org/?mlat=${s.lastLat}&mlon=${s.lastLng}#map=17/${s.lastLat}/${s.lastLng}`} target="_blank" rel="noopener noreferrer">open the map</a></li> : null}
        </ul>
        {s.pings.length ? <details className="inline"><summary>Location history ({s.pings.length} most recent)</summary><ShowMore limit={5} noun="more" items={s.pings.map((p) => <li key={p.id}>{formatDateTime(p.at)} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)}{p.accuracy ? ` (±${Math.round(p.accuracy)} m)` : ""}</li>)} /></details> : null}
        <p className="small muted">Visible to your company only because this person attended for you and agreed to share. Location points are deleted 30 days after the session ends.</p>
      </section>
      <p className="small"><Link href={`/app/bookings/${s.bookingId}`}>Back to the booking</Link></p>
    </div>
  );
}
