import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { casesForAdmin } from "@/lib/services/verification-cases";
import { providersForAdmin } from "@/lib/services/verification-network";
import { STATES } from "@/lib/geo-rules";
import { CASE_STATUSES, CASE_STATUS_WORDS } from "@/lib/verification-case-rules";
import { SERVICE_CATEGORIES } from "@/lib/verification-network-rules";
import { Flash, Pager, sp, type SP } from "@/components/ui";
import { CaseStatusPill, day, serviceName } from "@/app/verification/case-ui";

export const metadata = { title: "Verification cases" };
export const dynamic = "force-dynamic";

export default async function AdminCases({ searchParams: s }: { searchParams?: Promise<SP> }) {
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const f = { status: sp(searchParams, "status") || undefined, q: sp(searchParams, "q") || undefined, state: sp(searchParams, "state") || undefined, service: sp(searchParams, "service") || undefined, provider: sp(searchParams, "provider") || undefined, page: Number(sp(searchParams, "page") || 1) };
  const [data, providers] = await Promise.all([casesForAdmin(admin.id, f), providersForAdmin(admin.id)]);
  const qs = (page: number) => `/admin/verification/cases?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "page")) as Record<string, string>, page: String(page) })}`;
  const n = (k: string) => data.byStatus[k] ?? 0;
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin/verification">Verification network</Link>
        <h1>Verification cases</h1>
        <p className="muted">Customers&apos; requests: confirm them, offer each to a qualified provider, review the provider&apos;s report and release it.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="vp-stats" aria-label="Cases at a glance">
        <Link className="card" href="/admin/verification/cases?status=REQUESTED"><span className="vp-stat">{n("REQUESTED")}</span><span className="small muted">New requests</span></Link>
        <Link className="card" href="/admin/verification/cases?status=READY_FOR_ASSIGNMENT"><span className="vp-stat">{n("READY_FOR_ASSIGNMENT")}</span><span className="small muted">Need a provider</span></Link>
        <Link className="card" href="/admin/verification/cases?status=ASSIGNED"><span className="vp-stat">{n("ASSIGNED")}</span><span className="small muted">Waiting for a provider&apos;s answer</span></Link>
        <Link className="card" href="/admin/verification/cases?status=SUBMITTED_TO_HOUSY"><span className="vp-stat">{n("SUBMITTED_TO_HOUSY") + n("PLATFORM_REVIEW")}</span><span className="small muted">Reports to review</span></Link>
        <Link className="card" href="/admin/verification/cases?status=APPROVED_FOR_RELEASE"><span className="vp-stat">{n("APPROVED_FOR_RELEASE")}</span><span className="small muted">Ready to release</span></Link>
        <Link className="card" href="/admin/verification/cases?status=DISPUTED"><span className="vp-stat">{n("DISPUTED")}</span><span className="small muted">Disputed</span></Link>
      </section>
      <section className="card stack">
        <form className="vp-filters" method="get">
          <label className="field">Search<input name="q" defaultValue={f.q} placeholder="Reference or address" /></label>
          <label className="field">Status<select name="status" defaultValue={f.status ?? ""}><option value="">All</option>{CASE_STATUSES.map((x) => <option key={x} value={x}>{CASE_STATUS_WORDS[x]} ({n(x)})</option>)}</select></label>
          <label className="field">State<select name="state" defaultValue={f.state ?? ""}><option value="">Any</option>{STATES.map((st) => <option key={st.name}>{st.name}</option>)}</select></label>
          <label className="field">Service<select name="service" defaultValue={f.service ?? ""}><option value="">Any</option>{SERVICE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
          <label className="field">Provider<select name="provider" defaultValue={f.provider ?? ""}><option value="">Any</option>{providers.filter((p) => p.providerCode).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button className="btn" type="submit">Filter</button>
        </form>
        {data.rows.length === 0 ? <p className="muted">No cases match.</p> : (
          <div className="table-wrap"><table className="table stack-table vp-table">
            <thead><tr><th>Reference</th><th>Property</th><th>Status</th><th>Provider</th><th>Sent</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.ref}>
                <td data-label="Reference"><Link href={`/admin/verification/cases/${r.ref}`}>{r.ref}</Link>{r.priority === "URGENT" ? <div className="small warn-text">Urgent</div> : null}</td>
                <td data-label="Property"><strong>{r.propertyAddress}</strong><div className="small muted">{r.state} · {r.services.map(serviceName).join(", ")}</div></td>
                <td data-label="Status"><CaseStatusPill status={r.status} /></td>
                <td data-label="Provider">{r.providerName || "—"}</td>
                <td data-label="Sent">{day(r.createdAt)}{r.requiredBy ? <div className="small muted">due {day(r.requiredBy)}</div> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager page={data.page} total={data.total} pageSize={data.size} href={qs} noun="cases" />
      </section>
    </div>
  );
}
