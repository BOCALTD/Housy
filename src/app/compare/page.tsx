import Link from "next/link";
import { compareRefs } from "@/lib/calc-rules";
import { publicListingsByRefs } from "@/lib/services/listings";
import { decorateListings } from "@/lib/services/promotions";
import { trustMany } from "@/lib/services/kyc";
import { withPublic } from "@/lib/db";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CONDITIONS, CONSTRUCTION, FURNISHING, isCode, parseAmenities, priceSuffix } from "@/lib/listing-rules";
import { labelsOf, refData } from "@/lib/services/reference";
import { TrustBadge } from "@/components/TrustBadge";
import { RemoveFromCompare } from "@/components/Compare";
import { PropPhoto, sp, type SP } from "@/components/ui";
import { compareNotes } from "@/lib/compare-notes";
import { marketOverview } from "@/lib/services/market";

export const metadata = { title: "Compare properties" };
export const dynamic = "force-dynamic";

const label = (t: Record<string, string>, v: string, none = "—") => (isCode(t, v) && v !== "UNSPECIFIED" ? t[v] : none);

export default async function ComparePage({ searchParams }: { searchParams?: Promise<SP> }) {
  const refs = compareRefs(sp(await searchParams, "refs"));
  const rows = await decorateListings(await publicListingsByRefs(refs), false);
  const companyIds = [...new Set(rows.map((r) => r.companyId))];
  const [trust, names] = await Promise.all([
    trustMany("COMPANY", companyIds),
    withPublic((tx) => tx.companyProfile.findMany({ where: { companyId: { in: companyIds }, listed: true }, select: { companyId: true, displayName: true } })),
  ]);
  // Yearly cost to occupy: rent per year plus service charge (only for rent and lease; a sale has no yearly price).
  const yearly = (l: (typeof rows)[number]) => l.purpose === "SALE" ? null : (l.pricePeriod === "MONTH" ? l.priceKobo * 12n : l.pricePeriod === "NIGHT" ? null : l.priceKobo) as bigint | null;
  const perSqm = (l: (typeof rows)[number]) => { const area = l.buildingSqm ?? l.landSqm; return area && (l.pricePeriod === "TOTAL" || l.pricePeriod === "YEAR") ? l.priceKobo / BigInt(area) : null; };
  const best = (vals: (bigint | null)[]) => { const v = vals.filter((x): x is bigint => x !== null); return v.length > 1 ? v.reduce((a, b) => (b < a ? b : a)) : null; };
  const bestSqm = best(rows.map(perSqm));
  const ref = await refData();
  const typeL = labelsOf(ref, "PROPERTY_TYPE"), titleL = labelsOf(ref, "TITLE_DOCUMENT"), amenL = labelsOf(ref, "AMENITY");
  const allAmenities = [...new Set(rows.flatMap((r) => parseAmenities(r.amenities, Object.keys(amenL))))];
  const market = rows.length > 1 ? await marketOverview().catch(() => null) : null;
  const shortName = (t: string) => (t.length > 40 ? `${t.slice(0, 38).trimEnd()}…` : t);
  const notes = compareNotes(rows.map((l) => ({
    ref: l.publicRef, name: `“${shortName(l.title)}”`, purpose: l.purpose, pricePeriod: l.pricePeriod, priceKobo: l.promo?.promoKobo ?? l.priceKobo, serviceChargeKobo: l.serviceChargeKobo,
    bedrooms: l.bedrooms, buildingSqm: l.buildingSqm, landSqm: l.landSqm, city: l.city, propertyType: l.propertyType, titleDocument: l.titleDocument,
    furnishing: l.furnishing, serviced: l.serviced, amenities: parseAmenities(l.amenities, Object.keys(amenL)), verifiedCompany: (trust.get(l.companyId)?.level ?? 0) >= 2,
  })), market?.cities ?? [], (c) => amenL[c] ?? c);
  const line = (name: string, f: (l: (typeof rows)[number]) => React.ReactNode) => <tr key={name}><th scope="row">{name}</th>{rows.map((l) => <td key={l.id}>{f(l)}</td>)}</tr>;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Compare properties</h1>
        <p className="muted">Up to four side by side. Pick properties with “+ Compare” on any listing. Figures are as the listing companies state them; title documents are not verified by the platform.</p>
      </div>
      {rows.length === 0 ? (
        <div className="card stack"><p>Nothing to compare yet. Open properties and press “+ Compare”, or start from <Link href="/browse">search</Link>.</p></div>
      ) : (
        <>
        {notes.length ? (
          <section className="card stack compare-notes" aria-labelledby="diff-h">
            <h2 id="diff-h">What is different</h2>
            <ul>{notes.slice(0, 4).map((n) => <li key={n}>{n}</li>)}</ul>
            {notes.length > 4 ? <details className="inline"><summary>{notes.length - 4} more differences</summary><ul>{notes.slice(4).map((n) => <li key={n}>{n}</li>)}</ul></details> : null}
            <p className="small muted">Worked out from what each listing states and from asking prices of similar homes on the platform. It is not advice on which to choose.</p>
          </section>
        ) : null}
        <div className="table-wrap compare-wrap">
          <table className="compare">
            <thead>
              <tr><th scope="col"><span className="visually-hidden">Detail</span></th>{rows.map((l) => (
                <th key={l.id} scope="col">
                  <Link href={`/properties/${l.publicRef}`} className="compare-head"><span className="prop-img"><PropPhoto id={l.coverPhotoId} /></span><strong>{l.title}</strong></Link>
                  <RemoveFromCompare refId={l.publicRef} all={rows.map((r) => r.publicRef)} />
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {line("Price", (l) => <strong>{formatKobo(l.promo?.promoKobo ?? l.priceKobo)}{priceSuffix(l.pricePeriod)}{l.promo ? ` (${l.promo.pct}% off)` : ""}{l.negotiable ? ", negotiable" : ""}</strong>)}
              {line("Price per m²", (l) => { const v = perSqm(l); return v === null ? "—" : <span className={bestSqm !== null && v === bestSqm ? "best" : undefined}>{formatKobo(v)}{bestSqm !== null && v === bestSqm ? " (lowest)" : ""}</span>; })}
              {line("Yearly cost to occupy", (l) => { const y = yearly(l); return y === null ? "—" : formatKobo(y + (l.serviceChargeKobo ?? 0n)); })}
              {line("Caution deposit", (l) => (l.depositKobo != null ? formatKobo(l.depositKobo) : "—"))}
              {line("Service charge per year", (l) => (l.serviceChargeKobo != null ? formatKobo(l.serviceChargeKobo) : "—"))}
              {line("Other fees", (l) => l.feesNote || "—")}
              {line("Location", (l) => `${l.city}, ${l.state}`)}
              {line("Type", (l) => label(typeL, l.propertyType))}
              {line("Purpose", (l) => (l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`))}
              {line("Bedrooms / bathrooms / toilets", (l) => [l.bedrooms, l.bathrooms, l.toilets].map((n) => (n ?? "–")).join(" / "))}
              {line("Building size", (l) => (l.buildingSqm != null ? `${l.buildingSqm.toLocaleString("en-NG")} m²` : "—"))}
              {line("Land size", (l) => (l.landSqm != null ? `${l.landSqm.toLocaleString("en-NG")} m²` : "—"))}
              {line("Furnishing", (l) => label(FURNISHING, l.furnishing))}
              {line("Condition", (l) => label(CONDITIONS, l.condition))}
              {line("Construction", (l) => label(CONSTRUCTION, l.constructionStatus))}
              {line("Serviced", (l) => (l.serviced ? "Yes" : "No"))}
              {line("Available from", (l) => (l.availableFrom ? formatDate(l.availableFrom) : "Now or not stated"))}
              {line("Minimum lease", (l) => (l.minLeaseMonths ? `${l.minLeaseMonths} months` : "—"))}
              {line("Title document (as stated)", (l) => label(titleL, l.titleDocument, "Not stated"))}
              {line("Listed by", (l) => <span className="stack" style={{ gap: 4 }}><span>{names.find((n) => n.companyId === l.companyId)?.displayName ?? "A registered company"}</span>{trust.get(l.companyId) ? <TrustBadge t={trust.get(l.companyId)!} /> : null}</span>)}
              {allAmenities.map((a) => line(amenL[a], (l) => (l.amenities.split(",").includes(a) ? <span className="yes">✓ Yes</span> : <span className="muted">–</span>)))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="small"><Link href="/calculators">Work out the full cost with the calculators</Link></p>
    </div>
  );
}
