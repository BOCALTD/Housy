import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { CONDITIONS, INVENTORY_KINDS, listInventory } from "@/lib/services/inventory";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { createItemAction, decideAdjustmentAction, lookupCodeAction } from "./actions";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const q = sp(searchParams, "q") ?? "";
  const assetId = sp(searchParams, "assetId") || undefined;
  const d = await listInventory(member, { q, assetId });
  const manage = can(member.role, "inventory.manage");
  const approve = can(member.role, "inventory.approve");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Inventory</h1>
        <p className="muted">
          Contents, equipment and stock. <Link href="/app/inventory/counts">Physical counts</Link> · <Link href="/app/maintenance">Maintenance</Link>
        </p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack" aria-labelledby="find-h">
        <h2 id="find-h">Find an item</h2>
        <form action={lookupCodeAction} className="row">
          <label className="visually-hidden" htmlFor="code">Scan or type a code</label>
          <input id="code" name="code" placeholder="Scan or type a code or serial number" required style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)", flex: "1 1 260px", minWidth: 0 }} />
          <button className="btn" type="submit">Open item</button>
        </form>
        <p className="small muted">A barcode scanner types the code into this box. Each item&apos;s code is shown on its page so it can be printed on a label.</p>
        <form method="get" className="row">
          <label className="visually-hidden" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search by name, category or serial number" style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)", flex: "1 1 260px", minWidth: 0 }} />
          <select name="assetId" defaultValue={assetId ?? ""} aria-label="Asset"><option value="">All assets</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select>
          <button className="btn" type="submit">Search</button>
        </form>
      </section>

      {d.pending.length > 0 ? (
        <section className="card stack" aria-labelledby="pend-h">
          <h2 id="pend-h">Waiting for approval</h2>
          <ShowMore noun="more requests" limit={3} items={d.pending.map((p) => (
              <li key={p.id}>
                <div className="stack" style={{ gap: 6, width: "100%" }}>
                  <div><Link href={`/app/inventory/${p.item.id}`}><strong>{p.item.itemNo}</strong></Link> · {p.item.name}: {humanize(p.kind)} {p.delta > 0 ? "+" : ""}{p.delta} {p.item.unit} (now {p.item.quantity})</div>
                  <div className="small muted">{p.reason} · asked by {d.names[p.requestedById] ?? "someone"} on {formatDate(p.createdAt)}</div>
                  {approve && p.requestedById !== member.userId ? (
                    <form action={decideAdjustmentAction} className="row">
                      <input type="hidden" name="adjustmentId" value={p.id} />
                      <input name="note" placeholder="Note (needed to reject)" aria-label="Note" style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
                      <button className="btn primary" type="submit" name="decision" value="approve">Approve</button>
                      <button className="btn" type="submit" name="decision" value="reject">Reject</button>
                    </form>
                  ) : approve ? <p className="small muted">Someone else must approve a request you made.</p> : null}
                </div>
              </li>
            ))} />
        </section>
      ) : null}

      {d.lowStock.length > 0 ? (
        <section className="card stack" aria-labelledby="low-h">
          <h2 id="low-h">Running low</h2>
          <ShowMore noun="more items" limit={5} items={d.lowStock.map((i) => <li key={i.id}><div><Link href={`/app/inventory/${i.id}`}>{i.itemNo}</Link> · {i.name}: {i.quantity} {i.unit} left (reorder at {i.reorderLevel})</div></li>)} />
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="list-h">
        <h2 id="list-h">Items</h2>
        {d.items.length === 0 ? <p className="muted">{q || assetId ? "Nothing matches." : "No items yet."}</p> : (
          <TableMore limit={15} noun="more items" head={<tr><th>No.</th><th>Item</th><th>Type</th><th>Asset</th><th>Location</th><th className="r">Quantity</th><th>Condition</th><th>Checked</th></tr>} rows={d.items.map((i) => (
                  <tr key={i.id}>
                    <td className="mono"><Link href={`/app/inventory/${i.id}`}>{i.itemNo}</Link></td>
                    <td>{i.name}{i.status === "DISPOSED" ? <> <Pill status="CANCELLED" label="Disposed" /></> : null}</td>
                    <td>{humanize(i.kind)}</td>
                    <td>{i.asset ? i.asset.ref : "—"}</td>
                    <td>{i.location || "—"}</td>
                    <td className="r num">{i.quantity} {i.unit}</td>
                    <td>{humanize(i.condition)}</td>
                    <td>{i.lastVerifiedOn ? formatDate(i.lastVerifiedOn) : "Never"}</td>
                  </tr>
                ))} />
        )}
      </section>

      {manage ? (
        <section className="card" aria-labelledby="add-h">
          <h2 id="add-h">Add an item</h2>
          <form action={createItemAction} className="stack">
            <div className="fields">
              <Field label="Name"><input name="name" required /></Field>
              <Field label="Type" hint="Consumables are used up; fixed assets and movable items are not."><select name="kind" defaultValue="MOVABLE"><EnumOptions values={INVENTORY_KINDS} /></select></Field>
              <Field label="Category"><input name="category" placeholder="Furniture, tools, cement" /></Field>
            </div>
            <div className="fields">
              <Field label="Asset"><select name="assetId" defaultValue=""><option value="">Not tied to one asset</option>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
              <Field label="Location"><input name="location" placeholder="Store room, Flat 2 lounge" /></Field>
              <Field label="Custodian"><select name="custodianId" defaultValue=""><option value="">None</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </div>
            <div className="fields">
              <Field label="Opening quantity"><input name="quantity" inputMode="numeric" defaultValue="1" /></Field>
              <Field label="Unit"><input name="unit" defaultValue="pcs" /></Field>
              <Field label="Unit cost (₦)"><input name="unitCost" inputMode="decimal" /></Field>
              <Field label="Reorder at" hint="For consumables."><input name="reorderLevel" inputMode="numeric" /></Field>
            </div>
            <div className="fields">
              <Field label="Serial number"><input name="serialNumber" /></Field>
              <Field label="Model"><input name="model" /></Field>
              <Field label="Manufacturer"><input name="manufacturer" /></Field>
              <Field label="Condition"><select name="condition" defaultValue="GOOD"><EnumOptions values={CONDITIONS} /></select></Field>
            </div>
            <div className="fields">
              <Field label="Acquired on"><input name="acquiredOn" type="date" /></Field>
              <Field label="Warranty until"><input name="warrantyUntil" type="date" /></Field>
              <Field label="Ownership"><input name="ownership" defaultValue="Owned" placeholder="Owned, leased, held for a tenant" /></Field>
              <Field label="Label code" hint="Leave blank to use the item number."><input name="code" /></Field>
            </div>
            <Field label="Notes"><textarea name="notes" rows={2} /></Field>
            <button className="btn primary" type="submit">Add item</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
