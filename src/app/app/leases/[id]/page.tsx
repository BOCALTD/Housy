import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getLease, PAYMENT_METHODS } from "@/lib/services/leases";
import { formatKobo } from "@/lib/money";
import { chargeState, outstandingOf } from "@/lib/rent";
import { ADJUSTMENT_KINDS, depositTotals, receiptStatus, type DepositKind } from "@/lib/ledger-rules";
import { formatDate, formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import {
  approveAdjustmentAction, depositReceivedAction, reconcileReceiptAction, recordLeasePaymentAction,
  rejectAdjustmentAction, requestAdjustmentAction, reverseReceiptAction, settleDepositAction,
  approveRenewalAction, closeLeaseAction, proposeRenewalAction, recordHandoverAction, recordNoticeAction, rejectRenewalAction,
} from "../actions";
import { noticeAdequacy } from "@/lib/ledger-rules";

export const metadata = { title: "Lease" };

function koboToInput(k: bigint) {
  const whole = k / 100n;
  const frac = k % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

export default async function LeasePage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("finance.view");
  const result = await getLease(member, params.id);
  if (!result) notFound();
  const { lease, history, names } = result;
  const today = todayInLagos();
  const todayText = toDateOnlyString(today);
  const who = (id: string | null | undefined) => (id ? names[id] ?? "Unknown user" : "—");

  let billed = 0n, adjusted = 0n, paid = 0n, outstanding = 0n, overdue = 0n;
  for (const c of lease.charges) {
    billed += c.amountKobo;
    adjusted += c.adjustedKobo;
    paid += c.paidKobo;
    outstanding += outstandingOf(c);
    if (chargeState(c, today, lease.graceDays) === "OVERDUE") overdue += outstandingOf(c);
  }
  const deposit = depositTotals(lease.depositEntries.map((e) => ({ kind: e.kind as DepositKind, amountKobo: e.amountKobo })));
  const tenancyEnded = lease.status !== "ACTIVE" || lease.endDate <= today;
  const adjustments = lease.charges
    .flatMap((c) => c.adjustments.map((a) => ({ ...a, dueDate: c.dueDate })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const openCharges = lease.charges.filter((c) => outstandingOf(c) > 0n);
  const hidden = <input type="hidden" name="leaseId" value={lease.id} />;
  const input = { border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" } as const;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <p className="small"><Link href={`/app/assets/${lease.asset.id}`}>{lease.asset.ref} · {lease.asset.name}</Link></p>
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <p className="eyebrow mono">{lease.ref}</p>
            <h1>{lease.occupantName}</h1>
            <p className="muted">
              {lease.unit ? `${lease.unit} · ` : ""}{formatDate(lease.startDate)} to {formatDate(lease.endDate)} · {formatKobo(lease.rentKobo)}{" "}
              {lease.frequency === "CUSTOM" ? `every ${lease.intervalMonths} months` : humanize(lease.frequency).toLowerCase()}
            </p>
          </div>
          <div className="row">
            <Pill status={lease.status} />
            {lease.status === "ACTIVE" && lease.endDate <= today ? <Pill status="OVERDUE" label="Term ended" /> : null}
          </div>
        </div>
        {lease.renewedFrom ? <p className="small muted">Renewal of <Link href={`/app/leases/${lease.renewedFrom.id}`}>{lease.renewedFrom.ref}</Link></p> : null}
        {lease.renewedTo ? <p className="small muted">Renewed as <Link href={`/app/leases/${lease.renewedTo.id}`}>{lease.renewedTo.ref}</Link></p> : null}
        {lease.closedOn ? <p className="small muted">Closed on {formatDate(lease.closedOn)}{lease.closeReason ? `: ${lease.closeReason}` : ""}</p> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Lease balance">
        <div className="stat"><b>{formatKobo(billed + adjusted)}</b><span>Billed{adjusted !== 0n ? ` (incl. ${formatKobo(adjusted)} adjustments)` : ""}</span></div>
        <div className="stat"><b>{formatKobo(paid)}</b><span>Paid</span></div>
        <div className="stat"><b>{formatKobo(outstanding)}</b><span>Outstanding</span></div>
        <div className={`stat${overdue > 0n ? " alert" : ""}`}><b>{formatKobo(overdue)}</b><span>Overdue</span></div>
        <div className="stat"><b>{formatKobo(deposit.balance)}</b><span>Deposit held</span></div>
      </section>

      <div className="two">
        <div className="stack-lg">
          {/* Charges */}
          <section className="card" aria-labelledby="charges-h">
            <div className="section-head">
              <h2 id="charges-h">Rent schedule</h2>
              <span className="small muted">{lease.graceDays > 0 ? `${lease.graceDays} days' grace after each due date` : "No grace period"}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Due</th><th className="r">Amount</th><th className="r">Adjusted</th><th className="r">Paid</th><th className="r">Outstanding</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {lease.charges.map((c) => {
                    const state = chargeState(c, today, lease.graceDays);
                    return (
                      <tr key={c.id}>
                        <td>{formatDate(c.dueDate)}</td>
                        <td className="r">{formatKobo(c.amountKobo)}</td>
                        <td className="r">{c.adjustedKobo === 0n ? "—" : formatKobo(c.adjustedKobo)}</td>
                        <td className="r">{formatKobo(c.paidKobo)}</td>
                        <td className="r">{formatKobo(outstandingOf(c))}</td>
                        <td><Pill status={state} /></td>
                        <td>
                          {can(member.role, "adjustment.request") ? (
                            <details className="inline">
                              <summary className="small">Adjust</summary>
                              <form action={requestAdjustmentAction} className="stack" style={{ minWidth: 240 }}>
                                {hidden}
                                <input type="hidden" name="chargeId" value={c.id} />
                                <Field label="Type">
                                  <select name="kind" defaultValue="LATE_FEE">
                                    {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
                                  </select>
                                </Field>
                                <Field label="Direction" hint="Only for corrections. Late fees add; waivers and credit notes reduce.">
                                  <select name="direction" defaultValue=""><option value="">Not needed</option><option value="INCREASE">Increase</option><option value="DECREASE">Decrease</option></select>
                                </Field>
                                <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" /></Field>
                                <Field label="Reason" hint="For a late fee, cite the lease clause that allows it."><input name="reason" required /></Field>
                                <button className="btn small" type="submit">Request adjustment</button>
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
          </section>

          {/* Receipts */}
          <section className="card" aria-labelledby="receipts-h">
            <div className="section-head">
              <h2 id="receipts-h">Receipts</h2>
              <span className="small muted">A receipt records money received. It is not proof of payment until reconciled to the bank.</span>
            </div>
            {lease.receipts.length === 0 ? <p className="muted">No payments recorded yet.</p> : (
              <div className="stack">
                {lease.receipts.map((r) => {
                  const status = receiptStatus({ reversed: !!r.reversal, reconciled: !!r.reconciliation });
                  return (
                    <div key={r.id} className="stack" style={{ gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                      <div className="row between">
                        <div>
                          <Link href={`/app/receipts/${r.id}`} className="mono">{r.no}</Link>{" "}
                          <strong>{formatKobo(r.amountKobo)}</strong>
                          <div className="small muted">
                            Paid {formatDate(r.paidOn)}{r.method ? ` · ${r.method}` : ""}{r.payerName ? ` · from ${r.payerName}` : ""} · ref {r.evidence} · recorded by {who(r.recordedById)}
                          </div>
                        </div>
                        <Pill status={status} />
                      </div>
                      {r.reconciliation ? (
                        <p className="small muted">Reconciled by {who(r.reconciliation.reconciledById)} against {r.reconciliation.statementRef}.</p>
                      ) : null}
                      {r.reversal ? (
                        <p className="small muted">Reversed by {who(r.reversal.reversedById)}: {r.reversal.reason}</p>
                      ) : null}
                      {status === "RECORDED" && (can(member.role, "payment.reconcile") || can(member.role, "payment.reverse")) ? (
                        <div className="row">
                          {can(member.role, "payment.reconcile") && r.recordedById !== member.userId ? (
                            <details className="inline">
                              <summary className="small">Reconcile</summary>
                              <form action={reconcileReceiptAction} className="stack" style={{ minWidth: 260 }}>
                                {hidden}
                                <input type="hidden" name="receiptId" value={r.id} />
                                <Field label="Bank statement date and line, or transaction reference"><input name="statementRef" required /></Field>
                                <Field label="Note"><input name="note" /></Field>
                                <button className="btn small primary" type="submit">Confirm against statement</button>
                              </form>
                            </details>
                          ) : null}
                          {can(member.role, "payment.reverse") ? (
                            <details className="inline">
                              <summary className="small">Reverse</summary>
                              <form action={reverseReceiptAction} className="stack" style={{ minWidth: 260 }}>
                                {hidden}
                                <input type="hidden" name="receiptId" value={r.id} />
                                <Field label="Reason" hint="The receipt stays on file, marked reversed."><input name="reason" required /></Field>
                                <button className="btn small danger" type="submit">Reverse receipt</button>
                              </form>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Adjustments */}
          <section className="card" aria-labelledby="adj-h">
            <div className="section-head">
              <h2 id="adj-h">Adjustments</h2>
              <span className="small muted">Late fees, waivers, credit notes and corrections take effect only once approved by a second person.</span>
            </div>
            {adjustments.length === 0 ? <p className="muted">No adjustments requested.</p> : (
              <div className="stack">
                {adjustments.map((a) => (
                  <div key={a.id} className="stack" style={{ gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
                    <div className="row between">
                      <div>
                        <strong>{humanize(a.kind)}</strong> {a.amountKobo > 0n ? "+" : "−"}{formatKobo(a.amountKobo < 0n ? -a.amountKobo : a.amountKobo)}
                        <span className="small muted"> on the charge due {formatDate(a.dueDate)}</span>
                        <div className="small muted">
                          Requested by {who(a.requestedById)} · {a.reason}
                          {a.status !== "PENDING" ? ` · ${humanize(a.status).toLowerCase()} by ${who(a.decidedById)}${a.decisionNote ? `: ${a.decisionNote}` : ""}` : ""}
                        </div>
                      </div>
                      <Pill status={a.status} />
                    </div>
                    {a.status === "PENDING" && can(member.role, "adjustment.approve") ? (
                      a.requestedById === member.userId ? (
                        <p className="small muted">You requested this, so someone else must approve it. You can still reject it to withdraw it.</p>
                      ) : null
                    ) : null}
                    {a.status === "PENDING" && can(member.role, "adjustment.approve") ? (
                      <form action={approveAdjustmentAction} className="row">
                        {hidden}
                        <input type="hidden" name="adjustmentId" value={a.id} />
                        <input name="note" placeholder="Note (required to reject)" aria-label="Decision note" style={{ flex: "1 1 220px", ...input }} />
                        <button className="btn small" formAction={rejectAdjustmentAction} type="submit">Reject</button>
                        {a.requestedById !== member.userId ? <button className="btn small primary" type="submit">Approve</button> : null}
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="stack-lg">
          {/* Record payment */}
          {can(member.role, "payment.record") ? (
            <section className="card" aria-labelledby="pay-h">
              <h2 id="pay-h">Record a payment</h2>
              {openCharges.length === 0 ? <p className="muted">Nothing is outstanding on this lease.</p> : (
                <form action={recordLeasePaymentAction} className="stack">
                  {hidden}
                  <Field label="Apply to" hint="By default the payment clears the oldest charges first.">
                    <select name="chargeId" defaultValue="">
                      <option value="">Oldest charges first</option>
                      {openCharges.map((c) => <option key={c.id} value={c.id}>Charge due {formatDate(c.dueDate)} ({formatKobo(outstandingOf(c))} outstanding)</option>)}
                    </select>
                  </Field>
                  <div className="fields">
                    <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" defaultValue={koboToInput(outstandingOf(openCharges[0]))} /></Field>
                    <Field label="Paid on"><input name="paidOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                  </div>
                  <div className="fields">
                    <Field label="Method"><select name="method" defaultValue="Bank transfer">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
                    <Field label="Paid by"><input name="payerName" defaultValue={lease.occupantName} /></Field>
                  </div>
                  <Field label="Evidence reference" hint="Bank reference or receipt number. Each reference can be recorded once.">
                    <input name="evidence" required />
                  </Field>
                  <button className="btn primary" type="submit">Issue receipt</button>
                </form>
              )}
            </section>
          ) : null}

          {/* Deposit */}
          <section className="card" aria-labelledby="dep-h">
            <h2 id="dep-h">Security deposit</h2>
            <p className="small muted" style={{ marginBottom: 10 }}>
              Agreed {formatKobo(lease.depositKobo)} · received {formatKobo(deposit.received)} · deducted {formatKobo(deposit.deducted)} · refunded {formatKobo(deposit.refunded)}
            </p>
            {lease.depositEntries.length === 0 ? <p className="muted small">No deposit movements recorded.</p> : (
              <ul className="timeline">
                {lease.depositEntries.map((e) => (
                  <li key={e.id}>
                    <div>
                      <div>{humanize(e.kind)} <strong>{formatKobo(e.amountKobo)}</strong></div>
                      <div className="small muted">{formatDate(e.entryDate)} · {who(e.recordedById)}{e.reason ? ` · ${e.reason}` : ""}{e.evidence ? ` · ref ${e.evidence}` : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can(member.role, "deposit.manage") && lease.depositKobo > deposit.received ? (
              <details className="inline" style={{ marginTop: 12 }}>
                <summary>Record deposit received</summary>
                <form action={depositReceivedAction} className="stack">
                  {hidden}
                  <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" defaultValue={koboToInput(lease.depositKobo - deposit.received)} /></Field>
                  <Field label="Received on"><input name="receivedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                  <Field label="Evidence reference"><input name="evidence" required /></Field>
                  <button className="btn primary" type="submit">Save</button>
                </form>
              </details>
            ) : null}
            {can(member.role, "deposit.settle") && deposit.balance > 0n ? (
              tenancyEnded ? (
                <details className="inline" style={{ marginTop: 12 }}>
                  <summary>Settle the deposit</summary>
                  <form action={settleDepositAction} className="stack">
                    {hidden}
                    <Field label="Type">
                      <select name="kind" defaultValue="REFUND"><option value="DEDUCTION">Deduction (repairs, arrears)</option><option value="REFUND">Refund to tenant</option></select>
                    </Field>
                    <Field label="Amount (₦)" hint={`Up to ${formatKobo(deposit.balance)} held.`}><input name="amount" required inputMode="decimal" defaultValue={koboToInput(deposit.balance)} /></Field>
                    <Field label="Reason"><input name="reason" required /></Field>
                    <Field label="Payment reference" hint="Required for a refund."><input name="evidence" /></Field>
                    <button className="btn primary" type="submit">Record settlement</button>
                  </form>
                </details>
              ) : <p className="small muted" style={{ marginTop: 12 }}>The deposit can be settled once the tenancy has ended.</p>
            ) : null}
          </section>

          {/* Lifecycle */}
          <section className="card" aria-labelledby="life-h">
            <h2 id="life-h">Renewal, notice and handover</h2>
            <div className="stack">
              <div>
                <h3 className="small muted">Renewal</h3>
                {lease.renewals.length === 0 ? <p className="muted small">No renewal proposed.</p> : (
                  <ul className="timeline">
                    {lease.renewals.map((r) => (
                      <li key={r.id}>
                        <div>
                          <div>{formatDate(r.proposedStart)} to {formatDate(r.proposedEnd)} at <strong>{formatKobo(r.proposedRentKobo)}</strong> <Pill status={r.status} /></div>
                          <div className="small muted">Proposed by {who(r.requestedById)}{r.decidedById ? ` · decided by ${who(r.decidedById)}` : ""}{r.note ? ` · ${r.note}` : ""}</div>
                          {r.status === "PENDING" ? (
                            <div className="row" style={{ marginTop: 6 }}>
                              {can(member.role, "renewal.approve") && r.requestedById !== member.userId ? (
                                <form action={approveRenewalAction} className="row">{hidden}<input type="hidden" name="renewalId" value={r.id} /><input type="hidden" name="note" value="" /><button className="btn primary" type="submit">Approve renewal</button></form>
                              ) : null}
                              {can(member.role, "lease.manage") ? (
                                <form action={rejectRenewalAction} className="row">{hidden}<input type="hidden" name="renewalId" value={r.id} /><input type="hidden" name="note" value="" /><button className="btn" type="submit">{r.requestedById === member.userId ? "Withdraw" : "Reject"}</button></form>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {can(member.role, "lease.manage") && lease.status === "ACTIVE" && !lease.renewedTo && !lease.renewals.some((r) => r.status === "PENDING") ? (
                  <details className="inline" style={{ marginTop: 8 }}>
                    <summary>Propose a renewal</summary>
                    <form action={proposeRenewalAction} className="stack">
                      {hidden}
                      <div className="fields">
                        <Field label="Starts" hint="On or after the current end date."><input name="startDate" type="date" required defaultValue={toDateOnlyString(lease.endDate)} min={toDateOnlyString(lease.endDate)} /></Field>
                        <Field label="Ends"><input name="endDate" type="date" required /></Field>
                      </div>
                      <Field label="Rent per period (₦)"><input name="rent" required inputMode="decimal" defaultValue={koboToInput(lease.rentKobo)} /></Field>
                      <Field label="Note"><input name="note" /></Field>
                      <p className="small muted">The new lease keeps the tenant, unit, frequency and terms. The deposit stays on this lease until it is settled.</p>
                      <button className="btn primary" type="submit">Propose renewal</button>
                    </form>
                  </details>
                ) : null}
              </div>

              <div>
                <h3 className="small muted">Notices</h3>
                {lease.notices.length === 0 ? <p className="muted small">No notices recorded.</p> : (
                  <ul className="timeline">
                    {lease.notices.map((n) => {
                      const adq = noticeAdequacy(n.givenOn, n.effectiveOn, lease.noticeDays);
                      return (
                        <li key={n.id}>
                          <div>
                            <div>{humanize(n.givenBy)} notice given {formatDate(n.givenOn)}, effective {formatDate(n.effectiveOn)} {adq.short ? <Pill status="OVERDUE" label="Short notice" /> : null}</div>
                            <div className="small muted">{adq.days} days of notice (lease requires {adq.requiredDays}) · {n.reason} · {who(n.recordedById)}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {can(member.role, "lease.manage") && lease.status === "ACTIVE" ? (
                  <details className="inline" style={{ marginTop: 8 }}>
                    <summary>Record a notice</summary>
                    <form action={recordNoticeAction} className="stack">
                      {hidden}
                      <Field label="Given by"><select name="givenBy" defaultValue="TENANT"><option value="TENANT">Tenant</option><option value="LANDLORD">Landlord</option></select></Field>
                      <div className="fields">
                        <Field label="Given on"><input name="givenOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                        <Field label="Takes effect on"><input name="effectiveOn" type="date" required /></Field>
                      </div>
                      <Field label="Type or reason"><input name="reason" required placeholder="For example: notice to vacate" /></Field>
                      <button className="btn primary" type="submit">Save notice</button>
                    </form>
                  </details>
                ) : null}
              </div>

              <div>
                <h3 className="small muted">Handover</h3>
                {(["MOVE_IN", "MOVE_OUT"] as const).map((kind) => {
                  const h = lease.handovers.find((x) => x.kind === kind);
                  return (
                    <div key={kind} style={{ marginBottom: 10 }}>
                      {h ? (
                        <div>
                          <strong>{humanize(kind)}</strong> on {formatDate(h.handoverOn)} · {h.keysCount} key{h.keysCount === 1 ? "" : "s"} · acknowledged by {h.acknowledgedBy}
                          <div className="small muted">{h.conditionNotes}{h.meterReadings ? ` · Meters: ${h.meterReadings}` : ""}{h.issues ? ` · Issues: ${h.issues}` : ""} · recorded by {who(h.recordedById)}</div>
                        </div>
                      ) : can(member.role, "handover.record") ? (
                        <details className="inline">
                          <summary>Record {humanize(kind).toLowerCase()} handover</summary>
                          <form action={recordHandoverAction} className="stack">
                            {hidden}
                            <input type="hidden" name="kind" value={kind} />
                            <div className="fields">
                              <Field label="Handover date"><input name="handoverOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                              <Field label="Keys handed over"><input name="keysCount" required inputMode="numeric" defaultValue="1" /></Field>
                            </div>
                            <Field label="Meter readings" hint="Electricity, water, gas."><input name="meterReadings" /></Field>
                            <Field label="Condition of the premises"><textarea name="conditionNotes" required rows={3} /></Field>
                            <Field label="Issues to follow up"><input name="issues" /></Field>
                            <Field label="Acknowledged by" hint="Name of the tenant or representative who signed."><input name="acknowledgedBy" required /></Field>
                            <p className="small muted">A handover record cannot be edited once saved.</p>
                            <button className="btn primary" type="submit">Save handover</button>
                          </form>
                        </details>
                      ) : <p className="small muted">{humanize(kind)} handover not recorded.</p>}
                    </div>
                  );
                })}
              </div>

              {can(member.role, "lease.close") && lease.status === "ACTIVE" ? (
                <details className="inline">
                  <summary>Close this lease</summary>
                  <form action={closeLeaseAction} className="stack">
                    {hidden}
                    <Field label="Outcome">
                      <select name="outcome" defaultValue={lease.endDate <= today ? "ENDED" : "TERMINATED"}>
                        <option value="ENDED">Ended (term completed)</option>
                        <option value="TERMINATED">Terminated early</option>
                      </select>
                    </Field>
                    <Field label="Closing date"><input name="closedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                    <Field label="Reason" hint="Required for early termination."><input name="reason" /></Field>
                    <p className="small muted">Needs the move-out handover. Rent not yet due and untouched by payments is removed; arrears stay on the lease for collection.</p>
                    <button className="btn danger" type="submit">Close lease</button>
                  </form>
                </details>
              ) : null}
            </div>
          </section>

          {/* Terms */}
          <section className="card" aria-labelledby="terms-h">
            <h2 id="terms-h">Terms</h2>
            <dl className="stack" style={{ gap: 8, margin: 0 }}>
              <div><dt className="small muted">Contact</dt><dd style={{ margin: 0 }}>{lease.occupantContact || "—"}</dd></div>
              <div><dt className="small muted">Unit</dt><dd style={{ margin: 0 }}>{lease.unit || "Whole property"}</dd></div>
              <div><dt className="small muted">Grace period</dt><dd style={{ margin: 0 }}>{lease.graceDays} days</dd></div>
              <div><dt className="small muted">Notice period</dt><dd style={{ margin: 0 }}>{lease.noticeDays} days</dd></div>
              <div><dt className="small muted">Permitted use</dt><dd style={{ margin: 0 }}>{lease.permittedUse || "—"}</dd></div>
              <div><dt className="small muted">Other terms</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{lease.otherTerms || "—"}</dd></div>
            </dl>
          </section>

          {/* History */}
          <section className="card" aria-labelledby="hist-h">
            <h2 id="hist-h">History</h2>
            {history.length === 0 ? <p className="muted small">No activity yet.</p> : (
              <ul className="timeline">
                {history.map((h) => (
                  <li key={h.id}>
                    <div>
                      <div className="small">{humanize(h.action.replace(".", " "))}</div>
                      <div className="small muted">{h.actorId ? who(h.actorId) : "System"} · {formatDateTime(h.createdAt)}</div>
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
