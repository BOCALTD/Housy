import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { companyAnalytics } from "@/lib/services/analytics";
import { companyBenchmarks, companyForecast } from "@/lib/services/market";
import { MIN_PEERS, compactNaira } from "@/lib/market-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";

export const metadata = { title: "Portfolio analytics" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((n / d) * 100))));

function Bar({ label, value, of, text, warn }: { label: string; value: number; of: number; text: string; warn?: boolean }) {
  return <div className="barrow"><span className="small">{label}</span><div className={`bar${warn ? " warn" : ""}`} role="img" aria-label={`${label}: ${text}`}><span style={{ width: `${pct(value, of)}%` }} /></div><span className="small">{text}</span></div>;
}

export default async function AnalyticsPage() {
  const member = await requireMember();
  const [a, bench, fc] = await Promise.all([companyAnalytics(member), companyBenchmarks(member).catch(() => null), companyForecast(member).catch(() => null)]);
  if (!a) return <div className="card"><p>Your role does not include portfolio analytics.</p></div>;
  const o = a.occupancy, ar = a.arrears, m = a.maintenance, v = a.values, p = a.projects, c = a.compliance;
  return (
    <div className="stack-lg">
      <div className="row between"><div className="stack" style={{ gap: 4 }}><h1>Portfolio analytics</h1><p className="small muted">Counted from your company&apos;s records at {formatDateTime(a.generatedOn)}. Panels show only what your role may see.</p></div>
        <div className="row">{can(member.role, "ai.use") ? <Link className="btn" href="/app/assistant">Ask a question</Link> : null}<Link className="btn" href="/app/completeness">Missing information</Link><Link className="btn" href="/app/map">Map</Link></div></div>

      {o ? (
        <section className="card stack" aria-labelledby="occ-h">
          <h2 id="occ-h">Occupancy</h2>
          <div className="stats">
            <div className="stat"><b>{o.ratePct === null ? "–" : `${o.ratePct}%`}</b><span>Occupied of {o.leasable} lettable</span></div>
            <div className="stat"><b>{o.vacant}</b><span>Vacant</span></div>
            <div className="stat"><b>{o.renovating}</b><span>Under renovation</span></div>
            <div className="stat"><b>{o.leasesEnding.in30}</b><span>Leases end within 30 days ({o.leasesEnding.in90} within 90)</span></div>
          </div>
          {o.byCity.length ? <details className="inline"><summary>By city</summary><div className="stack">{o.byCity.map((x) => <Bar key={x.city} label={x.city} value={x.occupied} of={x.occupied + x.vacant} text={`${x.occupied} of ${x.occupied + x.vacant}`} />)}</div></details> : null}
        </section>
      ) : null}

      {ar ? (
        <section className="card stack" aria-labelledby="arr-h">
          <h2 id="arr-h">Arrears</h2>
          <div className="stats"><div className={`stat${ar.charges ? " alert" : ""}`}><b>{formatKobo(ar.totalKobo)}</b><span>Overdue across {ar.charges} charges</span></div></div>
          <div className="stack">{ar.buckets.map((b, i) => <Bar key={b.label} label={b.label} value={Number(b.kobo)} of={Number(ar.totalKobo)} text={`${formatKobo(b.kobo)} · ${b.charges}`} warn={i >= 2} />)}</div>
          {ar.top.length ? <details className="inline"><summary>Properties owed the most</summary><ul className="timeline">{ar.top.map((t) => <li key={t.asset}><div>{t.asset}</div><strong>{formatKobo(t.kobo)}</strong></li>)}</ul></details> : null}
        </section>
      ) : null}

      {m ? (
        <section className="card stack" aria-labelledby="mnt-h">
          <h2 id="mnt-h">Maintenance</h2>
          <div className="stats">
            <div className="stat"><b>{m.open}</b><span>Open work orders</span></div>
            <div className={`stat${m.overdue ? " alert" : ""}`}><b>{m.overdue}</b><span>Past target date</span></div>
            <div className="stat"><b>{m.urgent}</b><span>High priority</span></div>
            <div className="stat"><b>{m.avgDaysToComplete ?? "–"}</b><span>Days to complete, last 90 days</span></div>
            <div className="stat"><b>{formatKobo(m.cost90Kobo)}</b><span>Spent, last 90 days ({m.completed90} jobs)</span></div>
          </div>
          {m.byStatus.length ? <details className="inline"><summary>Open by stage</summary><div className="stack">{m.byStatus.map((s) => <Bar key={s.status} label={humanize(s.status)} value={s.n} of={m.open} text={String(s.n)} />)}</div></details> : null}
        </section>
      ) : null}

      {v ? (
        <section className="card stack" aria-labelledby="val-h">
          <h2 id="val-h">Portfolio value</h2>
          <div className="stats">
            <div className="stat"><b>{formatKobo(v.costKobo)}</b><span>Recorded cost</span></div>
            <div className="stat"><b>{formatKobo(v.valuedKobo)}</b><span>Approved valuations ({v.valuedAssets} properties)</span></div>
            <div className="stat"><b>{v.assetsWithoutValuation}</b><span>Not valued yet</span></div>
          </div>
          <p className="small muted">Valuations are counted only after a person has approved the report. {v.assetsWithoutCost ? `${v.assetsWithoutCost} properties have no cost recorded, so the cost total is understated.` : ""}</p>
        </section>
      ) : null}

      {p ? (
        <section className="card stack" aria-labelledby="prj-h">
          <h2 id="prj-h">Project progress</h2>
          {p.rows.length === 0 ? <p className="muted">No active projects.</p> : <div className="stack">{p.rows.map((r) => <div key={r.id} className="stack" style={{ gap: 4 }}><Bar label={`${r.ref} ${r.title}`} value={r.percent} of={100} text={`${r.percent}%`} warn={r.late} /><span className="small muted">Planned end {formatDate(r.plannedEnd)}{r.late ? " · past the planned end" : ""}</span></div>)}</div>}
          <Link className="small" href="/app/projects">All projects</Link>
        </section>
      ) : null}

      {c ? (
        <section className="card stack" aria-labelledby="cmp-h">
          <h2 id="cmp-h">Compliance deadlines</h2>
          <div className="stats">
            <div className={`stat${c.overdue ? " alert" : ""}`}><b>{c.overdue}</b><span>Overdue</span></div>
            <div className="stat"><b>{c.in30}</b><span>Due in 30 days</span></div>
            <div className="stat"><b>{c.in90}</b><span>Due in 90 days</span></div>
            <div className="stat"><b>{c.documentsExpiring90}</b><span>Documents expire within 90 days</span></div>
          </div>
          {c.next.length ? <details className="inline"><summary>Next deadlines</summary><ul className="timeline">{c.next.map((n) => <li key={n.id}><div>{n.title}</div><span className={n.overdue ? "pill SUSPENDED" : "small muted"}>{formatDate(n.dueDate)}{n.overdue ? " · overdue" : ""}</span></li>)}</ul></details> : null}
          <Link className="small" href="/app/compliance">Open the compliance calendar</Link>
        </section>
      ) : null}
      {fc ? <ForecastPanel f={fc} /> : null}
      {bench ? <BenchmarkPanel b={bench} /> : null}
    </div>
  );
}

