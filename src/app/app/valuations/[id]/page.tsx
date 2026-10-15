import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { BASES, ENTRY_KINDS, EVIDENCE_KINDS, getValuation, PREMISES } from "@/lib/services/valuation";
import { adjustedPerSqm, formatArea, formatPercent, METHOD_LABEL, METHODS, type Method } from "@/lib/valuation-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import {
  addComparableAction, addDocumentAction, addEntryAction, assignAction, cancelAction, decideReportAction, issueAction, removeComparableAction, removeEntryAction,
  removeWorksheetAction, reviseReportAction, saveDraftAction, submitReportAction, updateInstructionAction, verifyComparableAction, worksheetAction,
} from "../actions";

export const metadata = { title: "Valuation" };

const nairaInput = (kobo: string | undefined) => {
  if (!kobo) return "";
  const k = BigInt(kobo);
  return `${k / 100n}.${String(k % 100n).padStart(2, "0")}`;
};
const pctInput = (bps: string | undefined) => (bps === undefined ? "" : String(Number(bps) / 100));
const areaInput = (a: string | undefined) => (a === undefined ? "" : String(Number(a) / 100));

export default async function ValuationPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("valuation.view");
  const data = await getValuation(member, params.id);
  if (!data) notFound();
  const { inst, worksheets, comparables, entries, documents, reports, openReport, readiness, names, editable, members } = data;
  const back = `/app/valuations/${inst.id}`;
  const prepare = can(member.role, "valuation.prepare") && editable;
  const manage = can(member.role, "valuation.manage");
  const approve = can(member.role, "valuation.approve");
  const who = (id: string | null) => (id ? names[id] ?? "Unknown user" : "—");
  const hidden = <input type="hidden" name="instructionId" value={inst.id} />;
  const date = (d: Date | null) => (d ? toDateOnlyString(d) : "");
  const inReview = reports.find((r) => r.status === "IN_REVIEW") ?? null;
  const approved = reports.find((r) => r.status === "APPROVED") ?? null;
  const wsFor = (m: Method) => worksheets.find((w) => w.method === m) ?? null;
  const inputsOf = (m: Method) => (wsFor(m)?.inputs ?? {}) as unknown as Record<string, string>;
  const kindLabel = (k: string) => (k === "PREMISE" ? "Premise" : k === "SPECIAL_ASSUMPTION" ? "Special assumption" : humanize(k));
  const draft = openReport && openReport.status !== "IN_REVIEW" ? openReport : null;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/valuations">All valuations</Link> · <Link href={`/app/assets/${inst.asset.id}`}>{inst.asset.ref} · {inst.asset.name}</Link></p>
        <div className="row between">
          <div>
            <p className="eyebrow mono">{inst.ref}</p>
            <h1>{inst.clientName}</h1>
            <p className="muted">{humanize(inst.purpose)} · {humanize(inst.basis)} · {humanize(inst.premise)}{inst.valuationDate ? ` · as at ${formatDate(inst.valuationDate)}` : ""}</p>
          </div>
          <Pill status={inst.status} label={humanize(inst.status)} />
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {approved && approved.concludedValueKobo ? (
        <section className="card" aria-labelledby="val-h">
          <h2 id="val-h">Approved value</h2>
          <strong className="num" style={{ fontSize: 28 }}>{formatKobo(approved.concludedValueKobo)}</strong>
          <p className="small muted">Version {approved.version}, approved by {who(approved.decidedById)} on {approved.decidedAt ? formatDate(approved.decidedAt) : ""}. Prepared by {who(approved.authorId)}.{inst.issuedOn ? ` Issued ${formatDate(inst.issuedOn)}.` : ""}</p>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="inst-h">
        <h2 id="inst-h">Instruction</h2>
        <div className="fields">
          <div><div className="small muted">Client reference</div>{inst.clientReference || "—"}</div>
          <div><div className="small muted">Instructed</div>{formatDate(inst.instructionDate)}</div>
          <div><div className="small muted">Inspected</div>{inst.inspectionDate ? formatDate(inst.inspectionDate) : "Not yet"}</div>
          <div><div className="small muted">Due</div>{inst.dueDate ? formatDate(inst.dueDate) : "—"}</div>
          <div><div className="small muted">Valuing professional</div>{inst.professionalName || "Not recorded"}</div>
          <div><div className="small muted">Body and registration</div>{inst.professionalBody || inst.registrationNo ? `${inst.professionalBody} ${inst.registrationNo}` : "Not recorded"}</div>
          <div><div className="small muted">Assigned to</div>{members.find((m) => m.id === inst.assignedToId)?.name ?? "Not assigned"}</div>
        </div>
        {inst.purposeNote ? <p className="small">{inst.purposeNote}</p> : null}
        <div><div className="small muted">Asset description</div><p>{inst.assetDescription || "Not yet described"}</p></div>
        {inst.scope ? <div><div className="small muted">Scope of work</div><p>{inst.scope}</p></div> : null}
        {prepare ? (
          <details>
            <summary>Edit the instruction</summary>
            <form action={updateInstructionAction} className="stack" style={{ marginTop: 12 }}>
              {hidden}
              <div className="fields">
                <Field label="Basis of value"><select name="basis" defaultValue={inst.basis}><EnumOptions values={BASES} /></select></Field>
                <Field label="Premise"><select name="premise" defaultValue={inst.premise}><EnumOptions values={PREMISES} /></select></Field>
                <Field label="Valuation date"><input name="valuationDate" type="date" defaultValue={date(inst.valuationDate)} /></Field>
                <Field label="Inspection date"><input name="inspectionDate" type="date" defaultValue={date(inst.inspectionDate)} /></Field>
                <Field label="Due date"><input name="dueDate" type="date" defaultValue={date(inst.dueDate)} /></Field>
                <Field label="Valuing professional"><input name="professionalName" defaultValue={inst.professionalName} /></Field>
                <Field label="Professional body"><input name="professionalBody" defaultValue={inst.professionalBody} /></Field>
                <Field label="Registration number"><input name="registrationNo" defaultValue={inst.registrationNo} /></Field>
              </div>
              <Field label="Purpose notes"><input name="purposeNote" defaultValue={inst.purposeNote} /></Field>
              <Field label="Asset description"><textarea name="assetDescription" rows={3} defaultValue={inst.assetDescription} /></Field>
              <Field label="Scope of work"><textarea name="scope" rows={2} defaultValue={inst.scope} /></Field>
              <button className="btn" type="submit">Save</button>
            </form>
          </details>
        ) : null}
        {manage && editable ? (
          <div className="stack">
            <form action={assignAction} className="row" style={{ alignItems: "flex-end" }}>
              {hidden}
              <Field label="Assign to"><select name="assignedToId" defaultValue={inst.assignedToId ?? ""}><option value="">Not assigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              <button className="btn" type="submit">Assign</button>
            </form>
            <details>
              <summary>Cancel this instruction</summary>
              <form action={cancelAction} className="stack" style={{ marginTop: 12 }}>
                {hidden}
                <Field label="Reason"><input name="reason" required /></Field>
                <button className="btn" type="submit">Cancel instruction</button>
              </form>
            </details>
          </div>
        ) : null}
      </section>

      {!editable ? <div className="flash notice" role="status">The evidence for this valuation is locked{inst.status === "IN_REVIEW" ? " while it is with the approver" : ""}. {inst.status === "IN_PROGRESS" ? "" : "A revision starts a new version."}</div> : null}

      <section className="card stack" aria-labelledby="ent-h">
        <h2 id="ent-h">Premise, assumptions and limitations</h2>
        <p className="small muted">{inst.premise === "STANDARD" ? "State every assumption and limitation the value depends on." : `This is a ${humanize(inst.premise).toLowerCase()} valuation. Record the premise it rests on.`}</p>
        {entries.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
          <ul className="timeline">
            {entries.map((e) => (
              <li key={e.id}><div className="row between" style={{ width: "100%" }}>
                <div><Pill status="OPEN" label={kindLabel(e.kind)} /> {e.text}<div className="small muted">{who(e.createdById)}</div></div>
                {prepare ? <form action={removeEntryAction}>{hidden}<input type="hidden" name="entryId" value={e.id} /><button className="btn" type="submit">Remove</button></form> : null}
              </div></li>
            ))}
          </ul>
        )}
        {prepare ? (
          <form action={addEntryAction} className="stack">
            {hidden}
            <Field label="Type"><select name="kind" defaultValue={inst.premise === "STANDARD" ? "ASSUMPTION" : "PREMISE"}>{ENTRY_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></Field>
            <Field label="Statement"><textarea name="text" rows={2} required /></Field>
            <button className="btn" type="submit">Add</button>
          </form>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="cmp-h">
        <h2 id="cmp-h">Comparable evidence</h2>
        {comparables.length === 0 ? <p className="muted">No comparables yet.</p> : (
          <ul className="timeline">
            {comparables.map((c) => (
              <li key={c.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{c.address}</strong><div className="small muted">{humanize(c.kind)} · {formatDate(c.evidenceDate)} · {c.source}</div></div>
                  {c.verifiedAt ? <Pill status="DONE" label="Checked" /> : <Pill status="PENDING" label="Not checked" />}
                </div>
                <div className="small">
                  {formatKobo(c.priceKobo)} for {formatArea(c.areaSqm100)} · adjustment {formatPercent(c.adjustmentBps)} · weight {formatPercent(c.weightBps)} · adjusted {formatKobo(adjustedPerSqm({ priceKobo: c.priceKobo, areaSqm100: c.areaSqm100, adjustmentBps: c.adjustmentBps, weightBps: c.weightBps }))} per m²
                </div>
                {c.adjustmentNote ? <div className="small muted">Adjustment: {c.adjustmentNote}</div> : null}
                {c.verifiedAt ? <div className="small muted">Checked by {who(c.verifiedById)} on {formatDate(c.verifiedAt)}</div> : null}
                {prepare ? (
                  <div className="row">
                    {!c.verifiedAt ? <form action={verifyComparableAction}>{hidden}<input type="hidden" name="comparableId" value={c.id} /><button className="btn" type="submit">Mark as checked</button></form> : null}
                    <form action={removeComparableAction}>{hidden}<input type="hidden" name="comparableId" value={c.id} /><button className="btn" type="submit">Remove</button></form>
                  </div>
                ) : null}
              </div></li>
            ))}
          </ul>
        )}
        {prepare ? (
          <details>
            <summary>Add a comparable</summary>
            <form action={addComparableAction} className="stack" style={{ marginTop: 12 }}>
              {hidden}
              <div className="fields">
                <Field label="Type"><select name="kind" defaultValue="SALE"><EnumOptions values={EVIDENCE_KINDS} /></select></Field>
                <Field label="Address or description"><input name="address" required /></Field>
                <Field label="Date of the evidence"><input name="evidenceDate" type="date" required /></Field>
                <Field label="Price or annual rent (₦)"><input name="price" inputMode="decimal" required /></Field>
                <Field label="Area (m²)"><input name="area" inputMode="decimal" required /></Field>
                <Field label="Adjustment (%)" hint="Positive if the comparable is inferior to the subject."><input name="adjustment" inputMode="decimal" defaultValue="0" /></Field>
                <Field label="Weight (%)"><input name="weight" inputMode="decimal" defaultValue="100" /></Field>
                <Field label="Source" hint="Where the evidence came from, so it can be checked."><input name="source" required /></Field>
              </div>
              <Field label="Reason for the adjustment"><input name="adjustmentNote" /></Field>
              <button className="btn" type="submit">Add comparable</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="ws-h">
        <h2 id="ws-h">Valuation worksheets</h2>
        <p className="small muted">Each method records its inputs and works out an indicated value. The professional decides how to weigh them in the report.</p>
        {METHODS.map((m) => {
          const ws = wsFor(m);
          const inp = inputsOf(m);
          const lines = (ws?.lines ?? []) as unknown as { label: string; value: string }[];
          const warns = (ws?.warnings ?? []) as unknown as string[];
          return (
            <div key={m} className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div className="row between">
                <h3>{METHOD_LABEL[m]}</h3>
                {ws ? (ws.resultKobo !== null ? <strong className="num">{formatKobo(ws.resultKobo)}</strong> : <Pill status="PENDING" label="No result yet" />) : <span className="small muted">Not started</span>}
              </div>
              {ws && lines.length ? <ul className="small">{lines.map((l) => <li key={l.label}>{l.label}: <span className="mono">{l.value}</span></li>)}</ul> : null}
              {warns.map((w) => <p key={w} className="small" style={{ color: "var(--warn, inherit)" }}>Note: {w}</p>)}
              {ws?.note ? <p className="small muted">{ws.note}</p> : null}
              {prepare ? (
                <details>
                  <summary>{ws ? "Change the inputs" : "Start this worksheet"}</summary>
                  <form action={worksheetAction} className="stack" style={{ marginTop: 12 }}>
                    {hidden}<input type="hidden" name="method" value={m} />
                    <div className="fields">
                      {m === "SALES_COMPARISON" ? (
                        <Field label="Subject area (m²)" hint="The result uses the comparables above."><input name="subjectArea" inputMode="decimal" required defaultValue={areaInput(inp.subjectAreaSqm100)} /></Field>
                      ) : null}
                      {m === "INCOME_CAPITALISATION" ? (<>
                        <Field label="Gross annual rent (₦)"><input name="grossRent" inputMode="decimal" required defaultValue={nairaInput(inp.grossRentKobo)} /></Field>
                        <Field label="Vacancy allowance (%)"><input name="vacancy" inputMode="decimal" required defaultValue={pctInput(inp.vacancyBps)} /></Field>
                        <Field label="Operating costs per year (₦)"><input name="operatingCosts" inputMode="decimal" required defaultValue={nairaInput(inp.operatingCostsKobo)} /></Field>
                        <Field label="Capitalisation rate (%)"><input name="capRate" inputMode="decimal" required defaultValue={pctInput(inp.capRateBps)} /></Field>
                      </>) : null}
                      {m === "COST_APPROACH" ? (<>
                        <Field label="Land value (₦)"><input name="landValue" inputMode="decimal" required defaultValue={nairaInput(inp.landValueKobo)} /></Field>
                        <Field label="Replacement cost per m² (₦)"><input name="costPerSqm" inputMode="decimal" required defaultValue={nairaInput(inp.costPerSqmKobo)} /></Field>
                        <Field label="Building area (m²)"><input name="buildingArea" inputMode="decimal" required defaultValue={areaInput(inp.buildingAreaSqm100)} /></Field>
                        <Field label="Depreciation (%)"><input name="depreciation" inputMode="decimal" required defaultValue={pctInput(inp.depreciationBps)} /></Field>
                      </>) : null}
                    </div>
                    <Field label="Notes on this method"><input name="note" defaultValue={ws?.note ?? ""} /></Field>
                    <button className="btn" type="submit">Calculate and save</button>
                  </form>
                  {ws ? <form action={removeWorksheetAction} style={{ marginTop: 8 }}>{hidden}<input type="hidden" name="method" value={m} /><button className="btn" type="submit">Remove this worksheet</button></form> : null}
                </details>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="card stack" aria-labelledby="doc-h">
        <h2 id="doc-h">Supporting documents</h2>
        {documents.length === 0 ? <p className="muted">No documents attached.</p> : (
          <ul className="timeline">
            {documents.map((d) => <li key={d.id}><a href={`/app/valuation-docs/${d.id}`}>{d.title}</a><span className="small muted"> · {d.fileName} · {formatDate(d.createdAt)}</span></li>)}
          </ul>
        )}
        {prepare ? (
          <form action={addDocumentAction} className="stack">
            {hidden}
            <Field label="Title"><input name="title" required /></Field>
            <Field label="File" hint="PDF, JPG, PNG, WEBP or Word. Up to 4 MB."><input name="file" type="file" required /></Field>
            <button className="btn" type="submit">Attach</button>
          </form>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="rep-h">
        <h2 id="rep-h">Report</h2>
        {draft && editable ? (
          <>
            {readiness.blockers.length > 0 ? (
              <div><div className="small muted">Before this can go for approval</div><ul>{readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
            ) : <p className="small">Everything needed for approval is recorded.</p>}
            {readiness.warnings.length > 0 ? <ul className="small">{readiness.warnings.map((w) => <li key={w}>Note: {w}</li>)}</ul> : null}
            {draft.status === "REJECTED" ? <div className="flash error" role="alert">Returned by {who(draft.decidedById)}: {draft.decisionNote}</div> : null}
          </>
        ) : null}
        {prepare ? (
          <form action={saveDraftAction} className="stack">
            {hidden}
            <Field label="Summary"><textarea name="summary" rows={3} defaultValue={draft?.summary ?? ""} /></Field>
            <Field label="Conclusion"><textarea name="conclusion" rows={3} defaultValue={draft?.conclusion ?? ""} /></Field>
            <div className="fields">
              <Field label="Concluded value (₦)" hint="The professional's opinion, after weighing the worksheets."><input name="concludedValue" inputMode="decimal" defaultValue={draft?.concludedValueKobo ? nairaInput(draft.concludedValueKobo.toString()) : ""} /></Field>
            </div>
            <Field label="Reconciliation" hint="Required if the concluded value is more than 10% from the worksheets' average."><textarea name="reconciliationNote" rows={2} defaultValue={draft?.reconciliationNote ?? ""} /></Field>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" name="aiAssisted" defaultChecked={draft?.aiAssisted ?? false} /> An AI assistant helped draft this text</label>
            <Field label="What the AI assistant was used for" hint="The approver must review all of it personally before approving."><input name="aiNote" defaultValue={draft?.aiNote ?? ""} /></Field>
            <button className="btn" type="submit">Save draft</button>
          </form>
        ) : null}
        {prepare && draft?.status === "DRAFT" ? (
          <form action={submitReportAction}>{hidden}<button className="btn primary" type="submit" disabled={readiness.blockers.length > 0}>Send for approval</button></form>
        ) : null}

        {inReview ? (
          <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <h3>Waiting for approval (version {inReview.version})</h3>
            <p className="small muted">Prepared by {who(inReview.authorId)}{inReview.submittedAt ? ` on ${formatDateTime(inReview.submittedAt)}` : ""}.</p>
            {inReview.aiAssisted ? <div className="flash notice" role="status">An AI assistant helped with this report: {inReview.aiNote}. It is a draft aid only. Your approval confirms you reviewed it yourself.</div> : null}
            <p><strong>Concluded value:</strong> {inReview.concludedValueKobo ? formatKobo(inReview.concludedValueKobo) : "—"}</p>
            <p>{inReview.summary}</p>
            <p>{inReview.conclusion}</p>
            {inReview.reconciliationNote ? <p className="small muted">Reconciliation: {inReview.reconciliationNote}</p> : null}
            {approve ? (
              inReview.authorId === member.userId ? <p className="small muted">You prepared this report, so someone else must approve it.</p> : (
                <form action={decideReportAction} className="stack">
                  {hidden}
                  <Field label="Decision note" hint="Required if you send it back."><input name="note" /></Field>
                  {inReview.aiAssisted ? <label className="row" style={{ gap: 8 }}><input type="checkbox" name="confirmReviewed" /> I have reviewed every part of this report myself</label> : null}
                  <div className="row">
                    <button className="btn primary" type="submit" name="decision" value="approve">Approve</button>
                    <button className="btn" type="submit" name="decision" value="reject">Send back</button>
                  </div>
                </form>
              )
            ) : null}
          </div>
        ) : null}

        {manage && inst.status === "APPROVED" ? (
          <form action={issueAction} className="row" style={{ alignItems: "flex-end" }}>
            {hidden}
            <Field label="Issued to the client on"><input name="issuedOn" type="date" /></Field>
            <button className="btn primary" type="submit">Record as issued</button>
          </form>
        ) : null}
        {manage && (inst.status === "APPROVED" || inst.status === "ISSUED") ? (
          <details>
            <summary>Revise the report</summary>
            <form action={reviseReportAction} className="stack" style={{ marginTop: 12 }}>
              {hidden}
              <Field label="Reason for the revision"><input name="reason" required /></Field>
              <button className="btn" type="submit">Start a new version</button>
            </form>
          </details>
        ) : null}

        {reports.length > 0 ? (
          <div>
            <h3>Versions</h3>
            <ul className="timeline">
              {reports.map((r) => (
                <li key={r.id}><div className="row between" style={{ width: "100%" }}>
                  <div>Version {r.version}{r.concludedValueKobo ? ` · ${formatKobo(r.concludedValueKobo)}` : ""}<div className="small muted">By {who(r.authorId)}{r.decidedById ? ` · decided by ${who(r.decidedById)}` : ""}{r.aiAssisted ? " · AI-assisted" : ""}</div></div>
                  <Pill status={r.status === "SUPERSEDED" ? "CANCELLED" : r.status === "IN_REVIEW" ? "PENDING" : r.status} label={humanize(r.status)} />
                </div></li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
