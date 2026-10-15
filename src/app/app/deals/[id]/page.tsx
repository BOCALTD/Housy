import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getDeal } from "@/lib/services/deal";
import { DEAL_STAGES, offerGapBps } from "@/lib/deal-rules";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import {
  cancelDealAction, cancelViewingAction, completeAction, counterOfferAction, decideAcceptanceAction, disputeAction, holdAction, moveStageAction, reassignAction, recordOfferAction,
  rejectOfferAction, reopenAction, requestAcceptanceAction, rescheduleViewingAction, resolveDisputeAction, scheduleViewingAction, viewingOutcomeAction, withdrawAcceptanceAction, withdrawOfferAction,
} from "../actions";

export const metadata = { title: "Deal" };

const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);

export default async function DealPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("crm.view");
  const d = await getDeal(member, params.id);
  if (!d) notFound();
  const { deal } = d;
  const manage = can(member.role, "crm.manage") && d.canChange;
  const approve = can(member.role, "crm.approve");
  const assign = can(member.role, "crm.assign");
  const open = deal.status === "OPEN";
  const live = !["COMPLETED", "CANCELLED"].includes(deal.status);
  const preAgreed = ["ENQUIRY", "VIEWING", "OFFER", "NEGOTIATION"].includes(deal.stage);
  const hid = <input type="hidden" name="dealId" value={deal.id} />;
  const stageIndex = DEAL_STAGES.indexOf(deal.stage);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>{deal.ref} · {deal.title}</h1>
        <p className="muted"><Link href={`/app/crm/clients/${deal.client.id}`}>{deal.client.ref} {deal.client.name}</Link> · <Link href={`/app/assets/${deal.asset.id}`}>{deal.asset.ref} {deal.asset.name}</Link> · {humanize(deal.type)} · owner {d.names[deal.ownerId] ?? "unknown"} <Link href="/app/deals">All deals</Link></p>
        <div className="row"><Pill status={deal.stage} label={humanize(deal.stage)} />{deal.status !== "OPEN" ? <Pill status={deal.status} label={humanize(deal.status)} /> : null}</div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Figures">
        <div className="stat"><b>{formatKobo(deal.askingKobo)}</b><span>Asking</span></div>
        <div className="stat"><b>{deal.agreedKobo ? formatKobo(deal.agreedKobo) : "Not yet"}</b><span>Agreed</span></div>
        <div className="stat"><b>{stageIndex + 1} of {DEAL_STAGES.length}</b><span>Stage</span></div>
        <div className="stat"><b>{deal.expectedCloseOn ? formatDate(deal.expectedCloseOn) : "Not set"}</b><span>Expected to close</span></div>
      </section>

      {deal.status === "ON_HOLD" ? <p className="card">On hold: {deal.holdReason}</p> : null}
      {deal.status === "DISPUTED" ? <p className="card">Disputed by {d.userNames[deal.disputedById ?? ""] ?? "someone"}: {deal.disputeReason}</p> : null}
      {deal.status === "CANCELLED" ? <p className="card">Cancelled: {deal.cancelReason}</p> : null}
      {deal.disputeOutcome ? <p className="card">Dispute outcome: {deal.disputeOutcome}</p> : null}

      <section className="card">
        <h2>Offers and negotiation</h2>
        {d.offers.length === 0 ? <p className="muted">No offers yet.</p> : (
          <ShowMore noun="more offers" limit={4} items={d.offers.map((o) => (
            <li key={o.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><strong>{formatKobo(o.amountKobo)}</strong> from the {o.side === "CLIENT" ? "client" : "owner"}{o.parentId ? " (counteroffer)" : ""}
                <div className="small muted">{formatDateTime(o.createdAt)} · {offerGapBps(deal.askingKobo, o.amountKobo) / 100}% against asking{o.validUntil ? ` · valid to ${formatDate(o.validUntil)}` : ""}</div></div><Pill status={o.status} label={humanize(o.status)} /></div>
              {o.conditions || o.note || o.decisionNote ? <details className="inline"><summary>Details</summary>{o.conditions ? <p>Conditions: {o.conditions}</p> : null}{o.note ? <p>Note: {o.note}</p> : null}{o.decisionNote ? <p>Decision: {o.decisionNote}</p> : null}</details> : null}
              {o.status === "ACCEPTANCE_REQUESTED" ? <p className="small">Acceptance asked by {d.userNames[o.acceptRequestedById ?? ""] ?? "someone"}. A manager other than that person must approve it.</p> : null}
              {o.status === "ACCEPTED" ? <p className="small">Accepted. Approved by {d.userNames[o.decidedById ?? ""] ?? "someone"}.</p> : null}
              {o.status === "OPEN" && manage && open && preAgreed ? (
                <div className="stack">
                  <form action={requestAcceptanceAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="offerId" value={o.id} /><button className="btn" type="submit">Ask to accept this offer</button></form>
                  <details className="inline"><summary>Counter</summary>
                    <form action={counterOfferAction} className="stack">{hid}<input type="hidden" name="offerId" value={o.id} />
                      <div className="fields"><Field label="Amount (₦)"><input name="amount" inputMode="decimal" required /></Field><Field label="Valid until"><input name="validUntil" type="date" /></Field></div>
                      <Field label="Conditions"><input name="conditions" /></Field><Field label="Note"><input name="note" /></Field><button className="btn primary" type="submit">Record counteroffer</button></form></details>
                  <details className="inline"><summary>Reject or withdraw</summary>
                    <form action={rejectOfferAction} className="stack">{hid}<input type="hidden" name="offerId" value={o.id} /><Field label="Reason for rejecting"><input name="reason" required /></Field><button className="btn" type="submit">Reject</button></form>
                    <form action={withdrawOfferAction} className="stack">{hid}<input type="hidden" name="offerId" value={o.id} /><Field label="Note"><input name="note" /></Field><button className="btn" type="submit">Withdraw</button></form></details>
                </div>
              ) : null}
              {o.status === "ACCEPTANCE_REQUESTED" && open ? (
                <div className="stack">
                  {approve && o.acceptRequestedById !== member.userId ? (
                    <details className="inline"><summary>Decide</summary>
                      <form action={decideAcceptanceAction} className="stack">{hid}<input type="hidden" name="offerId" value={o.id} />
                        <Field label="Note (needed to refuse)"><input name="note" /></Field>
                        <div className="row"><button className="btn primary" name="decision" value="approve" type="submit">Approve and agree the price</button><button className="btn" name="decision" value="reject" type="submit">Refuse</button></div></form></details>
                  ) : null}
                  {o.acceptRequestedById === member.userId || assign ? <form action={withdrawAcceptanceAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="offerId" value={o.id} /><button className="btn" type="submit">Withdraw the request</button></form> : null}
                </div>
              ) : null}
            </div></li>))} />
        )}
        {manage && open && preAgreed ? (
          <details className="inline"><summary>Record a new offer</summary>
            <form action={recordOfferAction} className="stack">{hid}
              <div className="fields">
                <Field label="Made by"><select name="side" defaultValue="CLIENT"><option value="CLIENT">The client</option><option value="OWNER">The owner</option></select></Field>
                <Field label="Amount (₦)"><input name="amount" inputMode="decimal" required /></Field>
                <Field label="Valid until"><input name="validUntil" type="date" /></Field>
              </div>
              <Field label="Conditions"><input name="conditions" /></Field><Field label="Note"><input name="note" /></Field>
              <button className="btn primary" type="submit">Record offer</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Viewings</h2>
        {d.viewings.length === 0 ? <p className="muted">No viewings booked.</p> : (
          <ShowMore noun="more viewings" limit={3} items={d.viewings.map((v) => (
            <li key={v.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><strong>{day(v.startsAt)} {time(v.startsAt)} to {time(v.endsAt)}</strong><div className="small muted">With {d.names[v.agentId] ?? "unknown"}{v.meetingPoint ? ` · meet at ${v.meetingPoint}` : ""}{v.rescheduledCount ? ` · moved ${v.rescheduledCount} time${v.rescheduledCount === 1 ? "" : "s"}` : ""}</div></div><Pill status={v.status} label={humanize(v.status)} /></div>
              {v.outcome || v.cancelReason ? <p className="small">{v.outcome || v.cancelReason}</p> : null}
              {v.status === "SCHEDULED" && live ? (
                <div className="stack">
                  {v.startsAt.getTime() <= Date.now() ? (
                    <details className="inline"><summary>Record what happened</summary>
                      <form action={viewingOutcomeAction} className="stack">{hid}<input type="hidden" name="viewingId" value={v.id} />
                        <Field label="Result"><select name="result" defaultValue="COMPLETED"><option value="COMPLETED">Viewing held</option><option value="NO_SHOW">Client did not come</option></select></Field>
                        <Field label="How it went"><input name="outcome" /></Field><button className="btn primary" type="submit">Save</button></form></details>
                  ) : null}
                  {manage ? (
                    <>
                      <details className="inline"><summary>Move</summary>
                        <form action={rescheduleViewingAction} className="stack">{hid}<input type="hidden" name="viewingId" value={v.id} />
                          <div className="fields"><Field label="Date"><input name="date" type="date" required defaultValue={day(v.startsAt)} /></Field><Field label="Time (Lagos)"><input name="time" type="time" required defaultValue={time(v.startsAt)} /></Field><Field label="Minutes"><input name="minutes" inputMode="numeric" defaultValue={String(Math.round((v.endsAt.getTime() - v.startsAt.getTime()) / 60000))} /></Field></div>
                          <button className="btn primary" type="submit">Move viewing</button></form></details>
                      <details className="inline"><summary>Cancel</summary>
                        <form action={cancelViewingAction} className="stack">{hid}<input type="hidden" name="viewingId" value={v.id} /><Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Cancel viewing</button></form></details>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div></li>))} />
        )}
        {manage && open && preAgreed ? (
          <details className="inline"><summary>Book a viewing</summary>
            <form action={scheduleViewingAction} className="stack">{hid}
              <div className="fields">
                <Field label="Date"><input name="date" type="date" required /></Field>
                <Field label="Time (Lagos)"><input name="time" type="time" required /></Field>
                <Field label="Minutes"><input name="minutes" inputMode="numeric" defaultValue="30" /></Field>
                <Field label="Agent"><select name="agentId" defaultValue="">{<option value="">Deal owner</option>}{d.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              </div>
              <Field label="Meeting point"><input name="meetingPoint" /></Field>
              <button className="btn primary" type="submit">Book viewing</button></form>
          </details>
        ) : null}
      </section>

      {live ? (
        <section className="card">
          <details className="inline"><summary>Move, hold, dispute or close this deal</summary>
            <div className="stack">
              {manage && open && deal.stage !== "COMPLETED" ? (
                <form action={moveStageAction} className="stack">{hid}
                  <Field label="Move to stage"><select name="to" defaultValue="">{<option value="" disabled>Choose</option>}{DEAL_STAGES.filter((s) => s !== deal.stage && !["AGREED", "COMPLETED"].includes(s)).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
                  <Field label="Reason (needed to go back)"><input name="reason" /></Field><button className="btn" type="submit">Move</button></form>
              ) : null}
              {manage && deal.stage === "LEGAL" && open ? <p className="small muted">Completion is done by a manager who is not the deal&apos;s owner.</p> : null}
              {approve && open && deal.stage === "LEGAL" && deal.ownerId !== member.membershipId ? (
                <form action={completeAction} className="stack">{hid}<Field label="Completion note"><input name="note" /></Field><button className="btn primary" type="submit">Complete the deal</button></form>
              ) : null}
              {approve && open && ["AGREED", "LEGAL"].includes(deal.stage) ? (
                <form action={reopenAction} className="stack">{hid}<Field label="Reason for reopening the agreement"><input name="reason" required /></Field><button className="btn" type="submit">Reopen negotiation</button></form>
              ) : null}
              {manage ? (
                <form action={holdAction} className="stack">{hid}<input type="hidden" name="hold" value={deal.status === "ON_HOLD" ? "no" : "yes"} />
                  {deal.status === "ON_HOLD" ? null : <Field label="Reason for holding"><input name="reason" /></Field>}
                  {deal.status === "OPEN" || deal.status === "ON_HOLD" ? <button className="btn" type="submit">{deal.status === "ON_HOLD" ? "Resume the deal" : "Put on hold"}</button> : null}</form>
              ) : null}
              {manage && ["OPEN", "ON_HOLD"].includes(deal.status) ? <form action={disputeAction} className="stack">{hid}<Field label="What is the dispute about?"><input name="reason" required /></Field><button className="btn" type="submit">Record a dispute</button></form> : null}
              {approve && deal.status === "DISPUTED" && deal.disputedById !== member.userId ? (
                <form action={resolveDisputeAction} className="stack">{hid}<Field label="How it was settled"><input name="outcome" required /></Field>
                  <Field label="Then"><select name="then" defaultValue="resume"><option value="resume">Carry on with the deal</option><option value="cancel">Cancel the deal</option></select></Field><button className="btn primary" type="submit">Settle the dispute</button></form>
              ) : null}
              {manage ? <form action={cancelDealAction} className="stack">{hid}<Field label="Reason for cancelling"><input name="reason" required /></Field><button className="btn" type="submit">Cancel the deal</button></form> : null}
              {assign ? <form action={reassignAction} className="stack">{hid}<Field label="Hand the deal to"><select name="ownerId" required defaultValue="">{<option value="" disabled>Choose</option>}{d.agents.filter((a) => a.id !== deal.ownerId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                <Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Reassign</button></form> : null}
            </div>
          </details>
        </section>
      ) : null}

      <section className="card">
        <h2>History</h2>
        <ShowMore noun="more entries" limit={6} items={d.events.map((e) => (
          <li key={e.id}><div><strong>{e.summary}</strong><div className="small muted">{formatDateTime(e.createdAt)} · {d.userNames[e.actorId] ?? "unknown"}{e.reason ? ` · ${e.reason}` : ""}</div></div></li>))} />
      </section>
    </div>
  );
}
