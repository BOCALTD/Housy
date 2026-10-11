import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { dashboard } from "@/lib/services/dashboard";
import { correspondenceSummary } from "@/lib/services/correspondence";
import { expiringDocuments, overdueFileCount } from "@/lib/services/files";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Flash, sp, type SP } from "@/components/ui";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember();
  const [d, corr, filesOverdue, expiring] = await Promise.all([
    dashboard(member), correspondenceSummary(member), overdueFileCount(member), expiringDocuments(member, 60),
  ]);
  const s = (k: string) => d.statusCounts[k] ?? 0;

  return (
    <div className="stack-lg">
      <div className="row between">
        <h1>Dashboard</h1>
        {can(member.role, "asset.create") ? <Link className="btn primary" href="/app/assets/new">Register an asset</Link> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Portfolio summary">
        <div className="stat"><b>{d.totalAssets}</b><span>Assets registered</span></div>
        <div className="stat"><b>{s("OCCUPIED")}</b><span>Occupied</span></div>
        <div className="stat"><b>{s("VACANT")}</b><span>Vacant</span></div>
        <div className={`stat${d.overdueCharges ? " alert" : ""}`}>
          <b>{formatKobo(d.overdueKobo)}</b><span>Overdue rent ({d.overdueCharges} charges)</span>
        </div>
        <div className={`stat${d.overdueTasks ? " alert" : ""}`}>
          <b>{d.openTasks}</b><span>Open tasks ({d.overdueTasks} overdue)</span>
        </div>
        <div className="stat"><b>{d.enquiries30d}</b><span>Enquiries, last 30 days</span></div>
      </section>

      <section className="stats" aria-label="Administration alerts">
        <Link href="/app/correspondence?view=overdue" className={`stat${corr.overdue ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{corr.overdue}</b><span>Overdue correspondence replies</span>
        </Link>
        <Link href="/app/correspondence?view=unassigned" className="stat" style={{ textDecoration: "none" }}>
          <b>{corr.unassigned}</b><span>Unassigned letters</span>
        </Link>
        <Link href="/app/correspondence?view=mine" className="stat" style={{ textDecoration: "none" }}>
          <b>{corr.mine}</b><span>Letters assigned to me</span>
        </Link>
        <Link href="/app/files?view=overdue" className={`stat${filesOverdue ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{filesOverdue}</b><span>Files overdue for return</span>
        </Link>
        <Link href="/app/files" className={`stat${expiring.length ? " alert" : ""}`} style={{ textDecoration: "none" }}>
          <b>{expiring.length}</b><span>Documents expiring within 60 days</span>
        </Link>
      </section>

      <div className="two">
        <section className="card">
          <h2>Recent activity</h2>
          {d.recent.length === 0 ? (
            <p className="muted">Nothing yet. Register your first asset to get started.</p>
          ) : (
            <ul className="timeline">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <div>
                    <div>{humanize(r.action.replace(".", " "))}</div>
                    <div className="small muted">{formatDateTime(r.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Leases ending in 90 days</h2>
          {d.expiring.length === 0 ? (
            <p className="muted">No leases end in the next 90 days.</p>
          ) : (
            <ul className="timeline">
              {d.expiring.map((l) => (
                <li key={l.id}>
                  <div>
                    <Link href={`/app/assets/${l.asset.id}`}>{l.asset.name}</Link>
                    <div className="small muted">{l.ref} · {l.occupantName} · ends {formatDate(l.endDate)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
