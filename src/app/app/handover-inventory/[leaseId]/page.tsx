import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { CONDITIONS, getHandoverInventory } from "@/lib/services/inventory";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import { handoverCharges } from "@/lib/services/handover-charges";
import { formatKobo } from "@/lib/money";
import { acknowledgeAction, addLineAction, applyRegisterAction, deductChargesAction, saveChargesAction, addLinePhotoAction, createScheduleAction, removeLineAction } from "../../inventory/actions";

export const metadata = { title: "Handover inventory" };

const KIND_TEXT = { SAME: "No change", WORSE: "Condition worse", BETTER: "Condition better", FEWER: "Fewer than at move-in", MORE: "More than at move-in", MISSING: "Missing", NEW: "Not at move-in" } as const;

export default async function HandoverInventoryPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ leaseId: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const d = await getHandoverInventory(member, params.leaseId);
  if (!d) notFound();
  const record = can(member.role, "handover.record");
  const manageStock = can(member.role, "inventory.manage");
  const settle = can(member.role, "deposit.settle");
  const charges = d.comparison ? await handoverCharges(member, d.lease.id) : null;
  const kobo = (k: bigint | null) => (k == null ? "" : (Number(k) / 100).toFixed(2).replace(/\.00$/, ""));
  const linkedDiffs = d.comparison ? d.comparison.filter((c) => c.before?.itemId && (c.kind === "MISSING" || c.kind === "FEWER" || c.kind === "WORSE")) : [];
  const todayText = toDateOnlyString(todayInLagos());
  const sections = [
    { kind: "MOVE_IN" as const, schedule: d.moveIn },
    { kind: "MOVE_OUT" as const, schedule: d.moveOut },
  ];
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href={`/app/leases/${d.lease.id}`}>Lease {d.lease.ref}</Link> · <Link href={`/app/assets/${d.lease.asset.id}`}>{d.lease.asset.ref} · {d.lease.asset.name}</Link></p>
        <h1>Handover inventory</h1>
        <p className="muted">Room-by-room schedule of what is handed over to {d.lease.occupantName}, with condition and photographs. Once the occupant has acknowledged it, it cannot be changed.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {sections.map(({ kind, schedule }) => (
        <section key={kind} className="card stack" aria-labelledby={`${kind}-h`}>
          <div className="row between">
            <h2 id={`${kind}-h`}>{humanize(kind)}</h2>
            {schedule ? <Pill status={schedule.status === "ACKNOWLEDGED" ? "DONE" : "OPEN"} label={schedule.status === "ACKNOWLEDGED" ? "Acknowledged" : "Draft"} /> : null}
          </div>
          {!schedule ? (
            record ? <form action={createScheduleAction}><input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="kind" value={kind} /><button className="btn" type="submit">Start the {humanize(kind).toLowerCase()} schedule</button></form> : <p className="muted">Not started.</p>
          ) : (
            <>
              {schedule.lines.length === 0 ? <p className="muted">No items yet.</p> : (
                <div className="table-wrap">
                  <TableMore limit={12} noun="more rows" head={<tr><th>Room</th><th>Item</th><th className="r">Qty</th><th>Condition</th><th>Notes</th><th>Photographs</th>{schedule.status === "DRAFT" && record ? <th><span className="visually-hidden">Actions</span></th> : null}</tr>} rows={schedule.lines.map((l) => {
                        const photos = d.photos.filter((p) => p.subjectId === l.id);
                        return (
                          <tr key={l.id}>
                            <td>{l.room}</td><td>{l.description}{l.item ? <> <Link className="pill brand" href={`/app/inventory/${l.item.id}`} title="In the inventory register">{l.item.itemNo}</Link></> : null}</td><td className="r num">{l.quantity}</td><td>{humanize(l.condition)}</td><td className="small">{l.notes}</td>
                            <td>
                              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                                {photos.map((p) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <a key={p.id} href={`/app/photos/${p.id}`}><img src={`/app/photos/${p.id}`} alt={p.caption || `${l.room} ${l.description}`} width={64} style={{ height: "auto", borderRadius: 6, border: "1px solid var(--line)" }} /></a>
                                ))}
                              </div>
                              {schedule.status === "DRAFT" && record ? (
                                <details className="inline"><summary>Add photograph</summary>
                                  <form action={addLinePhotoAction} className="stack" encType="multipart/form-data">
                                    <input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="scheduleId" value={schedule.id} /><input type="hidden" name="lineId" value={l.id} />
                                    <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required aria-label="Photograph" />
                                    <input name="caption" placeholder="Caption" aria-label="Caption" />
                                    <button className="btn small" type="submit">Upload</button>
                                  </form>
                                </details>
                              ) : null}
                            </td>
                            {schedule.status === "DRAFT" && record ? (
                              <td><form action={removeLineAction}><input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="scheduleId" value={schedule.id} /><input type="hidden" name="lineId" value={l.id} /><button className="btn small" type="submit" data-confirm="Remove this line?" data-confirm-body="It comes off the handover inventory." data-confirm-ok="Remove">Remove</button></form></td>
                            ) : null}
                          </tr>
                        );
                      })} />
                </div>
              )}
              {schedule.status === "DRAFT" && record ? (
                <>
                  <details className="inline"><summary>Add an item</summary>
                    <form action={addLineAction} className="stack" encType="multipart/form-data">
                      <input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="scheduleId" value={schedule.id} />
                      <div className="fields">
                        <Field label="Room"><input name="room" required placeholder="Lounge, Kitchen, Bedroom 1" /></Field>
                        {d.register.length ? (
                          <Field label="Register item (optional)" hint="Choose it if the item is in this property's inventory register; it is then matched at move-out and can update the register.">
                            <select name="itemId" defaultValue="">
                              <option value="">Not in the register</option>
                              {d.register.map((r) => <option key={r.id} value={r.id}>{r.itemNo} · {r.name} ({r.quantity} {r.unit})</option>)}
                            </select>
                          </Field>
                        ) : null}
                        <Field label="Item" hint={d.register.length ? "Leave empty to use the register item's name." : undefined}><input name="description" required={!d.register.length} placeholder="Sofa, ceiling fan, wardrobe" /></Field>
                        <Field label="Quantity"><input name="quantity" inputMode="numeric" defaultValue="1" required /></Field>
                        <Field label="Condition"><select name="condition" defaultValue="GOOD"><EnumOptions values={CONDITIONS} /></select></Field>
                      </div>
                      <Field label="Notes"><input name="notes" /></Field>
                      <div className="fields">
                        <Field label="Photograph (optional)"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
                        <Field label="Caption"><input name="caption" /></Field>
                      </div>
                      <button className="btn primary" type="submit">Add item</button>
                    </form>
                  </details>
                  {schedule.lines.length > 0 ? (
                    <details className="inline"><summary>Occupant acknowledgement</summary>
                      <form action={acknowledgeAction} className="stack">
                        <input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="scheduleId" value={schedule.id} />
                        <Field label="Name of the person acknowledging" hint="The tenant or occupant, who has seen this schedule and agrees it is accurate."><input name="acknowledgedBy" required /></Field>
                        <Field label="Date"><input name="acknowledgedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                        <p className="small muted">After this the schedule is locked and cannot be edited.</p>
                        <button className="btn primary" type="submit">Record acknowledgement</button>
                      </form>
                    </details>
                  ) : null}
                </>
              ) : null}
              {schedule.status === "ACKNOWLEDGED" ? <p className="small muted">Acknowledged by {schedule.acknowledgedBy} on {schedule.acknowledgedOn ? formatDate(schedule.acknowledgedOn) : "—"}.</p> : null}
            </>
          )}
        </section>
      ))}

      {d.comparison ? (
        <section className="card stack" aria-labelledby="cmp-h">
          <h2 id="cmp-h">Move-in compared with move-out</h2>
          {d.comparison.filter((c) => c.kind !== "SAME").length === 0 ? <p>Nothing has changed since move-in.</p> : null}
          <div className="table-wrap">
            <TableMore limit={12} noun="more rows" head={<tr><th>Room</th><th>Item</th><th>Move-in</th><th>Move-out</th><th>Result</th></tr>} rows={d.comparison.map((c, i) => (
                  <tr key={i}>
                    <td>{c.room}</td><td>{c.description}</td>
                    <td>{c.before ? `${c.before.quantity} · ${humanize(c.before.condition)}` : "—"}</td>
                    <td>{c.after ? `${c.after.quantity} · ${humanize(c.after.condition)}` : "—"}</td>
                    <td>{c.kind === "SAME" ? KIND_TEXT.SAME : <strong>{KIND_TEXT[c.kind]}</strong>}</td>
                  </tr>
                ))} />
          </div>
          <p className="small muted">This comparison is a record of differences for people to review. Any deduction from the deposit is decided below, item by item.</p>
          {d.moveOut?.registerUpdatedAt ? (
            <p className="small">The inventory register was updated from this handover on {formatDate(d.moveOut.registerUpdatedAt)}.</p>
          ) : d.moveIn?.status === "ACKNOWLEDGED" && d.moveOut?.status === "ACKNOWLEDGED" && manageStock && linkedDiffs.length > 0 ? (
            <form action={applyRegisterAction} className="stack" style={{ gap: 6 }}>
              <input type="hidden" name="leaseId" value={d.lease.id} />
              <p className="small">{linkedDiffs.length} register {linkedDiffs.length === 1 ? "item is" : "items are"} missing, fewer or in worse condition. Missing items become write-off requests that another person approves; worse condition is written to the register.</p>
              <button className="btn" type="submit" data-confirm="Send the differences to the register?" data-confirm-body="Write-off requests are made for missing register items and conditions are updated. This can be done once for this handover." data-confirm-ok="Send to register">Send the differences to the register</button>
            </form>
          ) : null}
        </section>
      ) : null}
      {charges && charges.rows.length > 0 ? (
        <section className="card stack" aria-labelledby="charges-h">
          <h2 id="charges-h">Value of lost or damaged items</h2>
          <p className="small muted">Put a money value on each item that is missing, short or handed back in worse condition. The suggestion comes from the register&apos;s unit cost: the full cost of each item not handed back, and a quarter of it for each step down in condition. A value that differs from the suggestion needs a note.</p>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="stat"><b>{formatKobo(charges.totalKobo)}</b><span>Total set</span></div>
            <div className="stat"><b>{formatKobo(charges.depositBalanceKobo)}</b><span>Deposit held</span></div>
            {charges.owed > 0n ? <div className="stat"><b>{formatKobo(charges.owed)}</b><span>More than the deposit</span></div> : null}
          </div>
          {charges.deductedAt ? (
            <p><span className="pill ok">Deducted</span> {charges.deducted ? `${formatKobo(charges.deducted.amountKobo)} was deducted from the deposit on ${formatDate(charges.deducted.entryDate)}.` : `Deducted on ${formatDate(charges.deductedAt)}.`} {charges.owed > 0n ? `${formatKobo(charges.owed)} more than the deposit is still owed by the occupant.` : ""} <Link href={`/app/leases/${d.lease.id}`}>See the deposit on the lease</Link></p>
          ) : null}
          <form action={saveChargesAction} className="stack">
            <input type="hidden" name="leaseId" value={d.lease.id} />
            <TableMore limit={10} noun="more items" stacked head={<tr><th>Item</th><th>Result</th><th className="r">Qty</th><th className="r">Suggested</th><th>Value</th><th>Note</th></tr>} rows={charges.rows.map((r) => (
              <tr key={r.key}>
                <td data-label="Item"><strong>{r.description}</strong><br /><span className="small muted">{r.room} · move-in {r.before}, move-out {r.after}</span><input type="hidden" name="key" value={r.key} /></td>
                <td data-label="Result">{KIND_TEXT[r.kind]}</td>
                <td data-label="Qty" className="r">{r.quantity}</td>
                <td data-label="Suggested" className="r">{r.suggestedKobo == null ? <span className="small muted">No unit cost</span> : formatKobo(r.suggestedKobo)}</td>
                <td data-label="Value">{charges.deductedAt || !record ? (r.amountKobo == null ? "Not set" : formatKobo(r.amountKobo)) : <input name={`amount:${r.key}`} inputMode="decimal" aria-label={`Value of ${r.description}`} defaultValue={kobo(r.amountKobo ?? r.suggestedKobo)} placeholder="0" style={{ minWidth: 110 }} />}</td>
                <td data-label="Note">{charges.deductedAt || !record ? (r.note || "—") : <input name={`note:${r.key}`} aria-label={`Note for ${r.description}`} defaultValue={r.note} maxLength={300} placeholder="Repair quote, receipt…" />}</td>
              </tr>
            ))} />
            {!charges.deductedAt && record ? <div className="row"><button className="btn" type="submit">Save values</button><span className="small muted">{charges.unset ? `${charges.unset} not saved yet. Suggestions are only saved when you press Save.` : "All values saved."}</span></div> : null}
          </form>
          {!charges.deductedAt && settle ? (
            charges.bothAcknowledged ? (
              <form action={deductChargesAction} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="leaseId" value={d.lease.id} />
                <p className="small">Deducting makes one entry in the deposit for {formatKobo(charges.fromDeposit)}, listing each item. It can be done once, after the tenancy has ended, and the values then cannot be changed.{charges.owed > 0n ? ` The remaining ${formatKobo(charges.owed)} is more than the deposit and stays owed by the occupant.` : ""}</p>
                <div className="row"><button className="btn primary" type="submit" disabled={charges.unset > 0 || charges.totalKobo <= 0n} data-confirm="Deduct from the deposit?" data-confirm-body={`${formatKobo(charges.fromDeposit)} comes out of the deposit held for this lease. This cannot be undone here.`} data-confirm-ok="Deduct">Deduct {formatKobo(charges.fromDeposit)} from the deposit</button></div>
              </form>
            ) : <p className="small muted">The total can be deducted from the deposit once both schedules are acknowledged.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
