import { requireMember } from "@/lib/auth";
import { companyDesk, KIND_STATUS } from "@/lib/services/completed";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { requestDisplayAction, withdrawDisplayAction } from "./actions";

export const metadata = { title: "Completed deals on show" };
export const dynamic = "force-dynamic";

export default async function CompletedDesk({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.manage");
  const deals = await companyDesk(member);
  const manager = member.role === "COMPANY_SUPER_ADMIN" || member.role === "MANAGER";
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Completed deals on show</h1>
        <p className="muted">Put a completed sale, rental or lease in the public Recently Sold, Rented or Leased sections. Only the kind of property, its area and when it completed are shown, never the price, the people or any document. The people involved must have agreed, and the platform checks each one.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Completed deals ({deals.length})</h2>
        {deals.length === 0 ? <p className="muted">No completed deals yet.</p> : (
          <ShowMore noun="more deals" limit={5} items={deals.map((d) => {
            const s = d.display?.status;
            return (
              <li key={d.id}><div className="stack" style={{ width: "100%" }}>
                <div className="row between"><div><strong>{d.title || d.ref}</strong> <span className="small muted">{KIND_STATUS[d.type === "SALE" ? "SOLD" : d.type === "RENT" ? "RENTED" : "LEASED"]} {d.completedAt ? formatDate(d.completedAt) : ""}</span></div>
                  {s ? <Pill status={s === "APPROVED" ? "ACTIVE" : s === "REQUESTED" ? "PENDING" : "SUSPENDED"} label={s === "REQUESTED" ? "Being checked" : humanize(s)} /> : null}</div>
                {d.display?.reviewNote ? <p className="small">{d.display.reviewNote}</p> : null}
                {manager && (!s || s === "REJECTED" || s === "WITHDRAWN") ? (
                  <details className="inline"><summary>Show this deal publicly</summary>
                    <form action={requestDisplayAction} className="stack"><input type="hidden" name="dealId" value={d.id} />
                      <Field label="Who agreed, and how?" hint="For example: Owner and buyer agreed by email on 3 October."><input name="statement" required minLength={10} maxLength={300} /></Field>
                      <label className="check"><input type="checkbox" name="confirmed" /> <span>The owner and the client or tenant have agreed to this deal being shown without their names or the price</span></label>
                      <button className="btn" type="submit">Send for checking</button></form></details>
                ) : null}
                {manager && (s === "REQUESTED" || s === "APPROVED") ? <form action={withdrawDisplayAction}><input type="hidden" name="dealId" value={d.id} /><button className="btn small" type="submit">Take it off</button></form> : null}
              </div></li>);
          })} />
        )}
      </section>
    </div>
  );
}
