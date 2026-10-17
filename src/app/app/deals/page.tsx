import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listDeals } from "@/lib/services/deal";
import { DEAL_STAGES, DEAL_STATUSES } from "@/lib/deal-rules";
import { humanize } from "@/lib/labels";
import { formatKobo } from "@/lib/money";
import { Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";

export const metadata = { title: "Deals" };

export default async function DealsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const status = sp(searchParams, "status") ?? "";
  const stage = sp(searchParams, "stage") ?? "";
  const q = sp(searchParams, "q") ?? "";
  const d = await listDeals(member, { status: status || undefined, stage: stage || undefined, q, mine: sp(searchParams, "mine") === "1" });
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Deals</h1><p className="muted">Each deal follows one client and one property from enquiry to completion. Open a deal from a qualified lead on the client&apos;s page. <Link href="/app/crm">Clients and leads</Link></p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        <form className="row" method="get">
          <input name="q" defaultValue={q} placeholder="Reference, title or client" aria-label="Search deals" />
          <select name="stage" defaultValue={stage} aria-label="Stage"><option value="">All stages</option>{DEAL_STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
          <select name="status" defaultValue={status} aria-label="Status"><option value="">All statuses</option>{DEAL_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
          <label className="row"><input type="checkbox" name="mine" value="1" defaultChecked={sp(searchParams, "mine") === "1"} /> Mine only</label>
          <button className="btn" type="submit">Filter</button>
        </form>
        {d.deals.length === 0 ? <p className="muted">No deals found.</p> : (
          <ShowMore noun="more deals" limit={10} items={d.deals.map((x) => (
            <li key={x.id}><div className="row between" style={{ width: "100%" }}>
              <div><Link href={`/app/deals/${x.id}`}><strong>{x.ref}</strong> {x.title}</Link>
                <div className="small muted">{x.client.name} · {x.asset.ref} · {humanize(x.type)} · owner {d.names[x.ownerId] ?? "unknown"} · {x.agreedKobo ? `agreed ${formatKobo(x.agreedKobo)}` : `asking ${formatKobo(x.askingKobo)}`}</div></div>
              <div className="row"><Pill status={x.stage} label={humanize(x.stage)} />{x.status !== "OPEN" ? <Pill status={x.status} label={humanize(x.status)} /> : null}</div>
            </div></li>))} />
        )}
      </section>
    </div>
  );
}
