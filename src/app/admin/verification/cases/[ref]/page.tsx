import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { caseForAdmin } from "@/lib/services/verification-cases";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { CaseStatusPill, CaseTimeline, day, kb, naira, outcomeName, serviceName, when } from "@/app/verification/case-ui";
import { FINDING_BASES, isHardReason, type ReportContent } from "@/lib/verification-case-rules";
import { EARNING_WORDS, PLATFORM_FEE_BPS, type EarningStatus } from "@/lib/verification-finance-rules";
import {
  quoteAction, assignAction, cancelCaseAdminAction, disputeDecisionAction, intakeAction, platformDecisionAction, releaseAction, revokeAction, startPlatformReviewAction, withdrawOfferAction,
} from "../../case-actions";

export const metadata = { title: "Verification case" };
export const dynamic = "force-dynamic";

const FINAL = ["COMPLETED", "REJECTED", "CANCELLED"];

export default async function AdminCase({ params: p, searchParams: s }: { params: Promise<{ ref: string }>; searchParams?: Promise<SP> }) {
  const { ref } = await p;
  const searchParams = await s;
  const admin = await requirePlatformAdmin();
  const c = await caseForAdmin(admin.id, decodeURIComponent(ref));
  if (!c) notFound();
  const hidden = <input type="hidden" name="ref" value={c.ref} />;
  const pending = c.report?.versions.find((v) => v.providerApprovedAt && !v.releasedAt);
  const released = c.report?.versions.find((v) => v.releasedAt && !v.supersededAt && !v.revokedAt);
  const content = (pending?.content ?? null) as Partial<ReportContent> | null;
  const recommended = c.ranked.find((r) => r.eligible);
  return (
    <div className="stack-lg vp">
      <div className="stack" style={{ gap: 6 }}>
        <Link className="small" href="/admin/verification/cases">Verification cases</Link>
        <h1>{c.ref}</h1>
        <div className="row" style={{ flexWrap: "wrap" }}><CaseStatusPill status={c.status} />{c.priority === "URGENT" ? <span className="pill warn">Urgent</span> : null}<span className="small muted">Sent {when(c.createdAt)} by {c.requester?.name} ({c.requester?.email})</span></div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      {c.status === "REQUESTED" ? (
        <section className="card stack vp-ask">
          <h2>Quote or decide</h2>
          <p className="small muted">Quote the customer: the price is fixed with Housy&apos;s {PLATFORM_FEE_BPS / 100}% fee and the provider&apos;s share, an invoice is raised, and the case moves on by itself when it is paid (online, or a bank transfer you confirm in Payments).</p>
          <form action={quoteAction} className="stack">{hidden}
            <div className="grid-2">
              <Field label="Price to the customer (₦)" hint="For all the checks requested"><input name="price" required inputMode="decimal" placeholder="150,000" /></Field>
              <Field label="Note for the customer" hint="Optional: what the price covers"><input name="note" maxLength={1000} /></Field>
            </div>
            <div className="row"><button className="btn primary" type="submit" data-confirm="Send this quote?" data-confirm-body="The customer gets an invoice for this amount. The price cannot be changed afterwards." data-confirm-ok="Send quote" data-confirm-tone="default">Quote and invoice</button></div>
          </form>
          <details className="vp-fold"><summary>Take it on without an invoice, or decline</summary>
            <form action={intakeAction} className="stack">{hidden}
              <Field label="Note" hint="Taking it on: how it is paid for (not shown to the customer). Declining: the reason (the customer sees it)."><textarea name="note" required minLength={10} maxLength={2000} rows={2} /></Field>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn" name="to" value="READY_FOR_ASSIGNMENT" type="submit" data-confirm="Take this on without an invoice?" data-confirm-body="No provider earning is recorded through Housy for a case paid for outside its invoicing." data-confirm-ok="Take it on" data-confirm-tone="default">Paid for outside Housy</button>
                <button className="btn" name="to" value="REJECTED" type="submit" data-confirm="Decline this request?" data-confirm-body="The customer is told, with your note. This cannot be undone." data-confirm-ok="Decline">Decline</button>
              </div>
            </form>
          </details>
        </section>
      ) : null}

      {c.status === "PENDING_PAYMENT" ? (
        <section className="card stack">
          <h2>Waiting for payment</h2>
          <p>{c.invoice ? <>Invoice {c.invoice.ref} for {naira(c.invoice.amountKobo)}, due {day(c.invoice.dueOn)}. Confirm a bank transfer in <Link href="/admin/payments">Payments</Link>; an online payment moves the case on by itself.</> : "No invoice."}</p>
          <details className="vp-fold"><summary>Paid for outside Housy instead</summary>
            <form action={intakeAction} className="stack">{hidden}
              <Field label="How it is paid for" hint="The invoice is withdrawn"><textarea name="note" required minLength={10} maxLength={2000} rows={2} /></Field>
              <button className="btn" name="to" value="READY_FOR_ASSIGNMENT" type="submit" data-confirm="Withdraw the invoice and take the case on?" data-confirm-ok="Take it on" data-confirm-tone="default">Take it on</button>
            </form>
          </details>
        </section>
      ) : null}

      {c.status === "READY_FOR_ASSIGNMENT" ? (
        <section className="card stack vp-ask">
          <h2>Offer the case to a provider</h2>
          <p className="small muted">Ranked from each provider&apos;s records: approval for these services and this state, what it offers, where it works, conflicts, open cases against capacity, and its track record (on time, declines). Providers that are not vetted, suspended, not approved for a service or the state, conflicted, or whose licence or certificate has expired can never be chosen. Choosing anyone else who is not eligible is an override: give the reason; it is recorded.</p>
          {c.preferred ? <p className="small">The customer asked for <strong>{c.preferred.name}</strong>.</p> : null}
          {c.ranked.length === 0 ? <p className="muted">No providers in the network yet.</p> : (
            <form action={assignAction} className="stack">{hidden}
              <ul className="vp-list" role="radiogroup" aria-label="Provider">
                {c.ranked.slice(0, 30).map((r) => (
                  <li key={r.providerId}>
                    <label className="check" style={{ alignItems: "flex-start", flex: "1 1 260px", minWidth: 0 }}>
                      <input type="radio" name="providerId" value={r.providerId} required defaultChecked={r.providerId === recommended?.providerId} />
                      <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                        <strong>{r.name}{r.providerId === recommended?.providerId ? <span className="pill ok" style={{ marginLeft: 8 }}>Recommended</span> : null}</strong>
                        <span className="small muted">{r.eligible ? `Score ${r.score} · ${r.openCases}/${r.monthlyCapacity} open · ${r.completed} done (${r.onTime} on time) · ${naira(r.priceKobo)} · about ${r.turnaroundDays} days` : r.reasons.join("; ")}</span>
                      </span>
                    </label>
                    <span className={`pill ${r.eligible ? "ok" : r.reasons.some(isHardReason) ? "bad" : "warn"}`}>{r.eligible ? "Eligible" : r.reasons.some(isHardReason) ? "Cannot take it" : "Override needed"}</span>
                  </li>
                ))}
              </ul>
              <div className="grid-3">
                <Field label="How it was chosen"><select name="method" defaultValue="MANUAL"><option value="MANUAL">Housy&apos;s choice</option><option value="RECOMMENDED">The recommended provider</option>{c.preferred ? <option value="CUSTOMER">The customer&apos;s choice</option> : null}</select></Field>
                <Field label="Required completion date" hint="Optional"><input type="date" name="requiredBy" /></Field>
                <Field label="Reason" hint="Required for an override"><input name="reason" maxLength={1500} /></Field>
              </div>
              <div className="row"><button className="btn primary" type="submit" data-confirm="Offer the case to this provider?" data-confirm-body="Its managers are told and have 48 hours to accept or decline. The customer's details are shared with it once it accepts." data-confirm-ok="Offer case" data-confirm-tone="default">Offer the case</button></div>
            </form>
          )}
        </section>
      ) : null}

      {c.status === "ASSIGNED" ? (
        <section className="card stack">
          <h2>Waiting for {c.provider?.name}</h2>
          <p>Offered; it must answer by {when(c.acceptBy)}. If it does not, the case comes back here to offer again.</p>
          <details className="vp-fold"><summary>Withdraw the offer</summary>
            <form action={withdrawOfferAction} className="stack">{hidden}
              <Field label="Reason"><input name="reason" required minLength={10} maxLength={1500} /></Field>
              <button className="btn" type="submit" data-confirm="Withdraw this offer?" data-confirm-ok="Withdraw">Withdraw</button>
            </form>
          </details>
        </section>
      ) : null}

      {pending && ["SUBMITTED_TO_HOUSY", "PLATFORM_REVIEW", "APPROVED_FOR_RELEASE"].includes(c.status) ? (
        <section className="card stack vp-ask">
          <h2>Report version {pending.version}{pending.correctionOf ? ` (corrects version ${pending.correctionOf})` : ""}</h2>
          <p className="small muted">Housy&apos;s review is a quality and compliance check, separate from the provider&apos;s professional opinion: scope stated, every finding says what it rests on, limitations given, the outcome matches the findings, and nothing presents a document check or a search as proof of ownership.</p>
          <p><strong>{outcomeName(content?.outcome ?? "")}</strong> · approved by the provider&apos;s reviewer {day(pending.providerApprovedAt)}</p>
          {content?.findings?.length ? <ol className="small">{content.findings.map((f, i) => <li key={i}><em>{FINDING_BASES.find((b) => b[0] === f.basis)?.[1]}:</em> {f.text}</li>)}</ol> : null}
          {content?.limitations ? <p className="small"><strong>Limitations:</strong> {content.limitations}</p> : null}
          {content?.conclusion ? <p className="small"><strong>Conclusion:</strong> {content.conclusion}</p> : null}
          <div className="row"><a className="btn" href={`/verification/report/${c.report!.publicRef}/${pending.version}`} target="_blank" rel="noopener">Open the full report (PDF)</a></div>
          {c.status === "SUBMITTED_TO_HOUSY" ? <form action={startPlatformReviewAction}>{hidden}<button className="btn primary" type="submit">Start Housy&apos;s review</button></form> : null}
          {c.status === "PLATFORM_REVIEW" ? (
            <form action={platformDecisionAction} className="stack">{hidden}
              <Field label="Review note" hint="Required when sending back: the provider sees it"><textarea name="note" maxLength={3000} rows={3} /></Field>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn primary" name="decision" value="approve" type="submit" data-confirm="Approve this report for release?" data-confirm-ok="Approve" data-confirm-tone="default">Approve for release</button>
                <button className="btn" name="decision" value="correct" type="submit">Send back for correction</button>
              </div>
            </form>
          ) : null}
          {c.status === "APPROVED_FOR_RELEASE" ? <form action={releaseAction}>{hidden}<button className="btn primary" type="submit" data-confirm="Release the report to the customer?" data-confirm-body="It is fingerprinted and can never be changed. Corrections become new versions." data-confirm-ok="Release" data-confirm-tone="default">Release to the customer</button></form> : null}
        </section>
      ) : null}

      {c.status === "PLATFORM_REVIEW" && !pending ? (
        <section className="card stack vp-ask">
          <h2>Reopened after a dispute</h2>
          <p className="small muted">The released report stays as it is. To correct it, send the case back to the provider: it writes a new version that records what it corrects, and the usual reviews follow.</p>
          <form action={platformDecisionAction} className="stack">{hidden}
            <Field label="What the provider must correct"><textarea name="note" required minLength={10} maxLength={3000} rows={3} /></Field>
            <div className="row"><button className="btn primary" name="decision" value="correct" type="submit">Send back for correction</button></div>
          </form>
        </section>
      ) : null}

      {c.status === "DISPUTED" ? (
        <section className="card stack vp-ask">
          <h2>The customer disputes the report</h2>
          <p>{c.activities.filter((a) => a.action === "disputed").at(-1)?.note}</p>
          <form action={disputeDecisionAction} className="stack">{hidden}
            <Field label="Decision" hint="The customer sees it"><textarea name="note" required minLength={10} maxLength={3000} rows={3} /></Field>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn primary" name="decision" value="reopen" type="submit">Reopen for review</button>
              <button className="btn" name="decision" value="close" type="submit" data-confirm="Close the dispute?" data-confirm-body="The report stands and the case is completed." data-confirm-ok="Close dispute">Close the dispute</button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card stack">
          <h2>The request</h2>
          <dl className="vp-dl">
            <dt>Property</dt><dd>{c.propertyAddress}</dd>
            <dt>State</dt><dd>{c.state}{c.area ? `, ${c.area}` : ""}</dd>
            <dt>Type</dt><dd>{c.propertyType.toLowerCase().replace(/_/g, " ")}</dd>
            <dt>Checks</dt><dd><ul className="plain">{c.services.map((x) => <li key={x}>{serviceName(x)}</li>)}</ul></dd>
            {c.listingRef ? <><dt>Listing</dt><dd><Link href={`/properties/${c.listingRef}`}>{c.listingRef}</Link></dd></> : null}
            {c.documentsAvailable ? <><dt>Documents held</dt><dd>{c.documentsAvailable}</dd></> : null}
            {c.ownerDetails ? <><dt>Owner or seller</dt><dd>{c.ownerDetails}</dd></> : null}
            {c.transactionContext ? <><dt>Transaction</dt><dd>{c.transactionContext}</dd></> : null}
            {c.notes ? <><dt>Notes</dt><dd>{c.notes}</dd></> : null}
            <dt>Provider</dt><dd>{c.provider ? <Link href={`/admin/verification/providers/${c.providerId}`}>{c.provider.name}</Link> : "—"}{c.selectionMethod ? <span className="small muted"> · {c.selectionMethod.toLowerCase()}</span> : null}</dd>
            {c.requiredBy ? <><dt>Due</dt><dd>{day(c.requiredBy)}</dd></> : null}
            {c.priceKobo !== null ? <><dt>Price</dt><dd>{naira(c.priceKobo)} · Housy&apos;s fee {naira(c.feeKobo)} · provider&apos;s share {naira(c.priceKobo - (c.feeKobo ?? 0n))}</dd></> : null}
            {c.invoice ? <><dt>Invoice</dt><dd>{c.invoice.ref} · {c.invoice.status.toLowerCase()}{c.invoice.paidAt ? ` ${day(c.invoice.paidAt)}` : ""}</dd></> : null}
            {c.earning ? <><dt>Provider&apos;s earning</dt><dd>{EARNING_WORDS[c.earning.status as EarningStatus]}{c.earning.heldReason ? `: ${c.earning.heldReason}` : ""}</dd></> : null}
          </dl>
        </section>
        <section className="card stack">
          <h2>Offers</h2>
          {c.assignments.length ? <ul className="vp-list">{c.assignments.map((a) => (
            <li key={a.id}><span className="stack" style={{ gap: 2, minWidth: 0 }}><strong>{a.providerName}</strong><span className="small muted">{a.method.toLowerCase()} by {a.by}, {when(a.createdAt)}{a.reason ? ` · ${a.reason}` : ""}{a.declineReason ? ` · declined: ${a.declineReason}` : ""}</span></span><span className="pill">{a.status.toLowerCase()}</span></li>
          ))}</ul> : <p className="muted small">Not offered yet.</p>}
        </section>
      </div>

      {released ? (
        <section className="card stack">
          <h2>Released report</h2>
          <p>Version {released.version} · {outcomeName(released.outcome)} · released {day(released.releasedAt)} · <Link href={`/verification/check/${c.report!.publicRef}`}>{c.report!.publicRef}</Link></p>
          <p className="small muted mono" style={{ overflowWrap: "anywhere" }}>Fingerprint {released.sha256}</p>
          <details className="vp-fold"><summary>Revoke this report</summary>
            <form action={revokeAction} className="stack">{hidden}
              <Field label="Reason" hint="Shown to anyone who checks the report"><textarea name="reason" required minLength={10} maxLength={1500} rows={2} /></Field>
              <button className="btn danger" type="submit" data-confirm="Revoke this report?" data-confirm-body="The public check will show it as withdrawn. This cannot be undone." data-confirm-ok="Revoke">Revoke</button>
            </form>
          </details>
        </section>
      ) : null}

      <section className="card stack">
        <h2>Documents and evidence ({c.files.length})</h2>
        {c.files.length ? <ul className="vp-docs">{c.files.map((f) => (
          <li key={f.id}><span><strong>{f.title}</strong><span className="small muted">{f.uploaderKind === "customer" ? "From the customer" : `Evidence (${FINDING_BASES.find((b) => b[0] === f.basis)?.[1] ?? f.basis})`} · {f.fileName} · {kb(f.sizeBytes)}{f.lat !== null ? ` · ${f.lat.toFixed(5)}, ${f.lng?.toFixed(5)}` : ""}{f.takenAt ? ` · taken ${day(f.takenAt)}` : ""}</span></span><a className="btn small" href={`/verification/file/${f.id}`} target="_blank" rel="noopener">Open</a></li>
        ))}</ul> : <p className="muted small">None.</p>}
      </section>

      <section className="card stack">
        <h2>History</h2>
        <CaseTimeline items={c.activities} staff />
      </section>

      {!FINAL.includes(c.status) && !["DELIVERED", "DISPUTED", "APPROVED_FOR_RELEASE", "SUBMITTED_TO_HOUSY"].includes(c.status) ? (
        <details className="card vp-fold"><summary>Cancel this case</summary>
          <form action={cancelCaseAdminAction} className="stack">{hidden}
            <Field label="Reason" hint="The customer and the provider see it"><textarea name="reason" required minLength={10} maxLength={2000} rows={2} /></Field>
            <button className="btn danger" type="submit" data-confirm="Cancel this case?" data-confirm-body="Everyone involved is told. This cannot be undone." data-confirm-ok="Cancel case">Cancel the case</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
