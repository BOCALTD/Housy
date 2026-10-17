import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { contractorSummary } from "@/lib/services/maintenance";
import { formatKobo } from "@/lib/money";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createContractorAction, toggleContractorAction } from "../actions";

export const metadata = { title: "Contractors" };

export default async function ContractorsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const rows = await contractorSummary(member);
  const manage = can(member.role, "maintenance.manage");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/maintenance">All work orders</Link></p>
        <h1>Contractors</h1>
        <p className="muted">Vendors and tradespeople you assign work to. Spend counts closed work orders only.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        {rows.length === 0 ? <p className="muted">No contractors yet.</p> : (
          <ShowMore noun="more" limit={5} items={rows.map((c) => (
              <li key={c.id}>
                <div className="row between" style={{ width: "100%" }}>
                  <div>
                    <strong>{c.name}</strong> <span className="small muted">{c.trade}</span>
                    <div className="small muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"} · {c.openCount} open · spent {formatKobo(c.spendKobo)}</div>
                    {c.notes ? <div className="small">{c.notes}</div> : null}
                  </div>
                  <div className="row">
                    <Pill status={c.active ? "ACTIVE" : "CANCELLED"} label={c.active ? "In use" : "Switched off"} />
                    {manage ? <form action={toggleContractorAction}><input type="hidden" name="contractorId" value={c.id} /><input type="hidden" name="active" value={c.active ? "false" : "true"} /><button className="btn small" type="submit">{c.active ? "Switch off" : "Switch on"}</button></form> : null}
                  </div>
                </div>
              </li>
            ))} />
        )}
      </section>
      {manage ? (
        <section className="card">
          <h2>Add a contractor</h2>
          <form action={createContractorAction} className="stack">
            <div className="fields"><Field label="Name"><input name="name" required /></Field><Field label="Trade"><input name="trade" placeholder="Plumbing, electrical" /></Field></div>
            <div className="fields"><Field label="Phone"><input name="phone" /></Field><Field label="Email"><input name="email" type="email" /></Field></div>
            <Field label="Notes"><textarea name="notes" rows={2} /></Field>
            <button className="btn primary" type="submit">Add contractor</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
