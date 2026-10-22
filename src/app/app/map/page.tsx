import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { portfolioMapPoints, vacancyAreas } from "@/lib/services/maps";
import { can } from "@/lib/permissions";
import { humanize } from "@/lib/labels";
import { StreetMap } from "@/components/StreetMap";
import { countryView, visitorCountry } from "@/lib/countries";
import { headers } from "next/headers";
import { EnumOptions, sp, type SP } from "@/components/ui";

export const metadata = { title: "Portfolio map" };
export const dynamic = "force-dynamic";

const STATUSES = ["ACTIVE", "VACANT", "OCCUPIED", "UNDER_RENOVATION"] as const;

export default async function AppMapPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const start = countryView(visitorCountry(await headers()));
  const layer = sp(searchParams, "layer") === "vacancies" && can(member.role, "map.vacancies") ? "vacancies" : "portfolio";
  const status = sp(searchParams, "status") ?? "";
  const [mine, vac] = await Promise.all([layer === "portfolio" ? portfolioMapPoints(member, { status }) : null, layer === "vacancies" ? vacancyAreas(member) : null]);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Map</h1>
        <div className="row"><Link className={`btn${layer === "portfolio" ? " primary" : ""}`} href="/app/map">Your properties</Link>{can(member.role, "map.vacancies") ? <Link className={`btn${layer === "vacancies" ? " primary" : ""}`} href="/app/map?layer=vacancies">Vacancy areas</Link> : null}</div></div>
      {mine ? (
        <>
          <form className="row" style={{ alignItems: "end", gap: 8 }}><label className="field">Status<select name="status" defaultValue={status}><option value="">All live</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></label><button className="btn" type="submit">Filter</button></form>
          {mine.points.length === 0 ? <div className="card"><p className="muted">None of your properties can be placed yet. Set a city on each property, or a map position on its page.</p></div> : <StreetMap mode="points" points={mine.points} start={start} label="Map of your properties" />}
          {mine.unplaced ? <p className="small muted">{mine.unplaced} properties have no known city or position, so they are not drawn. Add a city on the property page.</p> : null}
          <p className="small muted">Tap a marker to open the property. Markers without a position you set sit at the centre of their city (the popup says so). Positions you set are visible only inside your company.</p>
        </>
      ) : null}
      {vac ? (
        <>
          <div className="card stack"><p>Counts of vacancy sightings reported by the public in the last 6 months. Areas with fewer than {vac.minimum} sightings are left out, so no single address can be worked out. Streets, descriptions and reporters are never shown.</p></div>
          {vac.points.length === 0 ? <div className="card"><p className="muted">No area has {vac.minimum} or more recent sightings yet.</p></div> : (
            <>
              <StreetMap mode="points" points={vac.points} start={start} label="Map of areas with several recent vacancy sightings" />
              <details className="inline"><summary>Areas as a list</summary><ul className="timeline">{vac.areas.map((a) => <li key={`${a.area}${a.state}`}><div>{a.area}, {a.state}</div><strong>{a.count}</strong></li>)}</ul></details>
            </>
          )}
          {vac.hiddenReports ? <p className="small muted">{vac.hiddenReports} further sightings are in areas with too few reports to show.</p> : null}
        </>
      ) : null}
    </div>
  );
}