type Forecast = NonNullable<Awaited<ReturnType<typeof companyForecast>>>;
type Bench = NonNullable<Awaited<ReturnType<typeof companyBenchmarks>>>;
const monthShort = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

function ForecastPanel({ f }: { f: Forecast }) {
  const due = f.months.reduce((s, m) => s + m.dueKobo, 0n), likely = f.months.reduce((s, m) => s + m.likelyKobo, 0n);
  const max = f.months.reduce((s, m) => (m.dueKobo > s ? m.dueKobo : s), 1n);
  return (
    <section className="card stack" aria-labelledby="fc-h">
      <h2 id="fc-h">Rent forecast, next 12 months</h2>
      <div className="stats">
        <div className="stat"><b>{formatKobo(due)}</b><span>Scheduled to fall due on active leases</span></div>
        <div className="stat"><b>{f.rate === null ? "–" : formatKobo(likely)}</b><span>{f.rate === null ? "Likely to come in: needs at least 6 past charges" : `Likely to come in at your ${Math.round(f.rate * 100)}% collection rate`}</span></div>
        <div className={`stat${f.arrearsKobo > 0n ? " alert" : ""}`}><b>{formatKobo(f.arrearsKobo)}</b><span>Already overdue</span></div>
        <div className="stat"><b>{formatKobo(f.atRisk.yearlyKobo)}</b><span>A year&apos;s rent on {f.atRisk.leases} leases ending without a renewal</span></div>
      </div>
      {due > 0n ? (
        <div className="fc-bars" role="list" aria-label="Rent due by month">
          {f.months.map((m) => (
            <div key={m.month} className="fc-col" role="listitem" aria-label={`${monthShort(m.month)}: ${formatKobo(m.dueKobo)} due${f.rate === null ? "" : `, ${formatKobo(m.likelyKobo)} likely`}`}>
              <span className="fc-stack" style={{ height: `${Math.max(2, Number((m.dueKobo * 100n) / max))}%` }}>
                {f.rate === null ? null : <span className="fc-likely" style={{ height: `${m.dueKobo > 0n ? Number((m.likelyKobo * 100n) / m.dueKobo) : 0}%` }} />}
              </span>
              <span className="fc-m">{monthShort(m.month)}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted">No rent is scheduled on active leases for the next 12 months.</p>}
      <p className="small muted">From your rent schedules only. The likely figure applies the share of rent you collected on charges due between a month and a year ago; it is a guide, not a promise. Rent at risk is a year&apos;s rent on leases that end within 12 months with no renewal offered or agreed.</p>
      <div className="row"><Link className="btn" href="/app/reports">Rent reports</Link><Link className="btn" href="/app/reports/accounting">Accounting export</Link></div>
    </section>
  );
}

function BenchmarkPanel({ b }: { b: Bench }) {
  const peer = (label: string, x: Bench["occupancy"]) => (
    <div className="stat"><b>{x.me === null ? "–" : `${Math.round(x.me * 100)}%`}</b>
      <span>{label}{x.me === null ? ": not enough records yet" : x.median === null ? `; compared once ${MIN_PEERS} companies have enough records` : ` · middle company ${Math.round(x.median * 100)}%`}</span></div>
  );
  const words = { below: "Below most", within: "In line with", above: "Above most" } as const;
  return (
    <section className="card stack" aria-labelledby="bm-h">
      <h2 id="bm-h">How you compare</h2>
      <div className="stats">{peer("Occupancy", b.occupancy)}{peer("Rent collected, last 12 months", b.collection)}</div>
      {b.listings.length ? (
        <details className="inline" open={b.listings.length <= 5}>
          <summary>Your listings against the market ({b.listings.length})</summary>
          <ul className="timeline">
            {b.listings.slice(0, 30).map((l) => (
              <li key={l.ref}>
                <div><Link href={`/properties/${l.ref}`}>{l.title}</Link><div className="small muted">{l.band} bed · {l.city} · {l.purpose === "SALE" ? "asking" : "a year"} {compactNaira(l.value)}; most similar homes {compactNaira(l.market.low)} to {compactNaira(l.market.high)}</div></div>
                <span className={`pill ${l.where === "above" ? "warn" : l.where === "below" ? "brand" : "ok"}`}>{words[l.where]} ({l.vsMedianPct > 0 ? "+" : ""}{l.vsMedianPct}%)</span>
              </li>
            ))}
          </ul>
        </details>
      ) : <p className="small muted">None of your published homes has enough similar listings in its city to compare yet.</p>}
      <p className="small muted">Other companies are never named or shown one by one; their figures appear only as a middle value across at least {MIN_PEERS} companies. Market figures are asking prices. <Link href="/market">See market prices</Link></p>
    </section>
  );
}
