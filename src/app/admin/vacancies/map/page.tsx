import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { vacancyPins } from "@/lib/services/maps";
import { StreetMap } from "@/components/StreetMap";
import { countryView, visitorCountry } from "@/lib/countries";
import { headers } from "next/headers";

export const metadata = { title: "Vacancy map" };
export const dynamic = "force-dynamic";

export default async function AdminVacancyMapPage() {
  const admin = await requirePlatformAdmin();
  const start = countryView(visitorCountry(await headers()));
  const r = await vacancyPins(admin.id);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Vacancy sightings on the map</h1><p className="muted">Individual sightings, for reviewers only. Do not share positions. <Link href="/admin/vacancies">Back to the queue</Link></p></div>
      {r.points.length === 0 ? <div className="card"><p className="muted">No open sighting can be placed.</p></div> : <StreetMap mode="points" points={r.points} start={start} label="Map of open vacancy sightings" />}
      {r.unplaced ? <p className="small muted">{r.unplaced} sightings have no position or known area.</p> : null}
    </div>
  );
}
