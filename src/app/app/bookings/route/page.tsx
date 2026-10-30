import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { dayRoute } from "@/lib/services/inspection-bookings";
import { BOOKING_LABEL, type BookingStatus } from "@/lib/booking-rules";
import { directionsLinks, distanceLabel } from "@/lib/location-rules";
import { distanceKm } from "@/lib/geo-rules";
import { formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { StreetMap } from "@/components/StreetMap";
import { sp, type SP } from "@/components/ui";

export const metadata = { title: "The day's inspection route" };
export const dynamic = "force-dynamic";

/** One person's confirmed inspections on a day, in time order, on the map, with directions for the whole round. */
export default async function DayRoutePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const s = await searchP;
  const member = await requireMember("booking.manage");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp(s, "day") ?? "") ? sp(s, "day")! : toDateOnlyString(todayInLagos());
  const r = await dayRoute(member, day, sp(s, "who") ?? undefined);
  const placed = r.stops.filter((x) => x.lat !== null && x.lng !== null) as (typeof r.stops[number] & { lat: number; lng: number })[];
  const legs = placed.slice(1).map((x, k) => distanceKm(placed[k], x));
  const total = legs.reduce((n, x) => n + x, 0);
  const links = placed.length ? directionsLinks(placed[placed.length - 1], null, placed.slice(0, -1)) : null;
  const shift = (n: number) => toDateOnlyString(new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 864e5));
  const who = r.team.find((t) => t.userId === r.userId)?.name ?? "You";
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Inspections</p>
        <h1>The day&apos;s route</h1>
        <p className="muted">{who}: confirmed inspections on {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}, in time order.</p>
      </div>
      <form className="row" aria-label="Choose the day and person">
        <Link className="btn" href={`/app/bookings/route?day=${shift(-1)}${sp(s, "who") ? `&who=${sp(s, "who")}` : ""}`}>Previous day</Link>
        <label className="field">Day<input type="date" name="day" defaultValue={day} /></label>
        {member.role !== "AGENT" ? <label className="field">Person<select name="who" defaultValue={r.userId}>{r.team.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}</select></label> : null}
        <button className="btn" type="submit">Show</button>
        <Link className="btn" href="/app/bookings">All inspections</Link>
        <Link className="btn" href={`/app/bookings/route?day=${shift(1)}${sp(s, "who") ? `&who=${sp(s, "who")}` : ""}`}>Next day</Link>
      </form>
      {r.stops.length === 0 ? <div className="card"><p className="muted">No confirmed inspections on this day.</p></div> : (
        <div className="map-layout">
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            {placed.length ? <StreetMap mode="points" route start={{ lat: placed[0].lat, lng: placed[0].lng, zoom: 12 }} points={placed.map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, label: `${formatDateTime(x.at)} · ${x.title}`, sub: x.meetingPoint || x.city, href: `/app/bookings/${x.id}` }))} label="Map of the day's inspections" /> : null}
            {placed.length > 1 ? <p className="small muted">About {distanceLabel(total)} between stops in straight lines; the road distance is longer.</p> : null}
            {links ? <div className="directions"><a className="btn primary" href={links.google} target="_blank" rel="noopener noreferrer">Whole route in Google Maps</a><a className="btn" href={links.waze} target="_blank" rel="noopener noreferrer">First stop in Waze</a></div> : null}
          </div>
          <aside className="map-list" aria-label="Stops">
            <ol className="card-list route-stops">
              {r.stops.map((x, k) => (
                <li key={x.id} className="card stack" style={{ gap: 4 }}>
                  <div className="row between"><strong>{k + 1}. {formatDateTime(x.at).split(", ").pop()}</strong><span className="small muted">{BOOKING_LABEL[x.status as BookingStatus]}</span></div>
                  <Link href={`/app/bookings/${x.id}`}>{x.title}</Link>
                  <span className="small muted">{x.who}{x.meetingPoint ? ` · meet at ${x.meetingPoint}` : ""}{x.lat === null ? " · no map position" : ""}</span>
                  {k > 0 && x.lat !== null && placed.indexOf(x as never) > 0 ? <span className="small muted">{distanceLabel(legs[placed.indexOf(x as never) - 1])} from the previous stop</span> : null}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
