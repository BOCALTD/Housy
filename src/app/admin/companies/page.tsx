import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { adminCompanies } from "@/lib/services/governance";
import { formatDate } from "@/lib/dates";
import { TrustBadge } from "@/components/TrustBadge";
import { Pager, Pill, sp, type SP } from "@/components/ui";

export const metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesAdmin({ searchParams }: { searchParams?: Promise<SP> }) {
  const s = await searchParams;
  const admin = await requirePlatformAdmin();
  const q = sp(s, "q") ?? "", status = sp(s, "status") ?? "", page = Math.max(0, Number(sp(s, "page") ?? 0) || 0);
  const r = await adminCompanies(admin.id, { q, status, page });
  const href = (p: number) => `/admin/companies?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) }).toString()}`;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Companies</h1><p className="muted">Suspend or restore a company, and open its records for a stated purpose.</p></div>
      <form className="row" method="get"><input name="q" defaultValue={q} placeholder="Company name" aria-label="Company name" /><select name="status" defaultValue={status} aria-label="Status"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select><button className="btn" type="submit">Search</button></form>
      <section className="card stack">
        {r.rows.length === 0 ? <p className="muted">No companies match.</p> : (
          <ul className="timeline">{r.rows.map((c) => (
            <li key={c.id} className="row between" style={{ width: "100%" }}>
              <span><Link href={`/admin/companies/${c.id}`}><strong>{c.name}</strong></Link> <span className="small muted">· joined {formatDate(c.createdAt)}</span></span>
              <span className="row"><TrustBadge t={c.trust} />{c.suspendedAt ? <Pill status="SUSPENDED" label="Suspended" /> : null}</span>
            </li>
          ))}</ul>
        )}
        <Pager page={r.page} total={r.total} pageSize={25} href={href} noun="companies" />
      </section>
    </div>
  );
}
