import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listLeads } from "@/lib/services/crm";
import { LEAD_STATUSES } from "@/lib/crm-rules";
import { humanize } from "@/lib/labels";
import { formatKobo } from "@/lib/money";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("crm.view");
  const status = sp(searchParams, "status") ?? "";
  const d = await listLeads(member, { status: LEAD_STATUSES.includes(status as never) ? status : undefined, mine: sp(searchParams, "mine") === "1" });
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Leads</h1><p className="muted"><Link href="/app/crm">Back to overview</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        <form className="row" method="get">
          <select name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
          <label className="row"><input type="checkbox" name="mine" value="1" defaultChecked={sp(searchParams, "mine") === "1"} /> Mine only</label>
          <button className="btn" type="submit">Filter</button>
        </form>
        {d.leads.length === 0 ? <p className="muted">No leads found.</p> : (
          <ShowMore noun="more leads" limit={10} items={d.leads.map((l) => (
            <li key={l.id}><div className="row between" style={{ width: "100%" }}>
              <div><Link href={`/app/crm/clients/${l.client.id}`}><strong>{l.ref}</strong> {l.title}</Link>
                <div className="small muted">{l.client.name} · {l.source?.name ?? "No source"} · owner {d.names[l.ownerId] ?? "unknown"} · score {l.score}{l.budgetMaxKobo ? ` · up to ${formatKobo(l.budgetMaxKobo)}` : ""}</div></div>
              <Pill status={l.status} label={humanize(l.status)} />
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
