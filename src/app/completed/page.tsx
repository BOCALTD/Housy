import Link from "next/link";
import { KIND_LABEL, recentlyCompleted } from "@/lib/services/completed";
import { sp, type SP } from "@/components/ui";
import { DoneCard } from "@/components/Done";

export const metadata = { title: "Recently sold, rented and leased" };
export const dynamic = "force-dynamic";

export default async function CompletedPage({ searchParams }: { searchParams?: SP }) {
  const kind = sp(searchParams, "kind") ?? "";
  const city = sp(searchParams, "city") ?? "";
  const page = Math.max(0, Number(sp(searchParams, "page") ?? 0) || 0);
  const r = await recentlyCompleted({ kind, city, page });
  const link = (over: Record<string, string | number>) => `/completed?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(city ? { city } : {}), ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) })}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Recently sold, rented and leased</h1>
        <p className="muted">Real deals completed through companies on the platform, checked before they are shown. Prices, names and addresses are never published.</p></div>
      <nav className="nav" aria-label="Kind">
        <Link href={link({ page: 0, kind: "" })} aria-current={!kind ? "page" : undefined}>All</Link>
        {Object.entries(KIND_LABEL).map(([k, label]) => <Link key={k} href={link({ kind: k, page: 0 })} aria-current={kind === k ? "page" : undefined}>{label}</Link>)}
      </nav>
      <form method="get" className="row" role="search"><input type="hidden" name="kind" value={kind} /><input name="city" defaultValue={city} placeholder="City or area" aria-label="City or area" /><button className="btn" type="submit">Search</button></form>
      {r.rows.length === 0 ? <div className="card"><p className="muted">Nothing to show yet. Only recently completed, verified deals appear here.</p></div> : <div className="grid">{r.rows.map((c) => <DoneCard key={c.id} c={c} />)}</div>}
      <div className="row between">
        {r.page > 0 ? <Link className="btn" href={link({ page: r.page - 1 })}>Previous</Link> : <span />}
        {r.page + 1 < r.pages ? <Link className="btn" href={link({ page: r.page + 1 })}>Next</Link> : <span />}
      </div>
    </div>
  );
}
