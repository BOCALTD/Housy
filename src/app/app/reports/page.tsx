import SaveDocument from "@/components/SaveDocument";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { rentReport } from "@/lib/services/reports";
import { formatKobo } from "@/lib/money";
import { formatDate, parseDateOnly, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { Field, Flash, Pager, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Rent reports" };

export default async function ReportsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("finance.view");
  const today = todayInLagos();
  let from = parseDateOnly(`${today.getUTCFullYear()}-01-01`);
  let to = today;
  let problem: string | undefined;
  try {
    const f = sp(searchParams, "from");
    const t = sp(searchParams, "to");
    if (f) from = parseDateOnly(f);
    if (t) to = parseDateOnly(t);
  } catch (err) {
    problem = err instanceof Error ? err.message : "Check the dates";
  }
  let report = null;
  if (!problem) {
    try { report = await rentReport(member, { from, to }); } catch (err) { problem = err instanceof Error ? err.message : "Could not build the report"; }
  }
  const fromText = toDateOnlyString(from);
  const toText = toDateOnlyString(to);
  const PAGE = 25;
  const page = Math.max(0, Number.parseInt(sp(searchParams, "page") ?? "0", 10) || 0);
  const pageHref = (p: number) => `/app/reports?from=${fromText}&to=${toText}&page=${p}`;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Rent reports</h1>
        <p className="muted">Billed is rent falling due in the period. Collected is money received in the period on receipts that have not been reversed. Arrears are what is overdue today after grace periods.</p>
      </div>
      <Flash searchParams={{ error: problem ?? sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <form className="row" role="search" aria-label="Report period">
        <Field label="From"><input name="from" type="date" defaultValue={fromText} /></Field>
        <Field label="To"><input name="to" type="date" defaultValue={toText} /></Field>
        <button className="btn" type="submit">Update</button>
        {report ? <SaveDocument url={`/app/reports/rent.csv?from=${fromText}&to=${toText}`} fallbackName="rent-report.csv" label="Save or share the CSV" /> : null}
      </form>

      {report ? (
        <>
          <section className="stats" aria-label="Portfolio totals">
            <div className="stat"><b>{formatKobo(report.totals.billedKobo)}</b><span>Billed</span></div>
            <div className="stat"><b>{formatKobo(report.totals.collectedKobo)}</b><span>Collected</span></div>
            <div className={`stat${report.totals.arrearsKobo > 0n ? " alert" : ""}`}><b>{formatKobo(report.totals.arrearsKobo)}</b><span>Arrears today</span></div>
            <div className="stat"><b>{report.totals.activeLeases}</b><span>Active leases</span></div>
          </section>

          <section className="card table-wrap" aria-labelledby="prop-h">
            <h2 id="prop-h">By property</h2>
            {report.rows.length === 0 ? <p className="muted">No properties have leases yet.</p> : (
              <><div className="table-wrap"><table><thead><tr><th>Property</th><th>Active leases</th><th>Billed</th><th>Collected</th><th>Arrears today</th></tr></thead><tbody>{report.rows.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
                    <tr key={r.assetId}>
                      <td><Link href={`/app/assets/${r.assetId}`}>{r.assetRef} · {r.assetName}</Link></td>
                      <td>{r.activeLeases}</td><td>{formatKobo(r.billedKobo)}</td><td>{formatKobo(r.collectedKobo)}</td><td>{formatKobo(r.arrearsKobo)}</td>
                    </tr>
                  ))}</tbody></table></div><Pager page={page} total={report.rows.length} pageSize={PAGE} href={pageHref} noun="properties" /></>
            )}
          </section>

          <div className="two">
            <section className="card" aria-labelledby="age-h">
              <h2 id="age-h">Arrears by age</h2>
              <ShowMore noun="more" limit={5} items={report.ageing.map((a) => (
                  <li key={a.bucket}><div>{a.bucket}: <strong>{formatKobo(a.kobo)}</strong> <span className="small muted">({a.charges} charge{a.charges === 1 ? "" : "s"})</span></div></li>
                ))} />
            </section>
            <section className="card" aria-labelledby="exp-h">
              <h2 id="exp-h">Leases ending in {report.leadDays} days</h2>
              {report.expiries.length === 0 ? <p className="muted">None, or they have already been renewed.</p> : (
                <ShowMore noun="more" limit={5} items={report.expiries.map((e) => (
                    <li key={e.leaseId}><div><Link href={`/app/leases/${e.leaseId}`}>{e.occupant}</Link><div className="small muted">{e.assetRef} · {e.assetName} · ends {formatDate(e.endDate)} ({e.days} day{e.days === 1 ? "" : "s"})</div></div></li>
                  ))} />
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
