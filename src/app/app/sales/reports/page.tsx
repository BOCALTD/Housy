import SaveDocument from "@/components/SaveDocument";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { companyReport } from "@/lib/services/sales";
import { parseDateOnly, toDateOnlyString, todayInLagos, formatDate } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { Flash, ShowMore, TableMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Sales reports" };

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default async function SalesReportsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("crm.report");
  const today = todayInLagos();
  let from = parseDateOnly(`${today.getUTCFullYear()}-01-01`);
  let to = today;
  let error = sp(searchParams, "error");
  try {
    if (sp(searchParams, "from")) from = parseDateOnly(sp(searchParams, "from")!);
    if (sp(searchParams, "to")) to = parseDateOnly(sp(searchParams, "to")!);
  } catch { error = "Use dates in the form YYYY-MM-DD."; }
  let r;
  try { r = await companyReport(member, { from, to }); } catch (e) { error = e instanceof Error ? e.message : "Could not build the report."; }
  const qs = `from=${toDateOnlyString(from)}&to=${toDateOnlyString(to)}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Sales reports</h1><p className="muted">Conversion, pipeline and completed deals for the whole company. <Link href="/app/sales">Sales dashboard</Link></p></div>
      <Flash searchParams={{ error, notice: sp(searchParams, "notice") }} />
      <section className="card">
        <form className="row" method="get"><label>From <input type="date" name="from" defaultValue={toDateOnlyString(from)} /></label><label>To <input type="date" name="to" defaultValue={toDateOnlyString(to)} /></label><button className="btn" type="submit">Show</button></form>
      </section>
      {r ? (
        <>
          <section className="stats" aria-label="Conversion">
            <div className="stat"><b>{r.leads.total}</b><span>Leads opened</span></div>
            <div className="stat"><b>{pct(r.leads.qualifiedBps)}</b><span>Qualified</span></div>
            <div className="stat"><b>{pct(r.leads.convertedBps)}</b><span>Became deals</span></div>
            <div className="stat"><b>{r.completedTotals.count}</b><span>Deals completed</span></div>
            <div className="stat"><b>{formatKobo(r.completedTotals.valueKobo)}</b><span>Completed value</span></div>
          </section>

          <section className="card">
            <h2>Lead sources</h2>
            {r.bySource.length === 0 ? <p className="muted">No leads in this period.</p> : (
              <TableMore limit={6} noun="more sources" head={<tr><th>Source</th><th>Leads</th><th>Qualified</th><th>Became deals</th><th>Rate</th></tr>}
                rows={r.bySource.map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.leads}</td><td>{s.qualified}</td><td>{s.converted}</td><td>{pct(s.convertedBps)}</td></tr>)} />
            )}
            <SaveDocument url={`/app/sales/export?kind=sources&${qs}`} fallbackName="lead-sources.csv" />
          </section>

          <section className="card">
            <h2>Pipeline today</h2>
            <p className="small muted">{r.pipelineTotals.count} deals in progress, {formatKobo(r.pipelineTotals.valueKobo)} (agreed price where there is one, otherwise asking).</p>
            <TableMore limit={7} noun="more stages" head={<tr><th>Stage</th><th>Deals</th><th>Disputed</th><th>Value</th></tr>}
              rows={r.pipeline.map((p) => <tr key={p.stage}><td>{humanize(p.stage)}</td><td>{p.count}</td><td>{p.disputed}</td><td>{formatKobo(p.valueKobo)}</td></tr>)} />
            <SaveDocument url={`/app/sales/export?kind=pipeline&${qs}`} fallbackName="pipeline.csv" />
          </section>

          <section className="card">
            <h2>Completed deals</h2>
            {r.completed.length === 0 ? <p className="muted">No deals completed in this period.</p> : (
              <ShowMore noun="more deals" limit={6} items={r.completed.map((d) => (
                <li key={d.id}><div><Link href={`/app/deals/${d.id}`}><strong>{d.ref}</strong> {d.title}</Link><div className="small muted">{d.client} · {d.asset} · {formatDate(d.completedAt)} · {formatKobo(d.agreedKobo)} · owner {d.owner}{d.commissionKobo !== null ? ` · commission ${formatKobo(d.commissionKobo)} (${humanize(d.commissionStatus ?? "")})` : " · no commission yet"}</div></div></li>))} />
            )}
            <SaveDocument url={`/app/sales/export?kind=completed&${qs}`} fallbackName="completed-deals.csv" />
          </section>

          <section className="card">
            <h2>Cancelled deals and commission</h2>
            <p>{r.cancelled.count} cancelled in this period. Commission on deals completed in the period: {formatKobo(r.commission.proposedKobo)} waiting for approval, {formatKobo(r.commission.approvedKobo)} approved, {formatKobo(r.commission.paidKobo)} paid.</p>
            {r.cancelled.reasons.length > 0 ? <details className="inline"><summary>Reasons given</summary><ul>{r.cancelled.reasons.map((x) => <li key={x.reason}>{x.reason} ({x.count})</li>)}</ul></details> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
