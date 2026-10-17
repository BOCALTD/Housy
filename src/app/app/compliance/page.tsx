import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { complianceCalendar, listObligations, OBLIGATION_KINDS, type CalendarItem } from "@/lib/services/obligations";
import { formatKobo } from "@/lib/money";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { cancelObligationAction, completeObligationAction, createObligationAction, reviewObligationAction } from "./actions";

export const metadata = { title: "Compliance calendar" };

const STATE_LABEL = { ESCALATED: "Escalated", OVERDUE: "Overdue", DUE_SOON: "Due soon", LATER: "Later" } as const;
const STATE_PILL = { ESCALATED: "OVERDUE", OVERDUE: "OVERDUE", DUE_SOON: "DUE", LATER: "OPEN" } as const;
const KIND_LABEL: Record<CalendarItem["kind"], string> = {
  OBLIGATION: "Obligation", LEASE_END: "Lease end", NOTICE: "Notice", SERVICE_CHARGE: "Service charge", REVIEW: "Review", WORK_ORDER: "Maintenance", URGENT_WORK: "Urgent maintenance", INSPECTION: "Inspection",
  WARRANTY: "Warranty", DEFECTS_PERIOD: "Defects period", DEFECT: "Defect", PROCUREMENT: "Materials", RISK_REVIEW: "Risk review", MILESTONE: "Milestone", VALUATION: "Valuation", VIEWING: "Viewing", FOLLOW_UP: "Follow-up", DEAL_CLOSE: "Deal closing",
};

