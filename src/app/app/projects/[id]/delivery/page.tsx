import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getProjectDelivery } from "@/lib/services/project-delivery";
import { PARTY_ROLES, SITE_OUTCOMES } from "@/lib/project-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, toDateOnlyString, todayInLagos } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import {
  addProcurementAction, addQualityAction, addRiskAction, appointPartyAction, cancelProcurementAction, deliveryAction, endPartyAction, orderProcurementAction,
  progressUpdateAction, qualityResultAction, siteInspectionAction, sitePhotoAction, updateRiskAction, useStockAction, waiveQualityAction,
} from "./actions";

export const metadata = { title: "Project delivery" };

const procTone = (s: string) => (s === "DONE" ? "DONE" : s === "LATE" ? "OVERDUE" : s === "DUE_SOON" ? "HIGH" : s === "CANCELLED" ? "CANCELLED" : "OPEN");
const riskTone = (l: string) => (l === "HIGH" ? "OVERDUE" : l === "MEDIUM" ? "HIGH" : "OPEN");

export default async function DeliveryPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("project.view");
  const d = await getProjectDelivery(member, params.id);
  if (!d) notFound();
  const p = d.project;
  const plan = can(member.role, "project.plan");
  const money = can(member.role, "project.cost");
  const approve = can(member.role, "project.approve");
  const open = ["PLANNING", "ACTIVE", "ON_HOLD"].includes(p.status);
  const running = ["ACTIVE", "ON_HOLD"].includes(p.status);
  const active = p.status === "ACTIVE";
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  const who = (id: string | null) => (id ? d.names[id] ?? "Unknown user" : "—");
  const member_ = (id: string | null) => d.members.find((m) => m.id === id)?.name ?? "No owner";
  const pkg = (id: string | null) => { const w = d.packages.find((x) => x.id === id); return w ? `${w.code} ${w.title}` : "Whole project"; };
  const today = toDateOnlyString(todayInLagos());
  const openChecks = d.checks.filter((c) => c.result === "PENDING" || c.result === "FAILED").length;
  const riskFields = (r?: (typeof d.risks)[number]) => (
    <>
      <div className="fields">
        <Field label="Risk"><input name="title" required defaultValue={r?.title} /></Field>
        <Field label="Category"><input name="category" defaultValue={r?.category} /></Field>
        <Field label="Likelihood (1 to 5)"><select name="likelihood" defaultValue={String(r?.likelihood ?? 3)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Impact (1 to 5)"><select name="impact" defaultValue={String(r?.impact ?? 3)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Owner"><select name="ownerId" defaultValue={r?.ownerId ?? ""}><option value="">No owner</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Review on"><input name="reviewOn" type="date" defaultValue={r?.reviewOn ? toDateOnlyString(r.reviewOn) : ""} /></Field>
      </div>
      <Field label="Description"><input name="description" defaultValue={r?.description} /></Field>
      <Field label="Plan to reduce it" hint="Required for a high risk (score 15 or more)."><input name="mitigation" defaultValue={r?.mitigation} /></Field>
    </>
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href={`/app/projects/${p.id}`}>{p.ref} · {p.title}</Link></p>
        <h1>Delivery</h1>
        <p className="muted">Who is on the job, what is being bought, what could go wrong, what was seen on site and whether the work meets the standard.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card stack">
        <details className="inline">
          <summary><strong>Contractors and consultants</strong> <span className="small muted">({d.parties.filter((x) => !x.endedOn).length} appointed)</span></summary>
          {d.parties.length === 0 ? <p className="muted">Nobody appointed yet.</p> : (
            <ShowMore noun="more parties" limit={5} items={d.parties.map((x) => (
              <li key={x.id}><div className="row between" style={{ width: "100%" }}>
                <div><strong>{x.name}</strong> · {humanize(x.role)}<div className="small muted">{x.scope || "No scope recorded"}{x.email ? ` · ${x.email}` : ""}{x.phone ? ` · ${x.phone}` : ""}{x.appointedOn ? ` · from ${formatDate(x.appointedOn)}` : ""}{x.endedOn ? ` · ended ${formatDate(x.endedOn)}` : ""}</div></div>
                {plan && open && !x.endedOn ? <form action={endPartyAction}>{hidden}<input type="hidden" name="partyId" value={x.id} /><button className="btn" type="submit">End</button></form> : null}
              </div></li>
            ))} />
          )}
          {plan && open ? (
            <details className="inline"><summary>Appoint someone</summary>
              <form action={appointPartyAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Role"><select name="role" defaultValue="CONTRACTOR"><EnumOptions values={PARTY_ROLES} /></select></Field>
                  <Field label="Contractor on file"><select name="contractorId" defaultValue=""><option value="">Someone else</option>{d.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                  <Field label="Name" hint="If not on file."><input name="name" /></Field>
                  <Field label="Email"><input name="email" type="email" /></Field>
                  <Field label="Phone"><input name="phone" inputMode="tel" /></Field>
                  <Field label="Appointed on"><input name="appointedOn" type="date" /></Field>
                </div>
                <Field label="Scope"><input name="scope" /></Field>
                <button className="btn" type="submit">Appoint</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline" open={d.procurement.some((i) => i.state === "LATE") ? true : undefined}>
          <summary><strong>Materials and procurement</strong> <span className="small muted">({d.procurement.filter((i) => i.status === "REQUIRED" || i.status === "ORDERED").length} outstanding{d.procurement.some((i) => i.state === "LATE") ? `, ${d.procurement.filter((i) => i.state === "LATE").length} late` : ""})</span></summary>
          {d.procurement.length === 0 ? <p className="muted">No requirements yet.</p> : (
            <ShowMore noun="more items" limit={4} items={d.procurement.map((i) => (
              <li key={i.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{i.description}</strong><div className="small muted">{i.deliveredQty} of {i.quantity} {i.unit} delivered · needed by {formatDate(i.requiredBy)} · {pkg(i.workPackageId)}{i.supplierName ? ` · ${i.supplierName}` : ""}</div></div>
                  <Pill status={procTone(i.state)} label={i.state === "DONE" ? "Delivered" : i.state === "LATE" ? "Late" : i.state === "DUE_SOON" ? "Due soon" : humanize(i.status)} />
                </div>
                {i.status === "REQUIRED" && money && running ? (
                  <details className="inline"><summary>Mark as ordered</summary>
                    <form action={orderProcurementAction} className="stack">
                      {hidden}<input type="hidden" name="itemId" value={i.id} />
                      <div className="fields">
                        <Field label="Supplier"><input name="supplierName" required /></Field>
                        <Field label="Covered by commitment"><select name="commitmentId" defaultValue=""><option value="">Not linked</option>{d.commitments.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.supplierName}</option>)}</select></Field>
                        <Field label="Ordered on"><input name="orderedOn" type="date" /></Field>
                      </div>
                      <button className="btn" type="submit">Mark as ordered</button>
                    </form>
                  </details>
                ) : null}
                {i.status === "ORDERED" && plan && running ? (
                  <details className="inline"><summary>Record a delivery</summary>
                    <form action={deliveryAction} className="stack">
                      {hidden}<input type="hidden" name="itemId" value={i.id} />
                      <div className="fields">
                        <Field label={`Quantity (${i.unit})`}><input name="quantity" inputMode="numeric" required defaultValue={i.quantity - i.deliveredQty} /></Field>
                        <Field label="Delivered on"><input name="deliveredOn" type="date" /></Field>
                        <Field label="Book into stock" hint="Adds the quantity to this inventory item."><select name="inventoryItemId" defaultValue=""><option value="">Do not book into stock</option>{d.consumables.map((c) => <option key={c.id} value={c.id}>{c.itemNo} · {c.name}</option>)}</select></Field>
                      </div>
                      <button className="btn" type="submit">Record delivery</button>
                    </form>
                  </details>
                ) : null}
                {(i.status === "REQUIRED" || i.status === "ORDERED") && i.deliveredQty === 0 && plan && open ? <form action={cancelProcurementAction}>{hidden}<input type="hidden" name="itemId" value={i.id} /><button className="btn" type="submit">Cancel</button></form> : null}
              </div></li>
            ))} />
          )}
          {plan && open ? (
            <details className="inline"><summary>Add a requirement</summary>
              <form action={addProcurementAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="What is needed"><input name="description" required /></Field>
                  <Field label="Quantity"><input name="quantity" inputMode="numeric" required /></Field>
                  <Field label="Unit"><input name="unit" defaultValue="pcs" /></Field>
                  <Field label="Needed by"><input name="requiredBy" type="date" required /></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">Whole project</option>{d.packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                </div>
                <Field label="Note"><input name="note" /></Field>
                <button className="btn" type="submit">Add requirement</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Stock used on this project</strong> <span className="small muted">({d.stockUses.length})</span></summary>
          <p className="small muted">Stock issued from the inventory register. Its value is shown here for information and is not added to the project cost figures.</p>
          {d.stockUses.length === 0 ? <p className="muted">No stock used yet.</p> : (
            <ShowMore noun="more entries" limit={5} items={d.stockUses.map((u) => <li key={u.id}>{u.quantity} {u.item.unit} · <Link href={`/app/inventory/${u.itemId}`}>{u.item.itemNo} {u.item.name}</Link><div className="small muted">{formatKobo(u.unitCostKobo * BigInt(u.quantity))} · {pkg(u.workPackageId)} · {formatDate(u.createdAt)}</div></li>)} />
          )}
          {plan && active ? (
            <details className="inline"><summary>Issue stock to the project</summary>
              <form action={useStockAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Item"><select name="itemId" required defaultValue=""><option value="" disabled>Choose stock</option>{d.consumables.map((c) => <option key={c.id} value={c.id}>{c.itemNo} · {c.name} ({c.quantity} {c.unit})</option>)}</select></Field>
                  <Field label="Quantity"><input name="quantity" inputMode="numeric" required /></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">Whole project</option>{d.packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                </div>
                <button className="btn" type="submit">Issue stock</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Risk register</strong> <span className="small muted">({d.risks.filter((r) => r.status === "OPEN" || r.status === "MITIGATING").length} open{d.risks.some((r) => r.level === "HIGH" && r.status !== "CLOSED") ? ", some high" : ""})</span></summary>
          {d.risks.length === 0 ? <p className="muted">No risks recorded.</p> : (
            <ShowMore noun="more risks" limit={4} items={[...d.risks].sort((a, b) => b.score - a.score).map((r) => (
              <li key={r.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{r.ref}</strong> {r.title}<div className="small muted">{r.category ? `${r.category} · ` : ""}likelihood {r.likelihood}, impact {r.impact} · owner {member_(r.ownerId)}{r.reviewOn ? ` · review ${formatDate(r.reviewOn)}` : ""}</div></div>
                  <div className="row">{r.reviewOverdue ? <Pill status="OVERDUE" label="Review due" /> : null}<Pill status={riskTone(r.level)} label={`${humanize(r.level)} (${r.score})`} /><Pill status={r.status === "CLOSED" ? "DONE" : "OPEN"} label={humanize(r.status)} /></div>
                </div>
                {r.mitigation ? <div className="small">Plan: {r.mitigation}</div> : null}
                {r.closeNote ? <div className="small muted">Closed: {r.closeNote}</div> : null}
                {plan && open && r.status !== "CLOSED" ? (
                  <details className="inline"><summary>Update this risk</summary>
                    <form action={updateRiskAction} className="stack">
                      {hidden}<input type="hidden" name="riskId" value={r.id} />
                      {riskFields(r)}
                      <div className="fields">
                        <Field label="Status"><select name="status" defaultValue={r.status}><EnumOptions values={["OPEN", "MITIGATING", "OCCURRED", "CLOSED"]} /></select></Field>
                        <Field label="If closing, why"><input name="closeNote" /></Field>
                      </div>
                      <button className="btn" type="submit">Save</button>
                    </form>
                  </details>
                ) : null}
              </div></li>
            ))} />
          )}
          {plan && open ? (
            <details className="inline"><summary>Record a risk</summary>
              <form action={addRiskAction} className="stack">{hidden}{riskFields()}<button className="btn" type="submit">Record risk</button></form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Site inspections</strong> <span className="small muted">({d.inspections.length})</span></summary>
          {d.inspections.length === 0 ? <p className="muted">No site inspections recorded.</p> : (
            <ShowMore noun="earlier inspections" limit={3} items={d.inspections.map((s) => {
              const photos = d.sitePhotos.filter((x) => x.subjectId === s.id);
              return (
                <li key={s.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                  <div className="row between">
                    <div><strong>{formatDate(s.inspectedOn)}</strong> · {who(s.inspectorId)}<div className="small muted">{pkg(s.workPackageId)}</div></div>
                    <Pill status={s.outcome === "SATISFACTORY" ? "DONE" : s.outcome === "FAILED" ? "OVERDUE" : "HIGH"} label={humanize(s.outcome)} />
                  </div>
                  <div>{s.summary}</div>
                  {s.actions ? <div className="small">Actions: {s.actions}</div> : null}
                  {photos.length > 0 ? <ShowMore noun="more photographs" limit={3} items={photos.map((ph) => <li key={ph.id} style={{ display: "inline-block", marginRight: 8 }}><a href={`/app/photos/${ph.id}`}><img src={`/app/photos/${ph.id}`} alt={ph.caption || "Site photograph"} width={96} style={{ maxWidth: "100%", height: "auto", borderRadius: 6, border: "1px solid var(--line)" }} /></a></li>)} /> : null}
                  {plan && running ? (
                    <details className="inline"><summary>Add a photograph</summary>
                      <form action={sitePhotoAction} className="stack">
                        {hidden}<input type="hidden" name="inspectionId" value={s.id} />
                        <Field label="Photograph" hint="JPG, PNG or WEBP, up to 4 MB."><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required /></Field>
                        <Field label="Caption"><input name="caption" /></Field>
                        <button className="btn" type="submit">Add photograph</button>
                      </form>
                    </details>
                  ) : null}
                </div></li>
              );
            })} />
          )}
          {plan && running ? (
            <details className="inline"><summary>Record a site inspection</summary>
              <form action={siteInspectionAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Date"><input name="inspectedOn" type="date" required defaultValue={today} /></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">Whole project</option>{d.packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                  <Field label="Outcome"><select name="outcome" defaultValue="SATISFACTORY"><EnumOptions values={SITE_OUTCOMES} /></select></Field>
                </div>
                <Field label="What was seen"><textarea name="summary" rows={3} required /></Field>
                <Field label="Actions required" hint="Required unless the site is satisfactory."><input name="actions" /></Field>
                <Field label="Photograph" hint="Optional."><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></Field>
                <Field label="Caption"><input name="caption" /></Field>
                <button className="btn" type="submit">Record inspection</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Progress reports</strong> <span className="small muted">({d.updates.length})</span></summary>
          {d.updates.length === 0 ? <p className="muted">No progress reports yet.</p> : (
            <ShowMore noun="earlier reports" limit={3} items={d.updates.map((u) => (
              <li key={u.id}><div className="stack" style={{ gap: 4 }}>
                <div className="row between"><strong>{formatDate(u.reportDate)}</strong><span>{u.percentComplete}% complete</span></div>
                <div>{u.summary}</div>
                {u.issues ? <div className="small">Issues: {u.issues}</div> : null}
                {u.nextSteps ? <div className="small">Next: {u.nextSteps}</div> : null}
                <div className="small muted">{who(u.recordedById)}</div>
              </div></li>
            ))} />
          )}
          {plan && running ? (
            <details className="inline"><summary>Write a progress report</summary>
              <form action={progressUpdateAction} className="stack">
                {hidden}
                <Field label="Report date"><input name="reportDate" type="date" defaultValue={today} /></Field>
                <Field label="Summary"><textarea name="summary" rows={3} required /></Field>
                <Field label="Issues"><input name="issues" /></Field>
                <Field label="Next steps"><input name="nextSteps" /></Field>
                <button className="btn" type="submit">Record report</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline" open={d.checks.some((c) => c.result === "FAILED") ? true : undefined}>
          <summary><strong>Quality checks</strong> <span className="small muted">({d.checks.length}{openChecks ? `, ${openChecks} open` : ""})</span></summary>
          {d.checks.length === 0 ? <p className="muted">No quality checks yet.</p> : (
            <ShowMore noun="more checks" limit={5} items={d.checks.map((c) => {
              const photos = d.qualityPhotos.filter((x) => x.subjectId === c.id);
              return (
                <li key={c.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                  <div className="row between">
                    <div><strong>{c.title}</strong><div className="small muted">{pkg(c.workPackageId)}{c.standard ? ` · ${c.standard}` : ""}{c.checkedById ? ` · ${who(c.checkedById)} on ${formatDate(c.checkedOn)}` : ""}</div></div>
                    <Pill status={c.result === "PASSED" ? "DONE" : c.result === "FAILED" ? "OVERDUE" : c.result === "WAIVED" ? "CANCELLED" : "PENDING"} label={humanize(c.result)} />
                  </div>
                  {c.note ? <div className="small">{c.note}</div> : null}
                  {photos.length > 0 ? <ShowMore noun="more photographs" limit={3} items={photos.map((ph) => <li key={ph.id} style={{ display: "inline-block", marginRight: 8 }}><a href={`/app/photos/${ph.id}`}><img src={`/app/photos/${ph.id}`} alt={ph.caption || "Quality photograph"} width={96} style={{ maxWidth: "100%", height: "auto", borderRadius: 6, border: "1px solid var(--line)" }} /></a></li>)} /> : null}
                  {plan && running && (c.result === "PENDING" || c.result === "FAILED") ? (
                    <details className="inline"><summary>Record the result</summary>
                      <form action={qualityResultAction} className="stack">
                        {hidden}<input type="hidden" name="checkId" value={c.id} />
                        <Field label="Result"><select name="result" defaultValue="PASSED"><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></Field>
                        <Field label="Note" hint="Required if it failed."><input name="note" /></Field>
                        <Field label="Photograph" hint="Optional."><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></Field>
                        <button className="btn" type="submit">Save result</button>
                      </form>
                    </details>
                  ) : null}
                  {approve && running && (c.result === "PENDING" || c.result === "FAILED") ? (
                    <details className="inline"><summary>Waive this check</summary>
                      <form action={waiveQualityAction} className="stack">
                        {hidden}<input type="hidden" name="checkId" value={c.id} />
                        <Field label="Reason"><input name="reason" required /></Field>
                        <button className="btn" type="submit">Waive</button>
                      </form>
                    </details>
                  ) : null}
                </div></li>
              );
            })} />
          )}
          {plan && open && d.packages.length > 0 ? (
            <details className="inline"><summary>Add a quality check</summary>
              <form action={addQualityAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Work package"><select name="packageId" required defaultValue="">{<option value="" disabled>Choose</option>}{d.packages.filter((w) => w.status !== "DONE").map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                  <Field label="What is checked"><input name="title" required /></Field>
                  <Field label="Standard or specification"><input name="standard" /></Field>
                </div>
                <button className="btn" type="submit">Add check</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>
    </div>
  );
}
