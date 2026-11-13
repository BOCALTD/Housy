import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { caseForCustomer } from "@/lib/services/verification-cases";
import { myComplaints } from "@/lib/services/verification-quality";
import { COMPLAINT_CATEGORIES, COMPLAINT_WORDS, type ComplaintStatus } from "@/lib/verification-quality-rules";
import { CaseStatusPill, CaseTimeline, day, kb, naira, outcomeName, serviceName } from "../../case-ui";
import { acknowledgeAction, answerInfoAction, cancelCaseAction, complaintAction, customerDocAction, disputeAction, rateAction, withdrawComplaintAction } from "../../actions";

export const metadata = { title: "Verification request", robots: { index: false } };
export const dynamic = "force-dynamic";

const CAN_ADD_DOCS = ["REQUESTED", "PENDING_PAYMENT", "READY_FOR_ASSIGNMENT", "ASSIGNED", "ACCEPTED", "DOCUMENT_REVIEW", "INFORMATION_REQUIRED"];
const CAN_CANCEL = ["REQUESTED", "PENDING_PAYMENT", "READY_FOR_ASSIGNMENT", "INFORMATION_REQUIRED"];

export default async function CustomerCase({ params: p, searchParams: s }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await p;
  const searchParams = await s;
  const user = await requireUser();
  const c = await caseForCustomer(user.id, decodeURIComponent(ref));
  if (!c) notFound();
  const complaints = await myComplaints(user.id, c.ref);
  const providerWorked = !!c.provider && !["REQUESTED", "PENDING_PAYMENT", "READY_FOR_ASSIGNMENT", "ASSIGNED"].includes(c.status);
  const current = c.report?.versions.find((v) => !v.supersededAt && !v.revokedAt);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return (
    <div className="wrap stack-lg vp" style={{ maxWidth: 900 }}>
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/verification/cases">My verification requests</Link>
        <h1>{c.propertyAddress}</h1>
        <div className="row" style={{ flexWrap: "wrap" }}><CaseStatusPill status={c.status} /><span className="small muted">{c.ref} · sent {day(c.createdAt)}</span></div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {c.status === "PENDING_PAYMENT" && c.invoiceId ? (
        <section className="card stack vp-ask">
          <h2>Pay to start: {naira(c.priceKobo)}</h2>
          <p className="small muted">Once it is paid, Housy offers your case to a qualified provider. The price covers every check listed below.</p>
          <div className="row"><Link className="btn primary" href={`/me/billing/${c.invoiceId}`}>See the invoice and pay</Link></div>
        </section>
      ) : null}

      {c.status === "INFORMATION_REQUIRED" ? (
        <form action={answerInfoAction} className="card stack vp-ask">
          {hidden("ref", c.ref)}
          <h2>The provider needs more information</h2>
          <p>{c.infoRequest}</p>
          <Field label="Your answer" hint="Add any documents below as well"><textarea name="answer" required minLength={5} maxLength={3000} rows={4} /></Field>
          <div className="row"><button className="btn primary" type="submit">Send the answer</button></div>
        </form>
      ) : null}

      {c.report && current ? (
        <section className="card stack vp-invite">
          <h2>Your report</h2>
          <p><strong>{outcomeName(current.outcome)}</strong> · version {current.version}, delivered {day(current.releasedAt)}{c.provider ? <> · by {c.provider.name}</> : null}</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <a className="btn primary" href={`/verification/report/${c.report.publicRef}/${current.version}`} target="_blank" rel="noopener">Download the report (PDF)</a>
            <Link className="btn" href={`/verification/check/${c.report.publicRef}`}>Check it is genuine</Link>
          </div>
          <p className="small muted">Report reference {c.report.publicRef}. Anyone you share the report with can check it at Housy with this reference. The report is the provider&apos;s professional opinion within the scope it states; Housy&apos;s review is a quality check, not a guarantee of title.</p>
          {c.status === "DELIVERED" ? (
            <div className="grid-2">
              <form action={acknowledgeAction} className="stack">{hidden("ref", c.ref)}<button className="btn" type="submit" data-confirm="Confirm you have the report?" data-confirm-body="The case is then complete. You can still raise a concern with Housy's support." data-confirm-ok="Confirm" data-confirm-tone="default">I have the report</button></form>
              <details className="vp-fold"><summary>Dispute the report</summary>
                <form action={disputeAction} className="stack">{hidden("ref", c.ref)}
                  <Field label="What do you dispute, and why?"><textarea name="reason" required minLength={20} maxLength={3000} rows={4} /></Field>
                  <button className="btn" type="submit" data-confirm="Send this dispute to Housy?" data-confirm-ok="Send dispute">Send the dispute</button>
                </form>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
      {c.report?.versions.some((v) => v.supersededAt || v.revokedAt) ? (
        <details className="card vp-fold"><summary>Earlier versions</summary>
          <ul className="vp-list">{c.report.versions.filter((v) => v.supersededAt || v.revokedAt).map((v) => (
            <li key={v.version}><span>Version {v.version} · {v.revokedAt ? `revoked: ${v.revokedReason}` : "superseded by a corrected version"}</span>
              <a className="btn small" href={`/verification/report/${c.report!.publicRef}/${v.version}`} target="_blank" rel="noopener">Open</a></li>
          ))}</ul>
        </details>
      ) : null}

      <section className="card stack">
        <h2>The request</h2>
        <dl className="vp-dl">
          <dt>State</dt><dd>{c.state}{c.area ? `, ${c.area}` : ""}</dd>
          <dt>Property type</dt><dd>{c.propertyType.toLowerCase().replace(/_/g, " ")}</dd>
          <dt>Checks</dt><dd><ul className="plain">{c.services.map((x) => <li key={x}>{serviceName(x)}</li>)}</ul></dd>
          {c.listingRef ? <><dt>Listing</dt><dd><Link href={`/properties/${c.listingRef}`}>{c.listingRef}</Link></dd></> : null}
          {c.priceKobo !== null ? <><dt>Price</dt><dd>{naira(c.priceKobo)}{c.invoiceId ? <> · <Link href={`/me/billing/${c.invoiceId}`}>invoice</Link></> : null}</dd></> : null}
          <dt>Provider</dt><dd>{c.provider ? c.provider.name : "Not yet chosen"}</dd>
          {c.requiredBy ? <><dt>Expected by</dt><dd>{day(c.requiredBy)}</dd></> : null}
          {c.closingNote && ["REJECTED", "CANCELLED", "COMPLETED"].includes(c.status) ? <><dt>Note</dt><dd>{c.closingNote}</dd></> : null}
        </dl>
      </section>

      <section className="card stack">
        <h2>Your documents ({c.files.length})</h2>
        {c.files.length ? <ul className="vp-docs">{c.files.map((f) => (
          <li key={f.id}><span><strong>{f.title}</strong><span className="small muted">{f.fileName} · {kb(f.sizeBytes)} · {day(f.createdAt)}</span></span><a className="btn small" href={`/verification/file/${f.id}`} target="_blank" rel="noopener">Open</a></li>
        ))}</ul> : <p className="muted small">None yet. Copies of the title documents, survey plan and the seller&apos;s identification help the provider most.</p>}
        {CAN_ADD_DOCS.includes(c.status) ? (
          <form action={customerDocAction} className="stack" encType="multipart/form-data">
            {hidden("ref", c.ref)}
            <div className="grid-2">
              <Field label="What it is" hint="For example: Certificate of Occupancy"><input name="title" maxLength={160} /></Field>
              <Field label="File" hint="PDF, JPG, PNG, WEBP or Word, up to 4 MB"><input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp,.docx" /></Field>
            </div>
            <div className="row"><button className="btn" type="submit" data-confirm="Add this document to the request?" data-confirm-body="The provider handling the case will see it. Documents cannot be removed once the investigation starts." data-confirm-ok="Add document" data-confirm-tone="default">Add document</button></div>
          </form>
        ) : null}
      </section>

      {["DELIVERED", "COMPLETED"].includes(c.status) && c.customerRating === null ? (
        <section className="card stack">
          <h2>How was the report?</h2>
          <form action={rateAction} className="stack">{hidden("ref", c.ref)}
            <fieldset className="vp-rating"><legend className="small">Your rating</legend>
              {[1, 2, 3, 4, 5].map((n) => <label key={n} className="check"><input type="radio" name="rating" value={n} required /> {n} {n === 1 ? "star" : "stars"}</label>)}
            </fieldset>
            <Field label="Comment" hint="Optional; the provider sees it"><textarea name="feedback" maxLength={1000} rows={2} /></Field>
            <div className="row"><button className="btn" type="submit">Send rating</button></div>
          </form>
        </section>
      ) : c.customerRating !== null ? <p className="small muted">You rated this report {c.customerRating} out of 5.</p> : null}

      {complaints.length ? (
        <section className="card stack">
          <h2>Your complaints</h2>
          <ul className="vp-list">{complaints.map((k) => (
            <li key={k.ref} className="stack" style={{ alignItems: "stretch" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}><strong>{k.ref} · {COMPLAINT_CATEGORIES.find((x) => x[0] === k.category)?.[1]}</strong><span className="pill">{COMPLAINT_WORDS[k.status as ComplaintStatus]}</span></div>
              <p className="small">{k.description}</p>
              {k.providerResponse ? <p className="small"><strong>The provider&apos;s account:</strong> {k.providerResponse}</p> : null}
              {k.resolution ? <p className="small"><strong>Housy&apos;s decision:</strong> {k.resolution}</p> : null}
              {["OPEN", "INVESTIGATING"].includes(k.status) ? (
                <form action={withdrawComplaintAction}>{hidden("ref", c.ref)}{hidden("complaint", k.ref)}<button className="btn small" type="submit" data-confirm="Withdraw this complaint?" data-confirm-ok="Withdraw">Withdraw</button></form>
              ) : null}
            </li>
          ))}</ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2>Progress</h2>
        <CaseTimeline items={c.activities} />
      </section>

      {providerWorked && !complaints.some((k) => ["OPEN", "INVESTIGATING"].includes(k.status)) ? (
        <details className="card vp-fold"><summary>Complain about the provider</summary>
          <form action={complaintAction} className="stack">{hidden("ref", c.ref)}
            <p className="small muted">For how the provider behaved or worked. To challenge what the report says, use &quot;Dispute the report&quot; instead. The provider sees your complaint and gives its account; Housy decides.</p>
            <Field label="What is it about?"><select name="category" required defaultValue=""><option value="" disabled>Choose…</option>{COMPLAINT_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="What happened?"><textarea name="description" required minLength={20} maxLength={4000} rows={4} /></Field>
            <button className="btn" type="submit" data-confirm="Send this complaint?" data-confirm-body="The provider will see it." data-confirm-ok="Send complaint" data-confirm-tone="default">Send complaint</button>
          </form>
        </details>
      ) : null}

      {CAN_CANCEL.includes(c.status) ? (
        <details className="card vp-fold"><summary>Cancel this request</summary>
          <form action={cancelCaseAction} className="stack">{hidden("ref", c.ref)}
            <Field label="Reason" hint="Optional"><textarea name="reason" maxLength={1000} rows={2} /></Field>
            <button className="btn danger" type="submit" data-confirm="Cancel this verification request?" data-confirm-body="This cannot be undone. You can send a new request later." data-confirm-ok="Cancel request">Cancel the request</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
