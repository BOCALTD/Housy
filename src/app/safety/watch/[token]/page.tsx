import { trustedView } from "@/lib/services/safety";
import { formatDateTime } from "@/lib/dates";
import { EMERGENCY_NUMBERS } from "@/lib/booking-rules";

export const metadata = { title: "Safety check", robots: { index: false } };
export const dynamic = "force-dynamic";

// A private page for a trusted contact. It refreshes every minute while the session is on.
export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const v = await trustedView((await params).token);
  return (
    <div className="stack-lg" style={{ maxWidth: 680 }}>
      {v?.live ? <meta httpEquiv="refresh" content="60" /> : null}
      <h1>Safety check</h1>
      {!v ? <div className="card"><p>This link is not valid.</p></div> : (
        <section className="card stack">
          {v.emergencyAt ? <p className="flash error" role="alert"><strong>Emergency alert sent at {formatDateTime(v.emergencyAt)}.</strong> {v.emergencyNote} If you cannot reach them, call {EMERGENCY_NUMBERS.map((n) => n.number).join(" or ")}.</p> : null}
          <p>{v.live ? "The session is on." : v.endReason === "CHECKED_OUT" ? `They checked out safely at ${formatDateTime(v.endedAt!)}.` : "The session has ended. Location is no longer shared."}</p>
          <ul className="check-list">
            <li>Started {formatDateTime(v.startedAt)}; expected to finish by {formatDateTime(v.expectedEndAt)}</li>
            {v.checkedInAt ? <li>Arrived (checked in) at {formatDateTime(v.checkedInAt)}</li> : null}
            {v.last ? <li>Last location at {formatDateTime(v.last.at)}: <a href={`https://www.openstreetmap.org/?mlat=${v.last.lat}&mlon=${v.last.lng}#map=17/${v.last.lat}/${v.last.lng}`} target="_blank" rel="noopener noreferrer">open the map</a></li> : v.live ? <li>No location shared yet.</li> : null}
          </ul>
        </section>
      )}
    </div>
  );
}
