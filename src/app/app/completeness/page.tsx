import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { portfolioCompleteness } from "@/lib/services/completeness";
import { Pill, sp, type SP } from "@/components/ui";

export const metadata = { title: "Missing information" };
export const dynamic = "force-dynamic";

export default async function CompletenessPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const r = await portfolioCompleteness(member, page);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Missing information</h1><p className="muted">Checked against the platform&apos;s own rules: {r.checked} properties looked at, {r.complete} with nothing missing. Nothing is changed by this page. <Link href="/app/analytics">Analytics</Link></p></div>
      {r.common.length ? (
        <section className="card stack"><h2>Most common gaps</h2>
          <ul className="timeline">{r.common.map((c) => <li key={c.code}><div>{c.message}</div><span className="small"><Pill status={c.severity === "REQUIRED" ? "SUSPENDED" : "PENDING"} label={c.severity === "REQUIRED" ? "Required" : "Recommended"} /> {c.n} {c.n === 1 ? "property" : "properties"}</span></li>)}</ul>
        </section>
      ) : null}
      <section className="stack">
        <h2>Properties with gaps ({r.totalGaps})</h2>
        {r.gaps.length === 0 ? <div className="card"><p className="muted">{r.totalGaps === 0 ? "Every property has what the rules ask for." : "No more."}</p></div> : r.gaps.map((g) => (
          <div className="card stack" key={g.assetId} style={{ padding: 12 }}>
            <div className="row between"><Link href={`/app/assets/${g.assetId}`}><strong>{g.ref} · {g.name}</strong></Link><span className="small muted">{g.required} required · {g.recommended} recommended</span></div>
            <details className="inline"><summary>What is missing</summary><ul>{g.issues.map((i) => <li key={i.code}>{i.message} <span className="small muted">({i.severity === "REQUIRED" ? "required" : "recommended"})</span></li>)}</ul></details>
          </div>
        ))}
        <div className="row between">{page > 0 ? <Link className="btn" href={`/app/completeness?page=${page - 1}`}>Previous</Link> : <span />}{(page + 1) * r.pageSize < r.totalGaps ? <Link className="btn" href={`/app/completeness?page=${page + 1}`}>Next</Link> : <span />}</div>
      </section>
    </div>
  );
}
