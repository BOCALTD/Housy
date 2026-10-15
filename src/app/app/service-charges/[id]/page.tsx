import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getServicePeriod } from "@/lib/services/service-charges";
import { PAYMENT_METHODS } from "@/lib/services/leases";
import { assessmentBalance } from "@/lib/ledger-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import {
  approveExpenseAction, assessPeriodAction, recordCollectionAction, rejectExpenseAction, requestExpenseAction, reverseCollectionAction,
} from "../actions";

export const metadata = { title: "Service charge period" };

function koboToInput(k: bigint) {
  const whole = k / 100n;
  const frac = k % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

export default async function ServicePeriodPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("finance.view");
  const data = await getServicePeriod(member, params.id);
  if (!data) notFound();
  const { period, asset, leases, activeLeases, names } = data;
  const todayText = toDateOnlyString(todayInLagos());
  const who = (id: string | null | undefined) => (id ? names[id] ?? "Unknown user" : "—");
  const hidden = <input type="hidden" name="periodId" value={period.id} />;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/service-charges">All service charges</Link> · <Link href={`/app/assets/${asset.id}`}>{asset.ref} · {asset.name}</Link></p>
        <div className="row between">
          <div>
            <h1>{period.name}</h1>
            <p className="muted">{formatDate(period.startDate)} to {formatDate(period.endDate)} · shared by {humanize(period.method).toLowerCase()}</p>
          </div>
          <Pill status={period.status === "OPEN" ? "OPEN" : "ACTIVE"} label={period.status === "OPEN" ? "Not yet shared" : "Shared"} />
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Service charge fund">
        <div className="stat"><b>{formatKobo(period.budgetKobo)}</b><span>Budget</span></div>
        <div className="stat"><b>{formatKobo(data.assessed)}</b><span>Shared between tenants</span></div>
        <div className="stat"><b>{formatKobo(data.collected)}</b><span>Collected</span></div>
        <div className="stat"><b>{formatKobo(data.outstanding)}</b><span>Still to collect</span></div>
        <div className="stat"><b>{formatKobo(data.approvedExpenses)}</b><span>Spent{data.overBudget ? " (over budget)" : ""}</span></div>
        <div className={`stat${data.balance < 0n ? " alert" : ""}`}><b>{formatKobo(data.balance)}</b><span>Fund balance</span></div>
      </section>
      <p className="small muted">The fund balance is what has been collected less what has been spent. It is not rent income and is reported separately.</p>

      <section className="card" aria-labelledby="share-h">
        <h2 id="share-h">Tenant shares</h2>
        {period.status === "OPEN" ? (
          can(member.role, "service.manage") ? (
            activeLeases.length === 0 ? <p className="muted">No active leases overlap this period, so there is nobody to share the charge between.</p> : (
              <form action={assessPeriodAction} className="stack">
                {hidden}
                <ul className="timeline">
                  {activeLeases.map((l) => (
                    <li key={l.id}>
                      <div className="row between" style={{ width: "100%" }}>
                        <div>{l.occupantName} <span className="small muted">{l.ref}{l.unit ? ` · ${l.unit}` : ""}{l.floorAreaSqm ? ` · ${l.floorAreaSqm} m²` : period.method === "FLOOR_AREA" ? " · floor area missing" : ""}</span></div>
                        {period.method === "FIXED" ? <input name={`fixed:${l.id}`} aria-label={`Fixed amount for ${l.occupantName}`} inputMode="decimal" placeholder="₦" style={{ width: 140 }} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
                {period.method === "FIXED" ? <p className="small muted">The fixed amounts must add up to exactly {formatKobo(period.budgetKobo)}.</p> : null}
                <Field label="Payment due on"><input name="dueDate" type="date" required /></Field>
                <button className="btn primary" type="submit">Share the budget</button>
              </form>
            )
          ) : <p className="muted">The budget has not been shared yet.</p>
        ) : (
          <div className="stack">
            {period.assessments.map((a) => {
              const bal = assessmentBalance(a.amountKobo, a.collections.map((c) => ({ amountKobo: c.amountKobo, reversed: !!c.reversal })));
              const lease = leases[a.leaseId];
              return (
                <div key={a.id} className="stack" style={{ gap: 6 }}>
                  <div className="row between">
                    <div>
                      <Link href={`/app/leases/${a.leaseId}`}><strong>{lease?.occupantName ?? "Tenant"}</strong></Link>
                      <div className="small muted">{lease?.ref}{lease?.unit ? ` · ${lease.unit}` : ""} · due {formatDate(a.dueDate)}</div>
                    </div>
                    <div className="small">Share {formatKobo(a.amountKobo)} · paid {formatKobo(bal.collected)} · <strong>owes {formatKobo(bal.outstanding)}</strong></div>
                  </div>
                  {a.collections.length > 0 ? (
                    <ul className="timeline">
                      {a.collections.map((c) => (
                        <li key={c.id}>
                          <div>
                            <div>{formatKobo(c.amountKobo)} on {formatDate(c.paidOn)} {c.reversal ? <Pill status="REVERSED" /> : null}</div>
                            <div className="small muted">ref {c.evidence}{c.method ? ` · ${c.method}` : ""} · {who(c.recordedById)}{c.reversal ? ` · reversed: ${c.reversal.reason}` : ""}</div>
                            {!c.reversal && can(member.role, "payment.reverse") ? (
                              <details className="inline">
                                <summary>Reverse</summary>
                                <form action={reverseCollectionAction} className="stack">
                                  {hidden}<input type="hidden" name="collectionId" value={c.id} />
                                  <Field label="Reason"><input name="reason" required /></Field>
                                  <button className="btn danger" type="submit">Reverse payment</button>
                                </form>
                              </details>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {bal.outstanding > 0n && can(member.role, "service.collect") ? (
                    <details className="inline">
                      <summary>Record a payment</summary>
                      <form action={recordCollectionAction} className="stack">
                        {hidden}<input type="hidden" name="assessmentId" value={a.id} />
                        <div className="fields">
                          <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" defaultValue={koboToInput(bal.outstanding)} /></Field>
                          <Field label="Paid on"><input name="paidOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                        </div>
                        <div className="fields">
                          <Field label="Method"><select name="method" defaultValue="Bank transfer">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
                          <Field label="Evidence reference"><input name="evidence" required /></Field>
                        </div>
                        <button className="btn primary" type="submit">Save payment</button>
                      </form>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="exp-h">
        <h2 id="exp-h">Expenses from the fund</h2>
        {period.expenses.length === 0 ? <p className="muted small">No expenses recorded.</p> : (
          <ul className="timeline">
            {period.expenses.map((e) => (
              <li key={e.id}>
                <div>
                  <div>{e.description} <strong>{formatKobo(e.amountKobo)}</strong> <Pill status={e.status} /></div>
                  <div className="small muted">{formatDate(e.incurredOn)}{e.supplier ? ` · ${e.supplier}` : ""} · ref {e.evidence} · requested by {who(e.requestedById)}{e.decidedById ? ` · decided by ${who(e.decidedById)}` : ""}</div>
                  {e.status === "PENDING" ? (
                    <div className="row" style={{ marginTop: 6 }}>
                      {can(member.role, "service.approve") && e.requestedById !== member.userId ? (
                        <form action={approveExpenseAction} className="row">{hidden}<input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="note" value="" /><button className="btn primary" type="submit">Approve</button></form>
                      ) : null}
                      {can(member.role, "service.expense") ? (
                        <form action={rejectExpenseAction} className="row">{hidden}<input type="hidden" name="expenseId" value={e.id} /><input type="hidden" name="note" value="" /><button className="btn" type="submit">{e.requestedById === member.userId ? "Withdraw" : "Reject"}</button></form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {can(member.role, "service.expense") ? (
          <details className="inline" style={{ marginTop: 10 }}>
            <summary>Record an expense</summary>
            <form action={requestExpenseAction} className="stack">
              {hidden}
              <Field label="What was spent on"><input name="description" required /></Field>
              <div className="fields">
                <Field label="Supplier"><input name="supplier" /></Field>
                <Field label="Amount (₦)"><input name="amount" required inputMode="decimal" /></Field>
              </div>
              <div className="fields">
                <Field label="Date"><input name="incurredOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                <Field label="Invoice or receipt reference"><input name="evidence" required /></Field>
              </div>
              <button className="btn primary" type="submit">Submit for approval</button>
            </form>
          </details>
        ) : null}
      </section>
    </div>
  );
}
