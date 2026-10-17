import SaveDocument from "@/components/SaveDocument";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { DEAL_DOC_KINDS, DEAL_PAYMENT_KINDS, getDealFile } from "@/lib/services/deal-file";
import { SPLIT_ROLES, getDealCommission } from "@/lib/services/commission";
import { bpsToPercent } from "@/lib/commission-rules";
import { ACTIVITY_KINDS } from "@/lib/crm-rules";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatKobo } from "@/lib/money";
import { humanize } from "@/lib/labels";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { cancelAction, decideAction, payAction, proposeAction } from "../../../commissions/actions";
import { addConversationAction, addDocumentAction, addTaskAction, linkCorrespondenceAction, recordPaymentAction, reversePaymentAction, taskStatusAction } from "./actions";

export const metadata = { title: "Deal file" };

export default async function DealFilePage({ params: paramsP, searchParams: searchP }: { params: Promise<{ id: string }>; searchParams?: Promise<SP> }) {
  const params = await paramsP;
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const f = await getDealFile(member, params.id);
  if (!f) notFound();
  const { deal } = f;
  const manage = can(member.role, "crm.manage") && f.canChange;
  const approve = can(member.role, "crm.approve");
  const live = deal.status !== "CANCELLED";
  const reversed = new Set(f.payments.filter((p) => p.reversesId).map((p) => p.reversesId!));
  const com = await getDealCommission(member, deal.id);
  const c = com.commission;
  const hid = <input type="hidden" name="dealId" value={deal.id} />;
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1>{deal.ref} file</h1>
        <p className="muted">Everything tied to this deal: documents, payments, correspondence, tasks and conversations. <Link href={`/app/deals/${deal.id}`}>Back to the deal</Link> · <Link href={`/app/crm/clients/${f.client.id}`}>{f.client.ref} {f.client.name}</Link> · <Link href={`/app/assets/${f.asset.id}`}>{f.asset.ref} {f.asset.name}</Link></p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="File summary">
        <div className="stat"><b>{f.documents.length}</b><span>Documents</span></div>
        <div className="stat"><b>{formatKobo(f.totals.net)}</b><span>Received, net</span></div>
        <div className="stat"><b>{f.correspondence.length}</b><span>Letters</span></div>
        <div className="stat"><b>{f.tasks.filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status)).length}</b><span>Open tasks</span></div>
        <div className="stat"><b>{f.viewings.length}</b><span>Viewings</span></div>
      </section>

      <section className="card">
        <h2>Documents</h2>
        {f.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
          <ShowMore noun="more documents" limit={4} items={f.documents.map((x) => (
            <li key={x.id}><div><a href={`/app/deal-docs/${x.id}`}>{x.title}</a><div className="small muted">{humanize(x.kind)} · {x.fileName} · {formatDate(x.createdAt)} · {f.userNames[x.uploadedById] ?? "unknown"}</div><SaveDocument url={`/app/deal-docs/${x.id}`} fallbackName={x.fileName} /></div></li>))} />
        )}
        {manage && live ? (
          <details className="inline"><summary>Add a document</summary>
            <form action={addDocumentAction} className="stack">{hid}
              <div className="fields"><Field label="Kind"><select name="kind" defaultValue="OTHER"><EnumOptions values={DEAL_DOC_KINDS} /></select></Field><Field label="Title"><input name="title" required /></Field></div>
              <Field label="File"><input name="file" type="file" required /></Field><button className="btn primary" type="submit">Upload</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Payments</h2>
        <p className="small muted">Received {formatKobo(f.totals.received)} · refunded {formatKobo(f.totals.refunded)}. A wrong entry is reversed by a manager other than the person who recorded it.</p>
        {f.payments.length === 0 ? <p className="muted">No payments recorded.</p> : (
          <ShowMore noun="more payments" limit={5} items={f.payments.map((p) => (
            <li key={p.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><strong>{formatKobo(p.amountKobo)}</strong> {humanize(p.kind)}{p.reversesId ? " (reversal)" : ""}<div className="small muted">{formatDate(p.paidOn)}{p.method ? ` · ${p.method}` : ""}{p.reference ? ` · ${p.reference}` : ""} · {f.userNames[p.recordedById] ?? "unknown"}{p.note ? ` · ${p.note}` : ""}</div></div>{reversed.has(p.id) ? <Pill status="REVERSED" label="Reversed" /> : null}</div>
              {approve && !p.reversesId && !reversed.has(p.id) && p.recordedById !== member.userId ? (
                <details className="inline"><summary>Reverse</summary><form action={reversePaymentAction} className="stack">{hid}<input type="hidden" name="paymentId" value={p.id} /><Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Reverse this payment</button></form></details>
              ) : null}
            </div></li>))} />
        )}
        {manage && live ? (
          <details className="inline"><summary>Record a payment</summary>
            <form action={recordPaymentAction} className="stack">{hid}
              <div className="fields">
                <Field label="Kind"><select name="kind" defaultValue="BOOKING_DEPOSIT"><EnumOptions values={DEAL_PAYMENT_KINDS} /></select></Field>
                <Field label="Amount (₦)"><input name="amount" inputMode="decimal" required /></Field>
                <Field label="Date paid"><input name="paidOn" type="date" required /></Field>
                <Field label="Method"><input name="method" placeholder="Transfer, cash, cheque" /></Field>
                <Field label="Reference"><input name="reference" /></Field>
              </div>
              <Field label="Note"><input name="note" /></Field><button className="btn primary" type="submit">Record payment</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Correspondence</h2>
        {f.correspondence.length === 0 ? <p className="muted">No letters linked.</p> : (
          <ShowMore noun="more letters" limit={4} items={f.correspondence.map((c) => (
            <li key={c.id}><div className="row between" style={{ width: "100%" }}><div><Link href={`/app/correspondence/${c.id}`}><strong>{c.ref}</strong> {c.subject}</Link><div className="small muted">{humanize(c.direction)} · {humanize(c.status)} · {formatDate(c.createdAt)}</div></div>
              {manage ? <form action={linkCorrespondenceAction}>{hid}<input type="hidden" name="correspondenceId" value={c.id} /><input type="hidden" name="unlink" value="yes" /><button className="btn" type="submit">Unlink</button></form> : null}</div></li>))} />
        )}
        {manage && live && f.linkable.length > 0 ? (
          <details className="inline"><summary>Link a letter</summary>
            <form action={linkCorrespondenceAction} className="stack">{hid}<Field label="Letter"><select name="correspondenceId" required defaultValue=""><option value="" disabled>Choose</option>{f.linkable.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.subject}</option>)}</select></Field><button className="btn primary" type="submit">Link</button></form>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Tasks</h2>
        {f.tasks.length === 0 ? <p className="muted">No tasks.</p> : (
          <ShowMore noun="more tasks" limit={4} items={f.tasks.map((t) => (
            <li key={t.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
              <div className="row between"><div><strong>{t.title}</strong><div className="small muted">{t.assigneeId ? f.names[t.assigneeId] ?? "unknown" : "Unassigned"}{t.dueOn ? ` · due ${formatDate(t.dueOn)}` : ""}{t.outcome ? ` · ${t.outcome}` : ""}</div></div><Pill status={t.status} label={humanize(t.status)} /></div>
              {["OPEN", "IN_PROGRESS"].includes(t.status) && (t.assigneeId === member.membershipId || manage) ? (
                <details className="inline"><summary>Update</summary><form action={taskStatusAction} className="stack">{hid}<input type="hidden" name="taskId" value={t.id} />
                  <Field label="Status"><select name="status" defaultValue="DONE"><option value="DONE">Done</option><option value="CANCELLED">Cancelled</option></select></Field><Field label="Outcome"><input name="outcome" /></Field><button className="btn primary" type="submit">Save</button></form></details>
              ) : null}
            </div></li>))} />
        )}
        {manage && deal.status === "OPEN" ? (
          <details className="inline"><summary>Add a task</summary>
            <form action={addTaskAction} className="stack">{hid}
              <div className="fields"><Field label="Title"><input name="title" required /></Field><Field label="Due"><input name="dueOn" type="date" /></Field>
                <Field label="Assign to"><select name="assigneeId" defaultValue="">{<option value="">Me</option>}{f.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field></div>
              <Field label="Details"><input name="description" /></Field><button className="btn primary" type="submit">Add task</button></form>
          </details>
        ) : null}
      </section>

      {deal.stage === "COMPLETED" && !com.hidden ? (
        <section className="card">
          <h2>Commission</h2>
          {!c ? <p className="muted">No commission proposed yet.</p> : (
            <>
              <p>{formatKobo(c.totalKobo)} on {formatKobo(c.basisKobo)} · {c.ruleName} ({c.method === "PERCENT" ? `${bpsToPercent(c.rateBps ?? 0)}%` : "fixed"}) · <Pill status={c.status} label={humanize(c.status)} /></p>
              <p className="small muted">Proposed by {com.userNames[c.submittedById] ?? "unknown"}{c.decidedById ? ` · decided by ${com.userNames[c.decidedById] ?? "unknown"}` : ""}{c.decisionNote ? ` · ${c.decisionNote}` : ""}</p>
              <ShowMore noun="more people" limit={4} items={c.splits.map((sp2) => (
                <li key={sp2.id}><div className="stack" style={{ width: "100%", gap: 4 }}>
                  <div className="row between"><div><strong>{com.names[sp2.membershipId] ?? "unknown"}</strong> · {humanize(sp2.role)} · {bpsToPercent(sp2.shareBps)}% · {formatKobo(sp2.amountKobo)}</div>{sp2.paidAt ? <Pill status="PAID" label={`Paid ${formatDate(sp2.paidAt)}`} /> : null}</div>
                  {sp2.paidAt ? <div className="small muted">Reference {sp2.payReference} · paid by {com.userNames[sp2.paidById ?? ""] ?? "unknown"}</div> : null}
                  {c.status === "APPROVED" && !sp2.paidAt && approve && sp2.membershipId !== member.membershipId && c.submittedById !== member.userId ? (
                    <details className="inline"><summary>Record payment</summary>
                      <form action={payAction} className="stack">{hid}<input type="hidden" name="splitId" value={sp2.id} />
                        <div className="fields"><Field label="Date paid"><input name="paidOn" type="date" required /></Field><Field label="Reference"><input name="reference" required /></Field></div>
                        <button className="btn primary" type="submit">Mark as paid</button></form></details>
                  ) : null}
                </div></li>))} />
              {com.deal.status === "DISPUTED" ? <p className="small">The deal is disputed, so approval and payment are withheld.</p> : null}
              {c.status === "SUBMITTED" && approve && c.submittedById !== member.userId && !c.splits.some((x) => x.membershipId === member.membershipId) && deal.ownerId !== member.membershipId ? (
                <details className="inline"><summary>Decide</summary>
                  <form action={decideAction} className="stack">{hid}<Field label="Note (needed to reject)"><input name="note" /></Field>
                    <div className="row"><button className="btn primary" name="decision" value="approve" type="submit">Approve</button><button className="btn" name="decision" value="reject" type="submit">Reject</button></div></form></details>
              ) : null}
              {["SUBMITTED", "APPROVED"].includes(c.status) && (approve || (manage && c.submittedById === member.userId)) && !c.splits.some((x) => x.paidAt) ? (
                <details className="inline"><summary>Cancel the commission</summary><form action={cancelAction} className="stack">{hid}<Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Cancel</button></form></details>
              ) : null}
            </>
          )}
          {manage && (!c || ["REJECTED", "CANCELLED"].includes(c.status)) ? (
            <details className="inline"><summary>Propose the commission</summary>
              <form action={proposeAction} className="stack">{hid}
                <Field label="Rule"><select name="ruleId" required defaultValue=""><option value="" disabled>Choose</option>{com.rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                {[1, 2, 3, 4].map((n) => (
                  <div className="fields" key={n}>
                    <Field label={`Person ${n}`}><select name={`person${n}`} defaultValue="">{<option value="">{n === 1 ? "Choose" : "None"}</option>}{com.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                    <Field label="Role"><select name={`role${n}`} defaultValue="OTHER"><EnumOptions values={SPLIT_ROLES} /></select></Field>
                    <Field label="Share (%)"><input name={`share${n}`} inputMode="decimal" /></Field>
                  </div>
                ))}
                <p className="small muted">The shares must add up to exactly 100%. A manager other than you and the people sharing it approves the commission.</p>
                <button className="btn primary" type="submit">Send for approval</button></form>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <h2>Conversations</h2>
        {f.activities.length === 0 ? <p className="muted">Nothing recorded.</p> : (
          <ShowMore noun="more entries" limit={5} items={f.activities.map((a) => (
            <li key={a.id}><div className="stack" style={{ width: "100%", gap: 2 }}><div><strong>{a.subject}</strong></div><div className="small muted">{humanize(a.kind)} · {formatDateTime(a.occurredAt)}{a.dueOn ? ` · due ${formatDate(a.dueOn)}` : ""}{a.doneAt ? " · done" : ""}</div>{a.body ? <details className="inline"><summary>Details</summary><p style={{ whiteSpace: "pre-wrap" }}>{a.body}</p></details> : null}</div></li>))} />
        )}
        {manage && live ? (
          <details className="inline"><summary>Record a call, meeting or follow-up</summary>
            <form action={addConversationAction} className="stack">{hid}<input type="hidden" name="clientId" value={f.client.id} />
              <div className="fields"><Field label="What"><select name="kind" defaultValue="CALL"><EnumOptions values={ACTIVITY_KINDS} /></select></Field><Field label="Subject"><input name="subject" required /></Field><Field label="Due (follow-ups)"><input name="dueOn" type="date" /></Field></div>
              <Field label="Details"><textarea name="body" rows={2} /></Field><button className="btn primary" type="submit">Save</button></form>
          </details>
        ) : null}
      </section>
    </div>
  );
}
