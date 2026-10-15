import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { CONDITIONS, getItem } from "@/lib/services/inventory";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { decideAdjustmentAction, movementAction, requestAdjustmentAction, updateItemAction, useOnWorkOrderAction } from "../actions";

export const metadata = { title: "Inventory item" };

export default async function ItemPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const data = await getItem(member, params.id);
  if (!data) notFound();
  const { item, movements, adjustments, names, members, myWorkOrders, woRefs } = data;
  const back = `/app/inventory/${item.id}`;
  const active = item.status === "ACTIVE";
  const move = can(member.role, "inventory.move") && active;
  const manage = can(member.role, "inventory.manage") && active;
  const approve = can(member.role, "inventory.approve");
  const who = (id: string | null) => (id ? names[id] ?? "Unknown user" : "—");
  const hidden = <input type="hidden" name="itemId" value={item.id} />;
  const pending = adjustments.filter((a) => a.status === "PENDING");
  const dateValue = (d: Date | null) => (d ? toDateOnlyString(d) : "");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inventory">All inventory</Link>{item.asset ? <> · <Link href={`/app/assets/${item.asset.id}`}>{item.asset.ref} · {item.asset.name}</Link></> : null}</p>
        <div className="row between">
          <div>
            <p className="eyebrow mono">{item.itemNo}</p>
            <h1>{item.name}</h1>
            <p className="muted">{humanize(item.kind)}{item.category ? ` · ${item.category}` : ""} · {item.location || "No location"} · custodian {item.custodian ? item.custodian.user.name : "none"}</p>
          </div>
          <div className="row">
            <Pill status={active ? "ACTIVE" : "CANCELLED"} label={active ? humanize(item.condition) : "Disposed"} />
          </div>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack" aria-labelledby="bal-h">
        <h2 id="bal-h">Balance</h2>
        <div className="fields">
          <div><div className="small muted">In stock</div><strong className="num" style={{ fontSize: 24 }}>{item.quantity} {item.unit}</strong></div>
          <div><div className="small muted">Label code</div><span className="mono">{item.code}</span></div>
          <div><div className="small muted">Last checked</div>{item.lastVerifiedOn ? formatDate(item.lastVerifiedOn) : "Never"}</div>
          <div><div className="small muted">Unit cost</div>{item.unitCostKobo !== null ? formatKobo(item.unitCostKobo) : "—"}</div>
          {item.reorderLevel !== null ? <div><div className="small muted">Reorder at</div>{item.reorderLevel}</div> : null}
          {item.serialNumber ? <div><div className="small muted">Serial number</div><span className="mono">{item.serialNumber}</span></div> : null}
          {item.model || item.manufacturer ? <div><div className="small muted">Make and model</div>{[item.manufacturer, item.model].filter(Boolean).join(" ")}</div> : null}
          <div><div className="small muted">Ownership</div>{item.ownership}</div>
          {item.acquiredOn ? <div><div className="small muted">Acquired</div>{formatDate(item.acquiredOn)}</div> : null}
          {item.warrantyUntil ? <div><div className="small muted">Warranty until</div>{formatDate(item.warrantyUntil)}</div> : null}
        </div>
        {item.notes ? <p className="small">{item.notes}</p> : null}
      </section>

      {move ? (
        <section className="card stack" aria-labelledby="mv-h">
          <h2 id="mv-h">Record a movement</h2>
          <form action={movementAction} className="stack">
            {hidden}
            <div className="fields">
              <Field label="What happened"><select name="kind" defaultValue="ISSUE">{["RECEIPT", "ISSUE", "TRANSFER", "RETURN", "CONSUMPTION"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
              <Field label="Quantity" hint="Not needed for a transfer."><input name="quantity" inputMode="numeric" defaultValue="1" /></Field>
              <Field label="Moving to" hint="For a transfer, or where a receipt is stored."><input name="toLocation" /></Field>
              <Field label="New custodian" hint="For a transfer."><select name="custodianId" defaultValue=""><option value="">No change</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </div>
            <div className="fields">
              <Field label="Reference" hint="Delivery note, waybill or request number."><input name="reference" /></Field>
              <Field label="Note"><input name="note" /></Field>
            </div>
            <button className="btn primary" type="submit">Record</button>
          </form>
        </section>
      ) : null}

      {move && item.kind === "CONSUMABLE" && myWorkOrders.length > 0 ? (
        <section className="card stack" aria-labelledby="wo-h">
          <h2 id="wo-h">Use on a work order</h2>
          <form action={useOnWorkOrderAction} className="row">
            {hidden}
            <select name="workOrderId" aria-label="Work order">{myWorkOrders.map((w) => <option key={w.id} value={w.id}>{w.ref} · {w.title}</option>)}</select>
            <input name="quantity" inputMode="numeric" defaultValue="1" aria-label="Quantity" style={{ width: 90, border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
            <button className="btn" type="submit">Issue to work order</button>
          </form>
          <p className="small muted">This takes the stock out and adds it to the work order&apos;s materials at the item&apos;s unit cost.</p>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="adj-h">
        <h2 id="adj-h">Corrections, losses and disposal</h2>
        {pending.map((p) => (
          <div key={p.id} className="stack" style={{ gap: 6 }}>
            <div>Waiting: {humanize(p.kind)} {p.delta > 0 ? "+" : ""}{p.delta} · {p.reason} <span className="small muted">asked by {who(p.requestedById)}</span></div>
            {approve && p.requestedById !== member.userId ? (
              <form action={decideAdjustmentAction} className="row">
                <input type="hidden" name="adjustmentId" value={p.id} /><input type="hidden" name="back" value={back} />
                <input name="note" placeholder="Note (needed to reject)" aria-label="Note" style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
                <button className="btn primary" type="submit" name="decision" value="approve">Approve</button>
                <button className="btn" type="submit" name="decision" value="reject">Reject</button>
              </form>
            ) : null}
          </div>
        ))}
        {move ? (
          <details className="inline"><summary>Ask for a correction, loss, damage or disposal</summary>
            <form action={requestAdjustmentAction} className="stack">
              {hidden}
              <div className="fields">
                <Field label="Type"><select name="kind" defaultValue="LOSS">{["ADJUSTMENT", "LOSS", "DAMAGE", "DISPOSAL"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></Field>
                <Field label="Quantity"><input name="quantity" required inputMode="numeric" /></Field>
                <Field label="Direction" hint="Only for a correction."><select name="direction" defaultValue="DOWN"><option value="DOWN">Take away</option><option value="UP">Add</option></select></Field>
              </div>
              <Field label="Reason"><textarea name="reason" rows={2} required /></Field>
              <p className="small muted">A change like this does not take effect until someone other than you approves it.</p>
              <button className="btn primary" type="submit">Send for approval</button>
            </form>
          </details>
        ) : null}
        {adjustments.filter((a) => a.status !== "PENDING").length > 0 ? (
          <ShowMore noun="more adjustments" limit={4} items={adjustments.filter((a) => a.status !== "PENDING").map((a) => (
              <li key={a.id}><div>{humanize(a.kind)} {a.delta > 0 ? "+" : ""}{a.delta} · {humanize(a.status)}<div className="small muted">{a.reason} · asked by {who(a.requestedById)}, decided by {who(a.decidedById)}{a.decisionNote ? ` (${a.decisionNote})` : ""}</div></div></li>
            ))} />
        ) : null}
      </section>

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">Movement history</h2>
        {movements.length === 0 ? <p className="muted">No movements yet.</p> : (
          <div className="table-wrap">
            <TableMore limit={12} noun="more rows" head={<tr><th>When</th><th>What</th><th className="r">Change</th><th className="r">Balance</th><th>Details</th><th>By</th></tr>} rows={movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{humanize(m.kind)}</td>
                    <td className="r num">{m.delta > 0 ? "+" : ""}{m.delta}</td>
                    <td className="r num">{m.balanceAfter}</td>
                    <td className="small">
                      {m.kind === "TRANSFER" ? `${m.fromLocation || "?"} → ${m.toLocation || "?"}. ` : ""}
                      {m.workOrderId && woRefs[m.workOrderId] ? <Link href={`/app/maintenance/${m.workOrderId}`}>{woRefs[m.workOrderId]}</Link> : null} {m.reference} {m.note}
                    </td>
                    <td className="small">{who(m.performedById)}{m.approvedById ? `, approved by ${who(m.approvedById)}` : ""}</td>
                  </tr>
                ))} />
          </div>
        )}
      </section>

      {manage ? (
        <section className="card" aria-labelledby="edit-h">
          <details className="inline"><summary id="edit-h">Edit details</summary>
            <form action={updateItemAction} className="stack">
              {hidden}
              <div className="fields">
                <Field label="Name"><input name="name" defaultValue={item.name} required /></Field>
                <Field label="Category"><input name="category" defaultValue={item.category} /></Field>
                <Field label="Location"><input name="location" defaultValue={item.location} /></Field>
                <Field label="Custodian"><select name="custodianId" defaultValue={item.custodianId ?? ""}><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              </div>
              <div className="fields">
                <Field label="Condition"><select name="condition" defaultValue={item.condition}><EnumOptions values={CONDITIONS} /></select></Field>
                <Field label="Unit"><input name="unit" defaultValue={item.unit} /></Field>
                <Field label="Reorder at"><input name="reorderLevel" inputMode="numeric" defaultValue={item.reorderLevel ?? ""} /></Field>
                <Field label="Label code"><input name="code" defaultValue={item.code} /></Field>
              </div>
              <div className="fields">
                <Field label="Serial number"><input name="serialNumber" defaultValue={item.serialNumber} /></Field>
                <Field label="Model"><input name="model" defaultValue={item.model} /></Field>
                <Field label="Manufacturer"><input name="manufacturer" defaultValue={item.manufacturer} /></Field>
                <Field label="Ownership"><input name="ownership" defaultValue={item.ownership} /></Field>
                <Field label="Warranty until"><input name="warrantyUntil" type="date" defaultValue={dateValue(item.warrantyUntil)} /></Field>
              </div>
              <Field label="Notes"><textarea name="notes" rows={2} defaultValue={item.notes} /></Field>
              <p className="small muted">The quantity changes only through movements, corrections and counts.</p>
              <button className="btn primary" type="submit">Save</button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}
