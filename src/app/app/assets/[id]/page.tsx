import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getAsset, ASSET_STATUSES, PARTY_RELATIONSHIPS, DOCUMENT_CATEGORIES } from "@/lib/services/assets";
import { FREQUENCIES } from "@/lib/services/leases";
import { TASK_KINDS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/services/tasks";
import { PURPOSES } from "@/lib/services/listings";
import { listTeam } from "@/lib/services/companies";
import { formatKobo } from "@/lib/money";
import { chargeState } from "@/lib/rent";
import { formatDate, formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import {
  addPartyAction, createLeaseAction, createTaskAction, listingStatusAction, recordPaymentAction,
  saveListingAction, updateStatusAction, updateTaskAction, uploadDocumentAction,
} from "../actions";

export const metadata = { title: "Asset" };

function koboToInput(k: bigint) {
  const whole = k / 100n;
  const frac = k % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

export default async function AssetPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const result = await getAsset(member, params.id);
  if (!result) notFound();
  const { asset, history, actorNames } = result;
  const team = can(member.role, "task.create") ? (await listTeam(member)).members.filter((m) => m.status === "ACTIVE") : [];
  const today = todayInLagos();
  const listing = asset.listing;
  const hidden = <input type="hidden" name="assetId" value={asset.id} />;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <p className="small"><Link href="/app/assets">Asset register</Link></p>
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <p className="eyebrow mono">{asset.ref}</p>
            <h1>{asset.name}</h1>
            <p className="muted">
              {humanize(asset.assetClass)} · {asset.category}
              {asset.city || asset.state ? ` · ${[asset.city, asset.state].filter(Boolean).join(", ")}` : ""}
            </p>
          </div>
          <div className="row">
            <Pill status={asset.status} />
            <span className="pill disc">Held as {humanize(asset.companyRelationship).toLowerCase()}</span>
          </div>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <div className="two">
        <div className="stack-lg">
          {/* Leases and rent */}
          <section className="card" aria-labelledby="leases-h">
            <div className="section-head"><h2 id="leases-h">Leases and rent</h2></div>
            {asset.leases.length === 0 ? <p className="muted">No leases recorded for this asset.</p> : null}
            <div className="stack">
              {asset.leases.map((l) => {
                const outstanding = l.charges.reduce((s, c) => s + (c.amountKobo - c.paidKobo), 0n);
                return (
                  <div key={l.id} className="stack" style={{ gap: 8 }}>
                    <div className="row between">
                      <div>
                        <strong>{l.occupantName}</strong> <span className="mono small muted">{l.ref}</span>
                        <div className="small muted">
                          {formatDate(l.startDate)} to {formatDate(l.endDate)} · {formatKobo(l.rentKobo)} {humanize(l.frequency).toLowerCase()}
                          {l.depositKobo > 0n ? ` · deposit ${formatKobo(l.depositKobo)}` : ""}
                        </div>
                      </div>
                      <span className="small">Outstanding <strong className="num">{formatKobo(outstanding)}</strong></span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Due</th><th className="r">Amount</th><th className="r">Paid</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                          {l.charges.map((c) => {
                            const state = chargeState(c, today);
                            return (
                              <tr key={c.id}>
                                <td>{formatDate(c.dueDate)}</td>
                                <td className="r">{formatKobo(c.amountKobo)}</td>
                                <td className="r">{formatKobo(c.paidKobo)}</td>
                                <td><Pill status={state} /></td>
                                <td>
                                  {state !== "PAID" && can(member.role, "payment.record") ? (
                                    <details className="inline">
                                      <summary className="small">Record payment</summary>
                                      <form action={recordPaymentAction} className="stack" style={{ minWidth: 220 }}>
                                        {hidden}
                                        <input type="hidden" name="chargeId" value={c.id} />
                                        <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" defaultValue={koboToInput(c.amountKobo - c.paidKobo)} /></Field>
                                        <Field label="Paid on"><input name="paidOn" type="date" required defaultValue={toDateOnlyString(today)} max={toDateOnlyString(today)} /></Field>
                                        <Field label="Evidence" hint="Bank reference, receipt number or verified provider transaction.">
                                          <input name="evidence" required />
                                        </Field>
                                        <button className="btn primary small" type="submit">Save payment</button>
                                      </form>
                                    </details>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {can(member.role, "lease.manage") ? (
                <details className="inline">
                  <summary>Add a lease</summary>
                  <form action={createLeaseAction} className="stack">
                    {hidden}
                    <div className="fields">
                      <Field label="Tenant or occupier"><input name="occupantName" required /></Field>
                      <Field label="Contact"><input name="occupantContact" /></Field>
                    </div>
                    <div className="fields">
                      <Field label="Start date"><input name="startDate" type="date" required /></Field>
                      <Field label="End date"><input name="endDate" type="date" required /></Field>
                    </div>
                    <div className="fields">
                      <Field label="Rent per period (₦)"><input name="rent" required inputMode="decimal" /></Field>
                      <Field label="Paid"><select name="frequency" defaultValue="YEARLY"><EnumOptions values={FREQUENCIES} /></select></Field>
                      <Field label="Deposit (₦)"><input name="deposit" inputMode="decimal" /></Field>
                    </div>
                    <p className="small muted">The rent schedule is generated from these terms. Rent is due at the start of each period.</p>
                    <div className="row"><button className="btn primary" type="submit">Create lease</button></div>
                  </form>
                </details>
              ) : null}
            </div>
          </section>

          {/* Tasks */}
          <section className="card" aria-labelledby="tasks-h">
            <div className="section-head"><h2 id="tasks-h">Tasks, inspections and maintenance</h2></div>
            {asset.tasks.length === 0 ? <p className="muted">No tasks for this asset.</p> : (
              <div className="stack">
                {asset.tasks.map((t) => {
                  const canUpdate = t.assigneeId === member.membershipId || can(member.role, "task.update.any");
                  const overdue = t.dueOn && t.dueOn < today && (t.status === "OPEN" || t.status === "IN_PROGRESS");
                  return (
                    <div key={t.id} className="stack" style={{ gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                      <div className="row between">
                        <div>
                          <strong>{t.title}</strong>
                          <div className="small muted">
                            {humanize(t.kind)} · {t.assignee ? t.assignee.user.name : "Unassigned"}
                            {t.dueOn ? ` · due ${formatDate(t.dueOn)}` : ""}
                          </div>
                        </div>
                        <div className="row">
                          {t.priority !== "NORMAL" ? <Pill status={t.priority} /> : null}
                          {overdue ? <Pill status="OVERDUE" /> : null}
                          <Pill status={t.status} />
                        </div>
                      </div>
                      {t.description ? <p className="small">{t.description}</p> : null}
                      {t.outcome ? <p className="small"><strong>Outcome:</strong> {t.outcome}</p> : null}
                      {canUpdate && (t.status === "OPEN" || t.status === "IN_PROGRESS") ? (
                        <details className="inline">
                          <summary className="small">Update</summary>
                          <form action={updateTaskAction} className="fields">
                            {hidden}
                            <input type="hidden" name="taskId" value={t.id} />
                            <Field label="Status"><select name="status" defaultValue={t.status}><EnumOptions values={TASK_STATUSES} /></select></Field>
                            <Field label="Outcome or findings" hint="Required to mark done."><input name="outcome" /></Field>
                            <div style={{ alignSelf: "end" }}><button className="btn small" type="submit">Save</button></div>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {can(member.role, "task.create") ? (
              <details className="inline" style={{ marginTop: 12 }}>
                <summary>Add a task</summary>
                <form action={createTaskAction} className="stack">
                  {hidden}
                  <div className="fields">
                    <Field label="Type"><select name="kind" defaultValue="INSPECTION"><EnumOptions values={TASK_KINDS} /></select></Field>
                    <Field label="Priority"><select name="priority" defaultValue="NORMAL"><EnumOptions values={TASK_PRIORITIES} /></select></Field>
                    <Field label="Due"><input name="dueOn" type="date" /></Field>
                  </div>
                  <Field label="Title"><input name="title" required /></Field>
                  <Field label="Assign to">
                    <select name="assigneeId" defaultValue="">
                      <option value="">Unassigned</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Details"><textarea name="description" rows={3} /></Field>
                  <div className="row"><button className="btn primary" type="submit">Create task</button></div>
                </form>
              </details>
            ) : null}
          </section>

          {/* Public listing */}
          <section className="card" aria-labelledby="listing-h">
            <div className="section-head">
              <h2 id="listing-h">Public listing</h2>
              {listing ? <Pill status={listing.status} /> : <span className="small muted">Not listed. This asset is internal only.</span>}
            </div>
            {listing ? (
              <div className="stack" style={{ gap: 10, marginBottom: 12 }}>
                <p><strong>{listing.title}</strong> · {formatKobo(listing.priceKobo)} · {humanize(listing.purpose)}</p>
                {listing.status === "PUBLISHED" ? <p className="small">Live at <Link href={`/properties/${listing.publicRef}`} className="mono">/properties/{listing.publicRef}</Link></p> : null}
                {listing.reviewNote && listing.status === "DRAFT" ? <div className="flash error">Review note: {listing.reviewNote}</div> : null}
                {can(member.role, "listing.manage") ? (
                  <div className="row">
                    {listing.status === "DRAFT" || listing.status === "UNAVAILABLE" ? (
                      <form action={listingStatusAction}>{hidden}<input type="hidden" name="to" value="PENDING_REVIEW" /><button className="btn primary small" type="submit">Submit for review</button></form>
                    ) : null}
                    {listing.status === "PENDING_REVIEW" ? (
                      <form action={listingStatusAction}>{hidden}<input type="hidden" name="to" value="DRAFT" /><button className="btn small" type="submit">Withdraw from review</button></form>
                    ) : null}
                    {listing.status === "PUBLISHED" ? (
                      <form action={listingStatusAction}>{hidden}<input type="hidden" name="to" value="UNAVAILABLE" /><button className="btn small" type="submit">Mark unavailable</button></form>
                    ) : null}
                  </div>
                ) : null}
                {can(member.role, "enquiry.view") && listing.enquiries.length > 0 ? (
                  <div className="stack" style={{ gap: 6 }}>
                    <h3>Enquiries</h3>
                    {listing.enquiries.map((e) => (
                      <div key={e.id} className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                        <strong>{e.name}</strong> · {e.contact} · <span className="muted">{formatDateTime(e.createdAt)}</span>
                        <p>{e.message}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {can(member.role, "listing.manage") ? (
              <details className="inline">
                <summary>{listing ? "Edit listing" : "Create a listing"}</summary>
                <form action={saveListingAction} className="stack">
                  {hidden}
                  {listing?.status === "PUBLISHED" ? <p className="small muted">Saving changes takes the listing offline until it is reviewed again.</p> : null}
                  <Field label="Listing title"><input name="title" required defaultValue={listing?.title ?? asset.name} /></Field>
                  <div className="fields">
                    <Field label="Purpose"><select name="purpose" defaultValue={listing?.purpose ?? "SALE"}><EnumOptions values={PURPOSES} /></select></Field>
                    <Field label="Price (₦)" hint="For rent or lease, the yearly amount."><input name="price" required inputMode="decimal" defaultValue={listing ? koboToInput(listing.priceKobo) : ""} /></Field>
                  </div>
                  <div className="fields">
                    <Field label="Bedrooms"><input name="bedrooms" inputMode="numeric" defaultValue={listing?.bedrooms ?? ""} /></Field>
                    <Field label="Bathrooms"><input name="bathrooms" inputMode="numeric" defaultValue={listing?.bathrooms ?? ""} /></Field>
                    <Field label="City or area"><input name="city" required defaultValue={listing?.city ?? asset.city} /></Field>
                    <Field label="State"><input name="state" required defaultValue={listing?.state ?? asset.state} /></Field>
                  </div>
                  <Field label="Public description" hint="Do not include the exact address of occupied homes."><textarea name="description" rows={4} defaultValue={listing?.description ?? ""} /></Field>
                  <div className="row"><button className="btn primary" type="submit">Save draft</button></div>
                </form>
              </details>
            ) : null}
          </section>
        </div>

        <div className="stack-lg">
          {/* Status */}
          {can(member.role, "asset.update") ? (
            <section className="card">
              <h2>Change status</h2>
              <form action={updateStatusAction} className="stack">
                {hidden}
                <Field label="New status"><select name="status" defaultValue={asset.status}><EnumOptions values={ASSET_STATUSES} /></select></Field>
                <Field label="Reason"><input name="reason" required /></Field>
                <button className="btn" type="submit">Update status</button>
              </form>
            </section>
          ) : null}

          {/* Ownership and responsibility */}
          <section className="card" aria-labelledby="parties-h">
            <h2 id="parties-h">Ownership and responsibility</h2>
            {asset.parties.length === 0 ? <p className="muted small">No owner, manager or custodian recorded yet.</p> : (
              <ul className="timeline">
                {asset.parties.map((p) => (
                  <li key={p.id}>
                    <div>
                      <strong>{p.partyName}</strong>
                      <div className="small muted">{humanize(p.relationship)}{p.effectiveFrom ? ` · from ${formatDate(p.effectiveFrom)}` : ""}</div>
                      {p.evidenceNote ? <div className="small">{p.evidenceNote}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can(member.role, "party.manage") ? (
              <details className="inline" style={{ marginTop: 12 }}>
                <summary>Record a relationship</summary>
                <form action={addPartyAction} className="stack">
                  {hidden}
                  <Field label="Person or organization"><input name="partyName" required /></Field>
                  <Field label="Relationship"><select name="relationship" defaultValue="LEGAL_OWNER"><EnumOptions values={PARTY_RELATIONSHIPS} /></select></Field>
                  <Field label="Effective from"><input name="effectiveFrom" type="date" /></Field>
                  <Field label="Evidence" hint="For example: Deed of Assignment dated 2019, see documents."><input name="evidenceNote" /></Field>
                  <button className="btn primary" type="submit">Save</button>
                </form>
              </details>
            ) : null}
          </section>

          {/* Documents */}
          <section className="card" aria-labelledby="docs-h">
            <h2 id="docs-h">Documents</h2>
            <p className="small muted" style={{ marginBottom: 10 }}>Uploading a document records that it exists. It does not verify ownership.</p>
            {asset.documents.length === 0 ? <p className="muted small">No documents uploaded.</p> : (
              <ul className="timeline">
                {asset.documents.map((d) => (
                  <li key={d.id}>
                    <div>
                      {can(member.role, "document.download") ? <a href={`/app/documents/${d.id}`}>{d.title}</a> : <span>{d.title}</span>}
                      <div className="small muted">
                        {humanize(d.category)} · v{d.version} · {(d.sizeBytes / 1024).toFixed(0)} KB
                        {d.expiresOn ? ` · expires ${formatDate(d.expiresOn)}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can(member.role, "document.upload") ? (
              <details className="inline" style={{ marginTop: 12 }}>
                <summary>Upload a document</summary>
                <form action={uploadDocumentAction} className="stack">
                  {hidden}
                  <Field label="Title"><input name="title" required /></Field>
                  <Field label="Category"><select name="category" defaultValue="TITLE_OWNERSHIP"><EnumOptions values={DOCUMENT_CATEGORIES} /></select></Field>
                  <Field label="Expires on" hint="Optional, for permits, insurance and leases."><input name="expiresOn" type="date" /></Field>
                  <Field label="File" hint="PDF, JPG, PNG, WEBP or Word, up to 10 MB."><input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" /></Field>
                  <button className="btn primary" type="submit">Upload</button>
                </form>
              </details>
            ) : null}
          </section>

          {/* History */}
          <section className="card" aria-labelledby="history-h">
            <h2 id="history-h">History</h2>
            {history.length === 0 ? <p className="muted small">No activity yet.</p> : (
              <ul className="timeline">
                {history.map((h) => (
                  <li key={h.id}>
                    <div>
                      <div className="small">{humanize(h.action.replace(".", " "))}</div>
                      <div className="small muted">{h.actorId ? actorNames[h.actorId] ?? "Unknown user" : "Public visitor"} · {formatDateTime(h.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
