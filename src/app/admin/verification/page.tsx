import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { applicationsForAdmin, networkCounts, providersForAdmin, serviceCategories } from "@/lib/services/verification-network";
import { STATES } from "@/lib/geo-rules";
import { APPLICATION_STATUSES, APPLICATION_STATUS_WORDS, type ApplicationStatus } from "@/lib/verification-network-rules";
import { Flash, Pager, sp, type SP } from "@/components/ui";

export const metadata = { title: "Verification network" };
export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function VerificationConsole({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const f = { status: sp(searchParams, "status") || undefined, q: sp(searchParams, "q") || undefined, state: sp(searchParams, "state") || undefined, service: sp(searchParams, "service") || undefined, page: Number(sp(searchParams, "page") || 1) };
  const [counts, apps, providers, cats] = await Promise.all([networkCounts(admin.id), applicationsForAdmin(admin.id, f), providersForAdmin(admin.id), serviceCategories(false)]);
  const qs = (page: number) => `/admin/verification?${new URLSearchParams({ ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}), ...(f.state ? { state: f.state } : {}), ...(f.service ? { service: f.service } : {}), page: String(page) })}`;
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Verification network</h1>
        <p className="muted">Independent provider organisations apply here, are vetted by Housy, and run their own dashboards. Every provider, BOCA included, goes through the same process.</p>
        <p><Link className="btn" href="/admin/verification/cases">Verification cases from customers</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="vp-stats" aria-label="Network at a glance">
        <div className="card"><span className="vp-stat">{counts.pending}</span><span className="small muted">Applications to review</span></div>
        <div className="card"><span className="vp-stat">{counts.waitingOnApplicant}</span><span className="small muted">Waiting on the applicant</span></div>
        <div className="card"><span className="vp-stat">{counts.approved}</span><span className="small muted">Providers working</span></div>
        <div className="card"><span className="vp-stat">{counts.vetted}</span><span className="small muted">Vetted through an application</span></div>
        <div className="card"><span className="vp-stat">{counts.suspended}</span><span className="small muted">Suspended</span></div>
      </section>

      <section className="card stack">
        <h2>Applications</h2>
        <form className="vp-filters" method="get">
          <label className="field">Search<input name="q" defaultValue={f.q} placeholder="Name, reference or CAC number" /></label>
          <label className="field">Status<select name="status" defaultValue={f.status ?? ""}><option value="">All sent</option>{APPLICATION_STATUSES.map((x) => <option key={x} value={x}>{APPLICATION_STATUS_WORDS[x]} ({apps.counts[x] ?? 0})</option>)}</select></label>
          <label className="field">State<select name="state" defaultValue={f.state ?? ""}><option value="">Any</option>{STATES.map((st) => <option key={st.name}>{st.name}</option>)}</select></label>
          <label className="field">Service<select name="service" defaultValue={f.service ?? ""}><option value="">Any</option>{cats.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <button className="btn" type="submit">Filter</button>
        </form>
        {apps.rows.length === 0 ? <p className="muted">No applications match.</p> : (
          <div className="table-wrap"><table className="table stack-table vp-table">
            <thead><tr><th>Reference</th><th>Organisation</th><th>Status</th><th>States</th><th>Sent</th></tr></thead>
            <tbody>{apps.rows.map((r) => (
              <tr key={r.ref}>
                <td data-label="Reference"><Link href={`/admin/verification/applications/${r.ref}`}>{r.ref}</Link></td>
                <td data-label="Organisation"><strong>{r.registeredName || "Not named yet"}</strong><div className="small muted">{r.cacNumber}</div></td>
                <td data-label="Status"><span className={`pill ${r.status === "APPROVED" ? "ok" : r.status === "REJECTED" ? "bad" : ["SUBMITTED", "RESUBMITTED"].includes(r.status) ? "warn" : ""}`}>{APPLICATION_STATUS_WORDS[r.status as ApplicationStatus]}</span></td>
                <td data-label="States">{r.states.slice(0, 3).join(", ")}{r.states.length > 3 ? ` +${r.states.length - 3}` : ""}</td>
                <td data-label="Sent">{day(r.submittedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager page={apps.page - 1} total={apps.total} pageSize={apps.size} href={(i) => qs(i + 1)} noun="applications" />
      </section>

      <section className="card stack">
        <h2>Providers</h2>
        <div className="table-wrap"><table className="table stack-table vp-table">
          <thead><tr><th>Provider</th><th>ID</th><th>Status</th><th>Staff</th><th>Approved for</th></tr></thead>
          <tbody>{providers.map((p) => (
            <tr key={p.id}>
              <td data-label="Provider"><Link href={`/admin/verification/providers/${p.id}`}><strong>{p.name}</strong></Link></td>
              <td data-label="ID">{p.providerCode ?? <span className="muted">Not vetted</span>}</td>
              <td data-label="Status"><span className={`pill ${p.suspendedAt ? "bad" : p.status === "APPROVED" ? "ok" : "warn"}`}>{p.suspendedAt ? "Suspended" : p.status === "APPROVED" ? (p.vettedAt ? "Working" : "Listed, not vetted") : "Pending"}</span></td>
              <td data-label="Staff">{p._count.members}</td>
              <td data-label="Approved for">{p.allowedServices.length} services · {p.allowedStates.length} states</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}
