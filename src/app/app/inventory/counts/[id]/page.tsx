import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getCount } from "@/lib/services/inventory";
import { varianceOf } from "@/lib/inventory-rules";
import { formatDateTime } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { cancelCountAction, decideCountAction, saveCountAction, submitCountAction } from "../../actions";

export const metadata = { title: "Count sheet" };

export default async function CountPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const data = await getCount(member, params.id);
  if (!data) notFound();
  const { count, names } = data;
  const open = count.status === "OPEN";
  const counter = can(member.role, "inventory.count");
  const counted = count.lines.filter((l) => l.countedQty !== null).length;
  const variances = count.lines.filter((l) => varianceOf(l.expectedQty, l.countedQty) !== 0 && l.countedQty !== null);
  const hidden = <input type="hidden" name="countId" value={count.id} />;
  const counterIds = count.lines.map((l) => l.countedById).filter((x): x is string => !!x);
  const mayDecide = can(member.role, "inventory.approve") && count.submittedById !== member.userId && !counterIds.includes(member.userId);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inventory/counts">All counts</Link></p>
        <div className="row between">
          <div><p className="eyebrow mono">{count.ref}</p><h1>{count.title}</h1>
            <p className="muted">Started by {names[count.startedById] ?? "someone"} · {counted} of {count.lines.length} counted</p></div>
          <Pill status={count.status === "APPROVED" ? "DONE" : count.status === "CANCELLED" ? "CANCELLED" : "OPEN"} label={humanize(count.status)} />
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {count.decisionNote ? <p className="small muted">Note: {count.decisionNote}</p> : null}

      <form action={saveCountAction} className="card stack">
        {hidden}
        <h2>Count sheet</h2>
        <div className="table-wrap">
          <TableMore limit={12} noun="more rows" head={<tr><th>Item</th><th>Location</th><th className="r">Books say</th><th className="r">Counted</th><th className="r">Difference</th><th>Note</th></tr>} rows={count.lines.map((l) => {
                const v = varianceOf(l.expectedQty, l.countedQty);
                return (
                  <tr key={l.id}>
                    <td><Link href={`/app/inventory/${l.item.id}`}>{l.item.itemNo}</Link> {l.item.name}</td>
                    <td>{l.item.location || "—"}</td>
                    <td className="r num">{l.expectedQty} {l.item.unit}</td>
                    <td className="r">
                      {open && counter ? <input name={`counted:${l.id}`} inputMode="numeric" defaultValue={l.countedQty ?? ""} aria-label={`Counted ${l.item.name}`} style={{ width: 80, border: "1px solid var(--line)", borderRadius: 9, padding: "6px 8px", background: "var(--surface)", textAlign: "right" }} /> : <span className="num">{l.countedQty ?? "—"}</span>}
                    </td>
                    <td className="r num">{v === null ? "—" : v === 0 ? "0" : v > 0 ? `+${v}` : v}</td>
                    <td>{open && counter ? <input name={`note:${l.id}`} defaultValue={l.note} aria-label={`Note for ${l.item.name}`} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "6px 8px", background: "var(--surface)" }} /> : <span className="small">{l.note}</span>}</td>
                  </tr>
                );
              })} />
        </div>
        {open && counter ? <div><button className="btn primary" type="submit">Save counts</button></div> : null}
      </form>

      {open && counter ? (
        <section className="card stack">
          <h2>Finish counting</h2>
          <p className="small muted">Every item must have a count. The person who submits cannot approve the count.</p>
          <form action={submitCountAction}>{hidden}<button className="btn primary" type="submit">Submit for approval</button></form>
        </section>
      ) : null}

      {count.status === "SUBMITTED" ? (
        <section className="card stack">
          <h2>Variance report</h2>
          {variances.length === 0 ? <p>The count agrees with the books.</p> : (
            <ShowMore noun="more" limit={5} items={variances.map((l) => <li key={l.id}><div>{l.item.itemNo} {l.item.name}: books {l.expectedQty}, counted {l.countedQty} ({(l.countedQty ?? 0) - l.expectedQty > 0 ? "+" : ""}{(l.countedQty ?? 0) - l.expectedQty}){l.note ? ` · ${l.note}` : ""}</div></li>)} />
          )}
          {mayDecide ? (
            <div className="row">
              <form action={decideCountAction} className="row">{hidden}<input type="hidden" name="decision" value="approve" /><input name="note" placeholder="Note (optional)" aria-label="Note" style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} /><button className="btn primary" type="submit">Approve and adjust balances</button></form>
              <details className="inline"><summary>Send back for recount</summary>
                <form action={decideCountAction} className="stack">{hidden}<input type="hidden" name="decision" value="return" /><Field label="What to recount"><input name="note" required /></Field><button className="btn" type="submit">Send back</button></form>
              </details>
            </div>
          ) : <p className="small muted">Someone who did not count or submit this must approve it.</p>}
        </section>
      ) : null}

      {count.status === "APPROVED" ? <p className="small muted">Approved by {names[count.decidedById ?? ""] ?? "someone"} on {count.decidedAt ? formatDateTime(count.decidedAt) : "—"}. Differences were written to each item&apos;s history as approved adjustments.</p> : null}
      {can(member.role, "inventory.manage") && (open || count.status === "SUBMITTED") ? (
        <details className="inline"><summary>Cancel this count</summary>
          <form action={cancelCountAction} className="stack">{hidden}<Field label="Reason"><input name="reason" required /></Field><button className="btn danger" type="submit">Cancel count</button></form>
        </details>
      ) : null}
    </div>
  );
}
