import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { CONDITIONS, getHandoverInventory } from "@/lib/services/inventory";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, TableMore, sp, type SP } from "@/components/ui";
import { acknowledgeAction, addLineAction, addLinePhotoAction, createScheduleAction, removeLineAction } from "../../inventory/actions";

export const metadata = { title: "Handover inventory" };

const KIND_TEXT = { SAME: "No change", WORSE: "Condition worse", BETTER: "Condition better", FEWER: "Fewer than at move-in", MORE: "More than at move-in", MISSING: "Missing", NEW: "Not at move-in" } as const;

export default async function HandoverInventoryPage({ params: paramsP, searchParams: searchP }: { params: Promise<{ leaseId: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const d = await getHandoverInventory(member, params.leaseId);
  if (!d) notFound();
  const record = can(member.role, "handover.record");
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
                            <td>{l.room}</td><td>{l.description}</td><td className="r num">{l.quantity}</td><td>{humanize(l.condition)}</td><td className="small">{l.notes}</td>
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
                              <td><form action={removeLineAction}><input type="hidden" name="leaseId" value={d.lease.id} /><input type="hidden" name="scheduleId" value={schedule.id} /><input type="hidden" name="lineId" value={l.id} /><button className="btn small" type="submit">Remove</button></form></td>
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
                        <Field label="Item"><input name="description" required placeholder="Sofa, ceiling fan, wardrobe" /></Field>
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
          <p className="small muted">This comparison is a record of differences for people to review. It does not decide any deduction from the deposit.</p>
        </section>
      ) : null}
    </div>
  );
}