function when(days: number) {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

export default async function CompliancePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("asset.view");
  const [{ items, leadDays, escalationDays }, { open, closed, assets }] = await Promise.all([complianceCalendar(member), listObligations(member)]);
  const todayText = toDateOnlyString(todayInLagos());
  const urgent = items.filter((i) => i.state !== "LATER");
  const later = items.filter((i) => i.state === "LATER").slice(0, 15);
  const canManage = can(member.role, "obligation.manage");
  const canComplete = can(member.role, "obligation.complete");

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Compliance calendar</h1>
        <p className="muted">
          Deadlines show as due soon {leadDays} days ahead and as escalated {escalationDays} days after they pass.
          Reminders appear here and on the dashboard; the system does not send emails or messages.
        </p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="card" aria-labelledby="cal-h">
        <h2 id="cal-h">Needs attention</h2>
        {urgent.length === 0 ? <p className="muted">Nothing is due soon or overdue.</p> : (
          <ShowMore noun="more" limit={5} items={urgent.map((i) => (
              <li key={i.id}>
                <div className="row between" style={{ width: "100%" }}>
                  <div>
                    <Link href={i.href}>{i.title}</Link>
                    <div className="small muted">{KIND_LABEL[i.kind]} · {i.detail} · {formatDate(i.dueDate)} ({when(i.days)}){i.amountKobo !== null ? ` · ${formatKobo(i.amountKobo)}` : ""}</div>
                  </div>
                  <Pill status={STATE_PILL[i.state]} label={STATE_LABEL[i.state]} />
                </div>
              </li>
            ))} />
        )}
        {later.length > 0 ? (
          <details className="inline" style={{ marginTop: 10 }}>
            <summary>Coming later ({later.length})</summary>
            <ShowMore noun="more" limit={5} items={later.map((i) => (
                <li key={i.id}><div><Link href={i.href}>{i.title}</Link><div className="small muted">{KIND_LABEL[i.kind]} · {formatDate(i.dueDate)} ({when(i.days)})</div></div></li>
              ))} />
          </details>
        ) : null}
      </section>

      <section className="card" aria-labelledby="obl-h">
        <h2 id="obl-h">Obligations</h2>
        {open.length === 0 ? <p className="muted">No open obligations. Add taxes, levies, permits and insurance so their deadlines are tracked.</p> : (
          <div className="stack">
            {open.map((o) => (
              <div key={o.id} className="stack" style={{ gap: 6 }}>
                <div>
                  <strong>{o.title}</strong> <span className="small muted">{humanize(o.kind)} · due {formatDate(o.dueDate)}{o.amountKobo !== null ? ` · ${formatKobo(o.amountKobo)}` : ""}</span>
                  <div className="small muted">
                    {o.asset ? `${o.asset.ref} · ${o.asset.name}` : "Whole portfolio"}{o.authority ? ` · ${o.authority}` : ""}{o.jurisdiction ? ` · ${o.jurisdiction}` : ""}
                    {o.recurrenceMonths ? ` · repeats every ${o.recurrenceMonths} months` : ""}{o.nextReviewOn ? ` · review ${formatDate(o.nextReviewOn)}` : ""}
                  </div>
                  {o.requiresProfessionalReview ? (
                    <div className="small">{o.reviewedBy && o.reviewedOn ? `Professionally reviewed by ${o.reviewedBy} on ${formatDate(o.reviewedOn)}` : <Pill status="PENDING" label="Professional review needed" />}</div>
                  ) : null}
                  {o.notes ? <div className="small muted">{o.notes}</div> : null}
                </div>
                <div className="row">
                  {canComplete ? (
                    <details className="inline">
                      <summary>Mark as done</summary>
                      <form action={completeObligationAction} className="stack">
                        <input type="hidden" name="obligationId" value={o.id} />
                        <div className="fields">
                          <Field label="Done on"><input name="completedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                          <Field label="Amount paid (₦)"><input name="amountPaid" inputMode="decimal" defaultValue={o.amountKobo !== null ? String(o.amountKobo / 100n) : ""} /></Field>
                        </div>
                        <Field label="Receipt or filing reference"><input name="evidence" required /></Field>
                        <button className="btn primary" type="submit">Save</button>
                      </form>
                    </details>
                  ) : null}
                  {canManage && o.requiresProfessionalReview ? (
                    <details className="inline">
                      <summary>Record professional review</summary>
                      <form action={reviewObligationAction} className="stack">
                        <input type="hidden" name="obligationId" value={o.id} />
                        <Field label="Reviewed by"><input name="reviewedBy" required /></Field>
                        <Field label="Reviewed on"><input name="reviewedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
                        <button className="btn primary" type="submit">Save review</button>
                      </form>
                    </details>
                  ) : null}
                  {canManage ? (
                    <details className="inline">
                      <summary>Cancel</summary>
                      <form action={cancelObligationAction} className="stack">
                        <input type="hidden" name="obligationId" value={o.id} />
                        <Field label="Reason"><input name="reason" required /></Field>
                        <button className="btn danger" type="submit">Cancel obligation</button>
                      </form>
                    </details>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {closed.length > 0 ? (
          <details className="inline" style={{ marginTop: 12 }}>
            <summary>Done or cancelled ({closed.length})</summary>
            <ShowMore noun="more" limit={5} items={closed.map((o) => (
                <li key={o.id}>
                  <div>
                    <div>{o.title} <Pill status={o.status === "SATISFIED" ? "DONE" : "CANCELLED"} /></div>
                    <div className="small muted">
                      Due {formatDate(o.dueDate)}{o.filing ? ` · done ${formatDate(o.filing.completedOn)} · ref ${o.filing.evidence}` : ""}{o.cancelReason ? ` · ${o.cancelReason}` : ""}
                    </div>
                  </div>
                </li>
              ))} />
          </details>
        ) : null}
      </section>

      {canManage ? (
        <section className="card" aria-labelledby="new-h">
          <h2 id="new-h">Add an obligation</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Enter the details from the notice or the law that applies. Rates and rules differ by state and over time, so they are never assumed.
            Where the position is unclear, tick the box so a professional's review is required before it can be marked done.
          </p>
          <form action={createObligationAction} className="stack">
            <div className="fields">
              <Field label="Type"><select name="kind" defaultValue="LAND_USE_CHARGE"><EnumOptions values={OBLIGATION_KINDS} /></select></Field>
              <Field label="Property" hint="Leave blank for the whole portfolio.">
                <select name="assetId" defaultValue=""><option value="">Whole portfolio</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select>
              </Field>
            </div>
            <Field label="Title"><input name="title" required placeholder="For example: Land use charge 2026" /></Field>
            <div className="fields">
              <Field label="Authority or payee"><input name="authority" /></Field>
              <Field label="Jurisdiction"><input name="jurisdiction" placeholder="For example: Lagos State" /></Field>
            </div>
            <div className="fields">
              <Field label="Amount (₦)" hint="Optional."><input name="amount" inputMode="decimal" /></Field>
              <Field label="Due date"><input name="dueDate" type="date" required /></Field>
            </div>
            <div className="fields">
              <Field label="Repeats every (months)" hint="Blank for a one-off."><input name="recurrenceMonths" inputMode="numeric" /></Field>
              <Field label="Next review date" hint="Optional."><input name="nextReviewOn" type="date" /></Field>
            </div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" name="requiresProfessionalReview" /> Needs a professional (tax adviser or lawyer) review</label>
            <Field label="Notes"><textarea name="notes" rows={2} /></Field>
            <button className="btn primary" type="submit">Add to calendar</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
