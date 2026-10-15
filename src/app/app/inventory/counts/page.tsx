import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/services/inventory";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { startCountAction } from "../actions";

export const metadata = { title: "Physical counts" };

export default async function CountsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const d = await listInventory(member);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inventory">All inventory</Link></p>
        <h1>Physical counts</h1>
        <p className="muted">Count what is actually there and compare it with the books. A different person approves any difference before the balances change.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        {d.counts.length === 0 ? <p className="muted">No counts yet.</p> : (
          <ShowMore noun="more" limit={5} items={d.counts.map((c) => (
              <li key={c.id}><div className="row between" style={{ width: "100%" }}>
                <div><Link href={`/app/inventory/counts/${c.id}`}><strong>{c.ref}</strong></Link> · {c.title}<div className="small muted">Started {formatDate(c.createdAt)}</div></div>
                <Pill status={c.status === "APPROVED" ? "DONE" : c.status === "CANCELLED" ? "CANCELLED" : "OPEN"} label={humanize(c.status)} />
              </div></li>
            ))} />
        )}
      </section>
      {can(member.role, "inventory.manage") ? (
        <section className="card">
          <h2>Start a count</h2>
          <form action={startCountAction} className="stack">
            <Field label="Name"><input name="title" required placeholder="For example: Main store, end of quarter" /></Field>
            <Field label="Asset" hint="Leave blank to count everything."><select name="assetId" defaultValue=""><option value="">All active items</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
            <button className="btn primary" type="submit">Start count</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
