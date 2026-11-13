import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { caseForProvider, providerCaseContext } from "@/lib/services/verification-cases";
import { FINDING_BASES, OUTCOMES, nextCaseStatuses, reportGaps, CASE_STATUS_WORDS, type CaseStatus, type ReportContent } from "@/lib/verification-case-rules";
import { VP_ROLE_LABELS, vpCan } from "@/lib/verification-network-rules";
import { CaseStatusPill, CaseTimeline, day, kb, naira, outcomeName, serviceName, when } from "@/app/verification/case-ui";
import { OrgHeader } from "../../[code]/shared";
import {
  answerOfferAction, assignStaffAction, completeInspectionAction, evidenceAction, moveCaseAction, reviewAction, saveReportAction, scheduleInspectionAction,
} from "../../case-actions";

export const metadata = { title: "Verification case", robots: { index: false } };
export const dynamic = "force-dynamic";

const WORK_MOVES = ["DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT"];
const EVIDENCE_OPEN = ["DOCUMENT_REVIEW", "INFORMATION_REQUIRED", "FIELD_INSPECTION", "INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "CORRECTION_REQUIRED"];
const REPORT_OPEN = ["INVESTIGATION_IN_PROGRESS", "REPORT_DRAFT", "CORRECTION_REQUIRED"];
const SECTIONS: [keyof ReportContent, string, string][] = [
  ["scope", "Scope of the investigation", "What was asked, what was covered and what was not"],
  ["documentsExamined", "Documents examined", "Each document, its date and where the copy came from"],
  ["sourcesConsulted", "Sources consulted", "Offices, registries, people spoken to"],
  ["registrySearch", "Registry search", "Where and when searched, and what the register showed"],
  ["siteInspection", "Site inspection", "Date, who attended and what was observed"],
  ["risks", "Risks and inconsistencies", "Anything that does not match or could harm the customer"],
  ["limitations", "Limitations", "What could not be checked, and why"],
  ["outstanding", "Outstanding issues", "What is still open"],
  ["observations", "Professional observations", ""],
  ["recommendations", "Recommendations", "Next steps; conditions if the outcome is conditional"],
  ["conclusion", "Conclusion", ""],
];

export default async function ProviderCase({ params: p, searchParams: s }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await p;
  const searchParams = await s;
  const user = await requireUser();
  const ctx = await providerCaseContext(user.id, decodeURIComponent(ref));
  if (!ctx) notFound();
  const c = await caseForProvider(ctx, decodeURIComponent(ref));
  if (!c) notFound();
  const status = c.status as CaseStatus;
  const hidden = <input type="hidden" name="ref" value={c.ref} />;
  const canWork = ctx.active && vpCan(ctx.role, "case.work") && (ctx.role !== "INVESTIGATOR" || c.officerId === user.id);
  const draft = c.report?.versions.find((v) => !v.providerApprovedAt);
  const latest = c.report?.versions[0];
  const content = ((draft ?? latest)?.content ?? {}) as Partial<ReportContent>;
  const gaps = draft ? reportGaps(draft.content as Partial<ReportContent>) : [];
  const moves = nextCaseStatuses(status, { kind: "provider", role: ctx.role }).filter((m) => WORK_MOVES.includes(m));
  const findings = [...(content.findings ?? []), ...Array.from({ length: 3 }, () => ({ basis: "", text: "" }))].slice(0, 40);
  const workers = c.staff.filter((m) => vpCan(m.role, "case.work"));
  const reviewers = c.staff.filter((m) => vpCan(m.role, "case.review"));
  const name = (id: string | null) => c.staff.find((m) => m.userId === id)?.name ?? "—";
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title={c.ref} />
      <div className="row" style={{ flexWrap: "wrap" }}><Link className="small" href={`/provider/${ctx.code}/cases`}>All cases</Link><CaseStatusPill status={c.status} />{c.priority === "URGENT" ? <span className="pill warn">Urgent</span> : null}{c.requiredBy ? <span className="small muted">Due {day(c.requiredBy)}</span> : null}</div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {status === "ASSIGNED" && vpCan(ctx.role, "case.accept") ? (
        <section className="card stack vp-ask">
          <h2>Housy offers you this case</h2>
          <p>Answer by <strong>{when(c.acceptBy)}</strong>. If you do not, it is offered to another provider.</p>
          {c.priceKobo !== null ? <p>Your share: <strong>{naira(c.priceKobo - (c.feeKobo ?? 0n))}</strong> <span className="small muted">(the customer pays {naira(c.priceKobo)}; Housy&apos;s fee is {naira(c.feeKobo)}). Paid to you after delivery, once the customer confirms or the waiting time passes.</span></p> : <p className="small muted">This case is paid for outside Housy&apos;s invoicing; Housy will agree your fee with you directly.</p>}
          <form action={answerOfferAction} className="stack">{hidden}
            <Field label="Reason" hint="Required to decline; Housy sees it"><textarea name="reason" maxLength={1500} rows={2} /></Field>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn primary" name="decision" value="accept" type="submit" data-confirm="Accept this case?" data-confirm-body="Your organisation takes responsibility for the investigation and the report, by the date shown." data-confirm-ok="Accept" data-confirm-tone="default">Accept</button>
              <button className="btn" name="decision" value="decline" type="submit" data-confirm="Decline this case?" data-confirm-ok="Decline">Decline</button>
              <button className="btn" name="decision" value="conflict" type="submit" data-confirm="Declare a conflict of interest?" data-confirm-body="You decline the case and it is recorded that your organisation must never be offered it. Say what the conflict is in the reason." data-confirm-ok="Declare conflict">Conflict of interest</button>
            </div>
          </form>
        </section>
      ) : null}

      {status === "INTERNAL_REVIEW" && draft && vpCan(ctx.role, "case.review") && draft.preparedById !== user.id && (c.reviewerId === user.id || ["OWNER", "ADMIN"].includes(ctx.role)) ? (
        <section className="card stack vp-ask">
          <h2>Review version {draft.version}</h2>
          <p className="small muted">Prepared by {name(draft.preparedById)}. Approving signs it off for your organisation and sends it to Housy for its quality review. Read the full draft below or as a PDF first.</p>
          <div className="row"><a className="btn" href={`/verification/report/${c.report!.publicRef}/${draft.version}`} target="_blank" rel="noopener">Open the draft (PDF)</a></div>
          <form action={reviewAction} className="stack">{hidden}
            <Field label="Review note" hint="Required when sending back"><textarea name="note" maxLength={3000} rows={3} /></Field>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn primary" name="decision" value="approve" type="submit" data-confirm="Approve this report?" data-confirm-body="It goes to Housy with your name as reviewer. It can no longer be edited; corrections become a new version." data-confirm-ok="Approve" data-confirm-tone="default">Approve and submit to Housy</button>
              <button className="btn" name="decision" value="correct" type="submit">Send back for correction</button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card stack">
          <h2>The property</h2>
          <dl className="vp-dl">
            <dt>Address</dt><dd>{c.propertyAddress}</dd>
            <dt>State</dt><dd>{c.state}{c.area ? `, ${c.area}` : ""}</dd>
            <dt>Type</dt><dd>{c.propertyType.toLowerCase().replace(/_/g, " ")}</dd>
            <dt>Checks</dt><dd><ul className="plain">{c.services.map((x) => <li key={x}>{serviceName(x)}</li>)}</ul></dd>
            {c.listingRef ? <><dt>Listing</dt><dd><Link href={`/properties/${c.listingRef}`}>{c.listingRef}</Link></dd></> : null}
            {status !== "ASSIGNED" ? <><dt>Customer</dt><dd>{c.requesterName}</dd></> : null}
            {c.documentsAvailable ? <><dt>Documents held</dt><dd>{c.documentsAvailable}</dd></> : null}
            {status !== "ASSIGNED" && c.ownerDetails ? <><dt>Owner or seller</dt><dd>{c.ownerDetails}</dd></> : null}
            {c.transactionContext ? <><dt>Transaction</dt><dd>{c.transactionContext}</dd></> : null}
            {c.notes ? <><dt>Notes</dt><dd>{c.notes}</dd></> : null}
            {c.infoRequest ? <><dt>Asked of the customer</dt><dd>{c.infoRequest}</dd></> : null}
          </dl>
        </section>
        <section className="card stack">
          <h2>Who is on it</h2>
          <dl className="vp-dl"><dt>Officer</dt><dd>{name(c.officerId)}</dd><dt>Reviewer</dt><dd>{name(c.reviewerId)}</dd></dl>
          {status !== "ASSIGNED" && vpCan(ctx.role, "case.assign") && ctx.active ? (
            <form action={assignStaffAction} className="stack">{hidden}
              <div className="grid-2">
                <Field label="Officer" hint="Does the work"><select name="officerId" defaultValue={c.officerId ?? ""}><option value="">Not chosen</option>{workers.map((m) => <option key={m.userId} value={m.userId}>{m.name} ({VP_ROLE_LABELS[m.role]})</option>)}</select></Field>
                <Field label="Reviewer" hint="Approves the report: someone else"><select name="reviewerId" defaultValue={c.reviewerId ?? ""}><option value="">Not chosen</option>{reviewers.map((m) => <option key={m.userId} value={m.userId}>{m.name} ({VP_ROLE_LABELS[m.role]})</option>)}</select></Field>
              </div>
              <div className="row"><button className="btn" type="submit">Save</button></div>
            </form>
          ) : null}
        </section>
      </div>

      {moves.length && (canWork || (status === "ACCEPTED" && vpCan(ctx.role, "case.assign"))) ? (
        <section className="card stack">
          <h2>Move the case on</h2>
          <form action={moveCaseAction} className="stack">{hidden}
            <Field label="Next step"><select name="to" required defaultValue={moves[0]}>{moves.map((m) => <option key={m} value={m}>{CASE_STATUS_WORDS[m]}</option>)}</select></Field>
            <Field label="Note" hint="When asking the customer for information, say exactly what you need: they see it"><textarea name="note" maxLength={3000} rows={2} /></Field>
            <div className="row"><button className="btn primary" type="submit">Update the case</button></div>
          </form>
        </section>
      ) : null}

      <section className="card stack">
        <h2>Site inspections ({c.inspections.length})</h2>
        {c.inspections.length ? <ul className="vp-list">{c.inspections.map((i) => (
          <li key={i.id}><span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{when(i.scheduledFor)} · {name(i.officerId)}</strong><span className="small muted">{i.completedAt ? `Done ${day(i.completedAt)}: ` : "Booked. "}{i.notes}</span></span>
            {!i.completedAt && canWork ? (
              <details className="vp-fold"><summary>Record the visit</summary>
                <form action={completeInspectionAction} className="stack">{hidden}<input type="hidden" name="inspectionId" value={i.id} />
                  <Field label="What was found on site"><textarea name="notes" required minLength={5} maxLength={3000} rows={3} /></Field>
                  <button className="btn" type="submit">Save</button>
                </form>
              </details>
            ) : null}
          </li>
        ))}</ul> : <p className="muted small">None booked.</p>}
        {canWork && EVIDENCE_OPEN.includes(status) ? (
          <details className="vp-fold"><summary>Book a site visit</summary>
            <form action={scheduleInspectionAction} className="stack">{hidden}
              <div className="grid-2">
                <Field label="Date and time"><input type="datetime-local" name="when" required /></Field>
                <Field label="Officer"><select name="officerId" defaultValue={c.officerId ?? ""}><option value="">The case officer</option>{workers.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></Field>
              </div>
              <Field label="Notes" hint="Access arrangements, who will attend"><textarea name="notes" maxLength={2000} rows={2} /></Field>
              <button className="btn" type="submit">Book</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Documents and evidence ({c.files.length})</h2>
        {c.files.length ? <ul className="vp-docs">{c.files.map((f) => (
          <li key={f.id}><span><strong>{f.title}</strong><span className="small muted">{f.uploaderKind === "customer" ? "From the customer" : `${FINDING_BASES.find((b) => b[0] === f.basis)?.[1] ?? "Evidence"} · added by ${name(f.uploadedById)}`} · {f.fileName} · {kb(f.sizeBytes)}{f.lat !== null ? ` · ${f.lat.toFixed(5)}, ${f.lng?.toFixed(5)}` : ""}{f.takenAt ? ` · taken ${day(f.takenAt)}` : ""}</span>{f.caption ? <span className="small">{f.caption}</span> : null}</span>
            <a className="btn small" href={`/verification/file/${f.id}`} target="_blank" rel="noopener">Open</a></li>
        ))}</ul> : <p className="muted small">None yet.</p>}
        {canWork && EVIDENCE_OPEN.includes(status) ? (
          <details className="vp-fold"><summary>Add evidence</summary>
            <form action={evidenceAction} className="stack" encType="multipart/form-data">{hidden}
              <div className="grid-3">
                <Field label="Kind"><select name="kind" defaultValue="EVIDENCE"><option value="EVIDENCE">Document or record</option><option value="PHOTO">Site photograph</option><option value="REGISTRY_RESULT">Registry search result</option><option value="OTHER">Other</option></select></Field>
                <Field label="Supports a finding of"><select name="basis" required defaultValue=""><option value="" disabled>Choose…</option>{FINDING_BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Title"><input name="title" required minLength={2} maxLength={160} /></Field>
              </div>
              <Field label="Caption" hint="What it shows"><input name="caption" maxLength={1000} /></Field>
              <div className="grid-3">
                <Field label="Latitude" hint="For site photos"><input name="lat" inputMode="decimal" /></Field>
                <Field label="Longitude"><input name="lng" inputMode="decimal" /></Field>
                <Field label="Taken on"><input type="datetime-local" name="takenAt" /></Field>
              </div>
              <Field label="File" hint="PDF, JPG, PNG, WEBP or Word, up to 4 MB"><input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp,.docx" /></Field>
              <div className="row"><button className="btn" type="submit" data-confirm="Add this to the case file?" data-confirm-body="Evidence is kept with the case record and is seen by Housy." data-confirm-ok="Add evidence" data-confirm-tone="default">Add evidence</button></div>
            </form>
          </details>
        ) : null}
      </section>

      {canWork && REPORT_OPEN.includes(status) ? (
        <form action={saveReportAction} className="card stack vp-form" id="report">{hidden}
          <h2>Report{draft ? ` · version ${draft.version} (draft)` : latest ? ` · new version after ${latest.version}` : ""}</h2>
          <p className="small muted">This is your organisation&apos;s professional report. Label every finding with what it rests on: a document examined or a registry search shows what the record says, not proof of ownership.</p>
          {latest?.reviewNote && !latest.providerApprovedAt ? <div className="flash warn"><strong>Reviewer:</strong> {latest.reviewNote}</div> : null}
          {status === "CORRECTION_REQUIRED" && c.closingNote ? <div className="flash warn"><strong>Housy:</strong> {c.closingNote}</div> : null}
          <Field label="Outcome"><select name="outcome" defaultValue={content.outcome ?? ""}><option value="">Choose…</option>{OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {SECTIONS.slice(0, 5).map(([k, l, h]) => <Field key={k} label={l} hint={h || undefined}><textarea name={k} maxLength={3000} rows={3} defaultValue={(content[k] as string) ?? ""} /></Field>)}
          <fieldset className="vp-fs stack"><legend>Findings</legend>
            {findings.map((f, i) => (
              <div key={i} className="grid-2" style={{ gridTemplateColumns: "minmax(0, 14em) minmax(0, 1fr)" }}>
                <Field label={`Finding ${i + 1}: rests on`}><select name={`f.${i}.basis`} defaultValue={f.basis || "DOCUMENTARY"}>{FINDING_BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Finding"><textarea name={`f.${i}.text`} maxLength={2000} rows={2} defaultValue={f.text} /></Field>
              </div>
            ))}
            <p className="small muted">Save to get more empty rows.</p>
          </fieldset>
          {SECTIONS.slice(5).map(([k, l, h]) => <Field key={k} label={l} hint={h || undefined}><textarea name={k} maxLength={3000} rows={3} defaultValue={(content[k] as string) ?? ""} /></Field>)}
          {gaps.length ? <div className="flash warn"><strong>Before it can go for review:</strong> {gaps.join(". ")}.</div> : null}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn" type="submit" name="then" value="save">Save draft</button>
            {status !== "INVESTIGATION_IN_PROGRESS" ? <button className="btn primary" type="submit" name="then" value="submit" data-confirm="Send the report for internal review?" data-confirm-body={`It goes to ${name(c.reviewerId)} to approve. It cannot be changed while it is being reviewed.`} data-confirm-ok="Send for review" data-confirm-tone="default">Save and send for review</button> : <span className="small muted">Move the case to &quot;Report being written&quot; to send it for review.</span>}
          </div>
        </form>
      ) : latest ? (
        <section className="card stack">
          <h2>Report</h2>
          <ul className="vp-list">{c.report!.versions.map((v) => (
            <li key={v.id}><span className="stack" style={{ gap: 2 }}><strong>Version {v.version} · {outcomeName(v.outcome)}</strong>
              <span className="small muted">{v.revokedAt ? "Revoked" : v.supersededAt ? "Superseded" : v.releasedAt ? `Released ${day(v.releasedAt)}` : v.platformApprovedAt ? "Approved by Housy" : v.providerApprovedAt ? `Approved by ${name(v.reviewedById)}, with Housy` : "Draft"}</span></span>
              <a className="btn small" href={`/verification/report/${c.report!.publicRef}/${v.version}`} target="_blank" rel="noopener">PDF</a></li>
          ))}</ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2>History</h2>
        <CaseTimeline items={c.activities} staff />
      </section>
    </div>
  );
}
