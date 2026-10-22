import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ownerPortal } from "@/lib/services/portals";
import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Pill, ShowMore, TableMore } from "@/components/ui";

export const metadata = { title: "Owner portal", robots: { index: false } };
export const dynamic = "force-dynamic";

const OPEN_WO = ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"];

export default async function OwnerPortal({ params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/.test(grantId)) notFound();
  const data = await ownerPortal(user.id, grantId);
  if (!data) notFound();
  const { grant, assets, leases, workOrders, reports } = data;
  const nameOf = new Map(assets.map((a) => [a.id, a.name]));
  const active = leases.filter((l) => l.status === "ACTIVE");
  const outstanding = active.reduce((s, l) => s + l.rent.overdueKobo, 0n);
  const openJobs = workOrders.filter((w) => OPEN_WO.includes(w.status));
  const views = assets.reduce((s, a) => s + (a.listing?.views30 ?? 0), 0);
  const enquiries = assets.reduce((s, a) => s + (a.listing?.enquiries30 ?? 0), 0);
  const spent = workOrders.reduce((s, w) => s + (w.actualCostKobo ?? 0n), 0n);

  return (
    <div className="stack-lg">
      <div className="portal-head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">Owner portal · {grant.companyName}</p>
          <h1>{grant.displayName}</h1>
          <p className="muted small">Read-only. These are {grant.companyName}&apos;s records for the {assets.length === 1 ? "property" : `${assets.length} properties`} they manage for you. Ask them to correct anything that looks wrong.</p>
        </div>
        <Link className="btn" href="/portal">All portals</Link>
      </div>

      <div className="portal-kpis" role="list">
        <div className="kpi" role="listitem"><strong>{assets.length}</strong><span>Properties</span></div>
        <div className="kpi" role="listitem"><strong>{active.length}</strong><span>Active tenancies</span></div>
        <div className="kpi" role="listitem"><strong>{formatKobo(outstanding)}</strong><span>Rent outstanding</span></div>
        <div className="kpi" role="listitem"><strong>{openJobs.length}</strong><span>Open maintenance jobs</span></div>
        <div className="kpi" role="listitem"><strong>{views}</strong><span>Listing visits, 30 days</span></div>
        <div className="kpi" role="listitem"><strong>{enquiries}</strong><span>Enquiries, 30 days</span></div>
      </div>

      <section className="card stack"><h2>Properties and listings</h2>
        <TableMore stacked limit={8} noun="more properties" head={<tr><th>Property</th><th>Listing</th><th className="r">Visits (30 days)</th><th className="r">Enquiries</th><th>Inspections</th></tr>} rows={assets.map((a) => {
          const l = a.listing;
          const b = l?.bookings ?? {};
          const done = b.COMPLETED ?? 0, upcoming = (b.REQUESTED ?? 0) + (b.CONFIRMED ?? 0) + (b.RESCHEDULED ?? 0) + (b.EN_ROUTE ?? 0) + (b.ARRIVED ?? 0);
          return (
            <tr key={a.id}>
              <td><strong>{a.name}</strong><div className="small muted">{a.ref}{a.city ? ` · ${a.city}` : ""}</div></td>
              <td data-label="Listing">{l ? <><Pill status={l.status} label={humanize(l.status)} />{l.status === "PUBLISHED" ? <div className="small"><Link className="tap" href={`/properties/${l.publicRef}`}>{formatKobo(l.priceKobo)}</Link></div> : <div className="small muted">{formatKobo(l.priceKobo)}</div>}</> : <span className="muted small">Not listed</span>}</td>
              <td className="r" data-label="Visits (30 days)">{l ? l.views30 : "—"}</td>
              <td className="r" data-label="Enquiries">{l ? <>{l.enquiries30}<div className="small muted">{l.enquiriesAll} in all</div></> : "—"}</td>
              <td data-label="Inspections">{l ? <span className="small">{done} done · {upcoming} upcoming{b.CANCELLED ? ` · ${b.CANCELLED} cancelled` : ""}</span> : "—"}</td>
            </tr>
          );
        })} />
        <p className="small muted">Enquiries and inspection requests are counted here; the people who made them are not named, to protect their privacy.</p>
      </section>

      <section className="card stack"><h2>Tenancies and rent</h2>
        {leases.length === 0 ? <p className="muted">No tenancies recorded.</p> : (
          <TableMore stacked limit={8} noun="more tenancies" head={<tr><th>Tenancy</th><th>Term</th><th className="r">Rent</th><th className="r">Paid of due</th><th>Next due</th></tr>} rows={leases.map((l) => (
            <tr key={l.id}>
              <td><strong>{l.occupantName}</strong><div className="small muted">{nameOf.get(l.assetId)}{l.unit ? ` · ${l.unit}` : ""} · {l.ref}</div><Pill status={l.status} label={humanize(l.status)} /></td>
              <td className="small" data-label="Term">{formatDate(l.startDate)} to {formatDate(l.endDate)}</td>
              <td className="r" data-label="Rent">{formatKobo(l.rentKobo)}<div className="small muted">{humanize(l.frequency)}</div></td>
              <td className="r" data-label="Paid of due">{formatKobo(l.rent.paidKobo)}<div className="small muted">of {formatKobo(l.rent.dueKobo)}{l.rent.overdueKobo > 0n ? ` · ${formatKobo(l.rent.overdueKobo)} outstanding` : ""}</div></td>
              <td className="small" data-label="Next due">{l.rent.nextDue ? formatDate(l.rent.nextDue) : "—"}</td>
            </tr>
          ))} />
        )}
      </section>

      <section className="card stack"><h2>Maintenance</h2>
        <p className="small muted">{openJobs.length} open · {formatKobo(spent)} spent on completed jobs shown here.</p>
        {workOrders.length === 0 ? <p className="muted">No maintenance recorded.</p> : (
          <ShowMore limit={6} noun="more jobs" items={workOrders.map((w) => (
            <li key={w.id}><div className="job-row" style={{ borderBottom: 0 }}>
              <span><strong>{w.ref}</strong> · {w.title}<span className="small muted"> · {nameOf.get(w.assetId)} · reported {formatDate(w.createdAt)}{w.completedOn ? ` · completed ${formatDate(w.completedOn)}` : ""}{w.actualCostKobo !== null ? ` · ${formatKobo(w.actualCostKobo)}` : w.approvedCostKobo !== null ? ` · approved ${formatKobo(w.approvedCostKobo)}` : ""}</span></span>
              <Pill status={OPEN_WO.includes(w.status) ? "OPEN" : w.status === "CANCELLED" ? "SUSPENDED" : "ACTIVE"} label={humanize(w.status)} />
            </div></li>
          ))} />
        )}
      </section>

      <section className="card stack"><h2>Approved reports</h2>
        {reports.length === 0 ? <p className="muted">No approved valuation reports yet.</p> : (
          <ShowMore limit={5} noun="more reports" items={reports.map((r) => (
            <li key={r.id}><div>
              <strong>{r.instruction.ref} · version {r.version}</strong>{r.concludedValueKobo !== null ? <> · {formatKobo(r.concludedValueKobo)}</> : null}
              <div className="small muted">{nameOf.get(r.instruction.assetId)} · {humanize(r.instruction.purpose)}{r.decidedAt ? ` · approved ${formatDate(r.decidedAt)}` : ""}</div>
              {r.summary ? <p className="small">{r.summary.slice(0, 400)}{r.summary.length > 400 ? "…" : ""}</p> : null}
            </div></li>
          ))} />
        )}
      </section>
    </div>
  );
}
