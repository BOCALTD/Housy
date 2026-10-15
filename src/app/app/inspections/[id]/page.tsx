import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { CHECK_RESULTS, getInspection, RATINGS, SEVERITIES } from "@/lib/services/inspections";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { reportWorkOrderAction } from "../../maintenance/actions";
import {
  addFindingAction, addPhotoAction, approveInspectionAction, cancelInspectionAction, returnInspectionAction,
  saveRecordAction, submitInspectionAction,
} from "../actions";

export const metadata = { title: "Inspection" };

function koboToInput(k: bigint | null) {
  if (k === null) return "";
  const whole = k / 100n;
  const frac = k % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

const STATUS_PILL = { SCHEDULED: "OPEN", SUBMITTED: "PENDING", APPROVED: "APPROVED", CANCELLED: "CANCELLED" } as const;

export default async function InspectionPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const data = await getInspection(member, params.id);
  if (!data) notFound();
  const { inspection: ins, photos, warnings, history, names, memberNames } = data;
  const todayText = toDateOnlyString(todayInLagos());
  const open = ins.status === "SCHEDULED";
  const canRecord = open && can(member.role, "inspection.conduct") && (ins.inspectorId === member.membershipId || can(member.role, "inspection.manage"));
  const conflicted = ins.inspector?.userId === member.userId || ins.submittedById === member.userId;
  const canDecide = ins.status === "SUBMITTED" && can(member.role, "inspection.approve") && !conflicted;
  const hidden = <input type="hidden" name="inspectionId" value={ins.id} />;
  const who = (id: string | null) => (id ? names[id] ?? "Unknown user" : "—");
  const photosOf = (type: string, id: string) => photos.filter((p) => p.subjectType === type && p.subjectId === id);
  const gallery = (list: typeof photos) => list.length === 0 ? null : (
    <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
      {list.map((p) => (
        <figure key={p.id} style={{ margin: 0, width: 160 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={`/app/photos/${p.id}`}><img src={`/app/photos/${p.id}`} alt={p.caption || "Inspection photograph"} width={160} style={{ maxWidth: "100%", height: "auto", borderRadius: 8, border: "1px solid var(--line)" }} /></a>
          <figcaption className="small muted">{humanize(p.phase)}{p.caption ? ` · ${p.caption}` : ""}</figcaption>
        </figure>
      ))}
    </div>
  );
  const input = { border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", minWidth: 130, background: "var(--surface)" } as const;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/inspections">All inspections</Link> · <Link href={`/app/assets/${ins.asset.id}`}>{ins.asset.ref} · {ins.asset.name}</Link></p>
        <div className="row between">
          <div>
            <p className="eyebrow mono">{ins.ref}</p>
            <h1>{humanize(ins.purpose)} inspection</h1>
            <p className="muted">
              Scheduled {formatDate(ins.scheduledFor)} · inspector {ins.inspectorId ? memberNames[ins.inspectorId] ?? "—" : "not assigned"}
              {ins.responsibleId ? ` · responsible ${memberNames[ins.responsibleId] ?? "—"}` : ""}
              {ins.template ? ` · ${ins.template.name}` : ""}{ins.recurrenceMonths ? ` · repeats every ${ins.recurrenceMonths} months` : ""}
            </p>
          </div>
          <Pill status={STATUS_PILL[ins.status]} label={ins.status === "SUBMITTED" ? "Awaiting approval" : undefined} />
        </div>
        {ins.rolledFrom ? <p className="small muted">Follows <Link href={`/app/inspections/${ins.rolledFrom.id}`}>{ins.rolledFrom.ref}</Link></p> : null}
        {ins.rolledTo ? <p className="small muted">Next: <Link href={`/app/inspections/${ins.rolledTo.id}`}>{ins.rolledTo.ref}</Link></p> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {ins.returnNote && open ? <div className="card"><strong>Returned for correction:</strong> {ins.returnNote}</div> : null}
      {warnings.length > 0 ? (
        <div className="card" role="note" aria-label="Possible inconsistencies">
          <strong>Possible inconsistencies to check</strong>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="small muted">These are prompts for the reviewer, not conclusions. They do not replace a professional inspection.</p>
        </div>
      ) : null}

      {canRecord ? (
        <form action={saveRecordAction} className="card stack" aria-labelledby="rec-h">
          {hidden}
          <h2 id="rec-h">Record the inspection</h2>
          <div className="fields">
            <Field label="Carried out on"><input name="conductedOn" type="date" max={todayText} defaultValue={ins.conductedOn ? toDateOnlyString(ins.conductedOn) : ""} /></Field>
            <Field label="Location on site"><input name="location" defaultValue={ins.location} /></Field>
            <Field label="Participants"><input name="participants" defaultValue={ins.participants} /></Field>
          </div>
          {ins.responses.length > 0 ? (
            <div className="table-wrap">
              <TableMore limit={12} noun="more rows" head={<tr><th>Area</th><th>Check</th><th>Result</th><th>Note</th></tr>} rows={ins.responses.map((r) => (
                    <tr key={r.id}>
                      <td>{r.category}</td><td>{r.prompt}</td>
                      <td><select name={`result:${r.id}`} defaultValue={r.result} aria-label={`Result for ${r.prompt}`} style={input}><EnumOptions values={CHECK_RESULTS} /></select></td>
                      <td><input name={`note:${r.id}`} defaultValue={r.note} aria-label={`Note for ${r.prompt}`} style={{ ...input, width: "100%" }} /></td>
                    </tr>
                  ))} />
            </div>
          ) : <p className="muted small">This inspection has no checklist. Use the summary and findings.</p>}
          <div className="fields">
            <Field label="Overall condition"><select name="conditionRating" defaultValue={ins.conditionRating ?? ""}><option value="">Not rated</option><EnumOptions values={RATINGS} /></select></Field>
            <Field label="Estimated repairs (₦)"><input name="estimatedRepair" inputMode="decimal" defaultValue={koboToInput(ins.estimatedRepairKobo)} /></Field>
            <Field label="Follow up by"><input name="followUpBy" type="date" defaultValue={ins.followUpBy ? toDateOnlyString(ins.followUpBy) : ""} /></Field>
          </div>
          {ins.asset.assetClass === "PLANT_MACHINERY" || ins.asset.assetClass === "INDUSTRIAL" ? (
            <div className="fields">
              <Field label="Operating hours"><input name="operatingHours" inputMode="numeric" defaultValue={ins.operatingHours ?? ""} /></Field>
              <Field label="Technical notes" hint="Serial numbers, maintenance status, safety documents."><textarea name="technicalNotes" rows={2} defaultValue={ins.technicalNotes} /></Field>
            </div>
          ) : <input type="hidden" name="technicalNotes" value={ins.technicalNotes} />}
          <Field label="Summary"><textarea name="summary" rows={3} defaultValue={ins.summary} /></Field>
          <Field label="Recommended actions"><textarea name="recommendedActions" rows={3} defaultValue={ins.recommendedActions} /></Field>
          <button className="btn primary" type="submit">Save</button>
        </form>
      ) : (
        <section className="card stack" aria-labelledby="rec-h">
          <h2 id="rec-h">Record</h2>
          <p className="small muted">
            {ins.conductedOn ? `Carried out ${formatDate(ins.conductedOn)}` : "Not yet carried out"}{ins.location ? ` · ${ins.location}` : ""}{ins.participants ? ` · with ${ins.participants}` : ""}
          </p>
          {ins.responses.length > 0 ? (
            <div className="table-wrap">
              <TableMore limit={12} noun="more rows" head={<tr><th>Area</th><th>Check</th><th>Result</th><th>Note</th></tr>} rows={ins.responses.map((r) => <tr key={r.id}><td>{r.category}</td><td>{r.prompt}</td><td>{humanize(r.result)}</td><td>{r.note || "—"}</td></tr>)} />
            </div>
          ) : null}
          <div className="fields">
            <div><div className="small muted">Overall condition</div>{ins.conditionRating ? humanize(ins.conditionRating) : "—"}</div>
            <div><div className="small muted">Estimated repairs</div>{ins.estimatedRepairKobo !== null ? formatKobo(ins.estimatedRepairKobo) : "—"}</div>
            <div><div className="small muted">Follow up by</div>{ins.followUpBy ? formatDate(ins.followUpBy) : "—"}</div>
          </div>
          {ins.operatingHours !== null || ins.technicalNotes ? <p className="small">Operating hours {ins.operatingHours ?? "—"} · {ins.technicalNotes || "no technical notes"}</p> : null}
          <div><div className="small muted">Summary</div><p style={{ whiteSpace: "pre-wrap" }}>{ins.summary || "—"}</p></div>
          <div><div className="small muted">Recommended actions</div><p style={{ whiteSpace: "pre-wrap" }}>{ins.recommendedActions || "—"}</p></div>
        </section>
      )}

      <section className="card stack" aria-labelledby="find-h">
        <h2 id="find-h">Findings</h2>
        {ins.findings.length === 0 ? <p className="muted small">No defects or observations recorded.</p> : (
          <ShowMore noun="more" limit={5} items={ins.findings.map((f) => (
              <li key={f.id}>
                <div className="stack" style={{ gap: 6 }}>
                  <div>
                    <strong>{f.title}</strong> <Pill status={f.severity === "LOW" ? "OPEN" : f.severity === "MEDIUM" ? "PENDING" : "OVERDUE"} label={humanize(f.severity)} />
                    {f.safetyRisk ? <> <Pill status="OVERDUE" label="Safety risk" /></> : null}
                  </div>
                  <div className="small muted">{f.location ? `${f.location} · ` : ""}{f.estimatedCostKobo !== null ? `est. ${formatKobo(f.estimatedCostKobo)}` : "no estimate"}</div>
                  {f.description ? <div className="small">{f.description}</div> : null}
                  {f.recommendedAction ? <div className="small">Recommended: {f.recommendedAction}</div> : null}
                  {gallery(photosOf("inspection_finding", f.id))}
                  {f.workOrderId ? <p className="small"><Link href={`/app/maintenance/${f.workOrderId}`}>Work order raised</Link></p> : (ins.status === "SUBMITTED" || ins.status === "APPROVED") && can(member.role, "maintenance.request") ? (
                    <form action={reportWorkOrderAction}>
                      <input type="hidden" name="assetId" value={ins.asset.id} /><input type="hidden" name="findingId" value={f.id} />
                      <input type="hidden" name="title" value={f.title} /><input type="hidden" name="description" value={[f.description, f.recommendedAction].filter(Boolean).join("\n")} />
                      <input type="hidden" name="priority" value={f.severity === "CRITICAL" ? "HIGH" : "NORMAL"} /><input type="hidden" name="riskLevel" value={f.severity} />
                      {f.safetyRisk ? <input type="hidden" name="safetyRisk" value="on" /> : null}
                      {f.estimatedCostKobo !== null ? <input type="hidden" name="estimatedCost" value={koboToInput(f.estimatedCostKobo)} /> : null}
                      <button className="btn small" type="submit">Raise a work order for this</button>
                    </form>
                  ) : null}
                  {canRecord ? (
                    <details className="inline">
                      <summary className="small">Add a photograph</summary>
                      <form action={addPhotoAction} className="stack" encType="multipart/form-data">
                        {hidden}<input type="hidden" name="findingId" value={f.id} />
                        <Field label="Photograph"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></Field>
                        <Field label="Caption"><input name="caption" /></Field>
                        <button className="btn small" type="submit">Upload</button>
                      </form>
                    </details>
                  ) : null}
                </div>
              </li>
            ))} />
        )}
        {canRecord ? (
          <details className="inline">
            <summary>Add a finding</summary>
            <form action={addFindingAction} className="stack" encType="multipart/form-data">
              {hidden}
              <Field label="Defect or observation"><input name="title" required /></Field>
              <div className="fields">
                <Field label="Severity"><select name="severity" defaultValue="MEDIUM"><EnumOptions values={SEVERITIES} /></select></Field>
                <Field label="Where"><input name="location" /></Field>
                <Field label="Estimated cost (₦)"><input name="estimatedCost" inputMode="decimal" /></Field>
              </div>
              <Field label="Description"><textarea name="description" rows={2} /></Field>
              <Field label="Recommended action"><input name="recommendedAction" /></Field>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" name="safetyRisk" /> This is a safety risk</label>
              <Field label="Photograph" hint="JPG, PNG or WEBP, up to 4 MB."><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
              <button className="btn primary" type="submit">Add finding</button>
            </form>
          </details>
        ) : null}
        {gallery(photosOf("inspection", ins.id))}
        {canRecord ? (
          <details className="inline">
            <summary>Add a general photograph</summary>
            <form action={addPhotoAction} className="stack" encType="multipart/form-data">
              {hidden}
              <Field label="Photograph"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></Field>
              <Field label="Caption"><input name="caption" /></Field>
              <button className="btn small" type="submit">Upload</button>
            </form>
          </details>
        ) : null}
      </section>

      {canRecord ? (
        <section className="card stack">
          <h2>Submit for approval</h2>
          <p className="small muted">Save first. An inspection must be approved by someone other than the inspector or the person who submits it.</p>
          <form action={submitInspectionAction}>{hidden}<button className="btn primary" type="submit">Submit</button></form>
          {can(member.role, "inspection.manage") ? (
            <details className="inline"><summary>Cancel this inspection</summary>
              <form action={cancelInspectionAction} className="stack">{hidden}<Field label="Reason"><input name="reason" required /></Field><button className="btn danger" type="submit">Cancel inspection</button></form>
            </details>
          ) : null}
        </section>
      ) : null}

      {ins.status === "SUBMITTED" ? (
        <section className="card stack">
          <h2>Review</h2>
          <p className="small muted">Submitted by {who(ins.submittedById)} on {ins.submittedAt ? formatDateTime(ins.submittedAt) : "—"}.</p>
          {canDecide ? (
            <div className="row">
              <form action={approveInspectionAction} className="row">{hidden}<input type="hidden" name="note" value="" /><button className="btn primary" type="submit">Approve</button></form>
              <details className="inline"><summary>Return for correction</summary>
                <form action={returnInspectionAction} className="stack">{hidden}<Field label="What needs correcting"><input name="note" required /></Field><button className="btn" type="submit">Return</button></form>
              </details>
            </div>
          ) : <p className="small muted">{conflicted ? "You inspected or submitted this, so someone else must approve it." : "Waiting for an approver."}</p>}
        </section>
      ) : null}
      {ins.status === "APPROVED" ? <p className="small muted">Approved by {who(ins.decidedById)} on {ins.decidedAt ? formatDateTime(ins.decidedAt) : "—"}.</p> : null}
      {ins.status === "CANCELLED" ? <p className="small muted">Cancelled: {ins.cancelReason}</p> : null}

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">History</h2>
        <ShowMore noun="more" limit={5} items={history.map((h) => (
            <li key={h.id}><div><div>{humanize(h.action.replace(/[._]/g, " "))}</div><div className="small muted">{formatDateTime(h.createdAt)} · {who(h.actorId)}</div></div></li>
          ))} />
      </section>
    </div>
  );
}
