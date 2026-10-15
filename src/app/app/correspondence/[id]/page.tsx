import SaveDocument from "@/components/SaveDocument";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getCorrespondence, DISPATCH_METHODS } from "@/lib/services/correspondence";
import { listTeam } from "@/lib/services/companies";
import { allowedActions, isOverdue, STATUS_LABELS, type CorrStatus } from "@/lib/correspondence-rules";
import { formatDate, formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { attachAction, noteAction, submitDraftAction, workflowAction } from "../actions";

export const metadata = { title: "Correspondence" };

const KIND_LABELS: Record<string, string> = {
  REGISTERED: "Registered", ASSIGN: "Assigned", START_REVIEW: "Review started", REQUIRE_RESPONSE: "Response required",
  SAVE_DRAFT: "Draft saved", SUBMIT_FOR_APPROVAL: "Sent for approval", APPROVE: "Approved", RETURN_TO_DRAFT: "Returned for changes",
  DISPATCH: "Sent", AWAIT_REPLY: "Awaiting reply", CLOSE: "Closed", NOTE: "Note", ATTACHED: "Attachment added",
};

export default async function CorrespondenceDetail({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("correspondence.view");
  const result = await getCorrespondence(member, params.id);
  if (!result) notFound();
  const { rec, names } = result;
  const status = rec.status as CorrStatus;
  const today = todayInLagos();
  const todayStr = toDateOnlyString(today);
  const isAssignee = rec.assigneeId === member.membershipId;
  const canAssign = can(member.role, "correspondence.assign");
  const canApprove = can(member.role, "correspondence.approve");
  const handler = isAssignee || canAssign;
  const actions = allowedActions(status);
  const team = canAssign ? (await listTeam(member)).members.filter((m) => m.status === "ACTIVE") : [];
  const overdue = isOverdue(status, rec.responseDeadline, today);
  const owesResponse = ["RESPONSE_REQUIRED", "DRAFT_RESPONSE", "APPROVED"].includes(status);
  const canClose = actions.includes("close") && (owesResponse ? canAssign : handler);

  const base = (action: string) => (
    <>
      <input type="hidden" name="id" value={rec.id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="expectedStatus" value={rec.status} />
    </>
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <p className="small"><Link href="/app/correspondence">Correspondence</Link></p>
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <p className="eyebrow mono">{rec.ref}</p>
            <h1>{rec.subject}</h1>
            <p className="muted">
              {rec.direction === "INCOMING" ? `From ${rec.senderName}` : `To ${rec.recipientName}`} · {rec.category}
              {rec.externalRef ? ` · their ref ${rec.externalRef}` : ""}
            </p>
          </div>
          <div className="row">
            {rec.confidential ? <span className="pill bad">Confidential</span> : null}
            {rec.priority !== "NORMAL" ? <Pill status={rec.priority === "URGENT" ? "CRITICAL" : rec.priority} label={rec.priority.toLowerCase()} /> : null}
            {overdue ? <Pill status="OVERDUE" /> : null}
            <Pill status={rec.status} label={STATUS_LABELS[status]} />
          </div>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <div className="two">
        <div className="stack-lg">
          {/* Next step */}
          {status !== "CLOSED" ? (
            <section className="card stack" aria-labelledby="next-h">
              <h2 id="next-h">Next step</h2>
              {actions.includes("assign") && canAssign ? (
                <form action={workflowAction} className="fields">
                  {base("assign")}
                  <Field label={rec.assigneeId ? "Reassign to" : "Assign to"}>
                    <select name="assigneeId" required defaultValue={rec.assigneeId ?? ""}>
                      <option value="" disabled>Choose a member</option>
                      {team.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Reply needed by"><input name="responseDeadline" type="date" defaultValue={rec.responseDeadline ? toDateOnlyString(rec.responseDeadline) : ""} /></Field>
                  <div style={{ alignSelf: "end" }}><button className="btn primary" type="submit">{rec.assigneeId ? "Reassign" : "Assign"}</button></div>
                </form>
              ) : null}

              {actions.includes("start_review") && handler ? (
                <form action={workflowAction}>{base("start_review")}<button className="btn primary" type="submit">Start review</button></form>
              ) : null}

              {actions.includes("require_response") && handler ? (
                <form action={workflowAction} className="stack">
                  {base("require_response")}
                  <Field label="Response required" hint="What reply or action this letter needs."><textarea name="requiredAction" rows={2} required /></Field>
                  <Field label="Reply needed by"><input name="responseDeadline" type="date" defaultValue={rec.responseDeadline ? toDateOnlyString(rec.responseDeadline) : ""} /></Field>
                  <div className="row"><button className="btn primary" type="submit">Mark as needing a response</button></div>
                </form>
              ) : null}

              {(actions.includes("save_draft") || actions.includes("submit_for_approval")) && handler ? (
                <form action={workflowAction} className="stack">
                  {base("save_draft")}
                  <Field label={rec.direction === "OUTGOING" ? "Letter text" : "Draft response"}>
                    <textarea name="draftResponse" rows={10} required defaultValue={rec.draftResponse} />
                  </Field>
                  <div className="row">
                    <button className="btn" type="submit">Save draft</button>
                    {actions.includes("submit_for_approval") ? (
                      <button className="btn primary" type="submit" formAction={submitDraftAction}>Save and send for approval</button>
                    ) : null}
                  </div>
                </form>
              ) : null}

              {status === "AWAITING_APPROVAL" ? (
                canApprove ? (
                  rec.draftedById === member.userId ? (
                    <p className="muted">You drafted this response, so another manager must approve it.</p>
                  ) : (
                    <div className="stack">
                      <form action={workflowAction}>{base("approve")}<button className="btn primary" type="submit">Approve response</button></form>
                      <form action={workflowAction} className="fields">
                        {base("return_to_draft")}
                        <Field label="Changes needed"><input name="note" required /></Field>
                        <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Return for changes</button></div>
                      </form>
                    </div>
                  )
                ) : <p className="muted">Waiting for a manager to approve the response.</p>
              ) : null}

              {actions.includes("dispatch") && handler ? (
                <form action={workflowAction} className="fields">
                  {base("dispatch")}
                  <Field label="Sent by"><select name="dispatchMethod" required defaultValue="">
                    <option value="" disabled>Choose</option>{DISPATCH_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select></Field>
                  <Field label="Date sent"><input name="dispatchedOn" type="date" required defaultValue={todayStr} max={todayStr} /></Field>
                  <div style={{ alignSelf: "end" }}><button className="btn primary" type="submit">Record as sent</button></div>
                </form>
              ) : null}

              {actions.includes("await_reply") && handler ? (
                <form action={workflowAction}>{base("await_reply")}<button className="btn" type="submit">Mark as awaiting a reply</button></form>
              ) : null}

              {canClose ? (
                <details className="inline">
                  <summary>Close this record</summary>
                  <form action={workflowAction} className="stack">
                    {base("close")}
                    {owesResponse ? <p className="small muted">A response is still due. Closing records that it was handled another way.</p> : null}
                    <Field label="How it was resolved" hint="Closure evidence, for example: no response needed, settled by phone on 12 Oct."><textarea name="note" rows={2} required /></Field>
                    <div className="row"><button className="btn danger" type="submit">Close</button></div>
                  </form>
                </details>
              ) : null}

              {!handler && !canApprove ? <p className="muted small">Only the assigned officer or a manager can move this record on. You can still add notes.</p> : null}
            </section>
          ) : (
            <section className="card">
              <h2>Closed</h2>
              <p>{rec.closureNote}</p>
              <p className="small muted">{rec.closedAt ? formatDateTime(rec.closedAt) : ""}</p>
            </section>
          )}

          {rec.draftResponse && status !== "DRAFT_RESPONSE" && status !== "RESPONSE_REQUIRED" ? (
            <section className="card">
              <h2>{rec.direction === "OUTGOING" ? "Letter text" : "Response"}</h2>
              <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{rec.draftResponse}</p>
              <p className="small muted" style={{ marginTop: 10 }}>
                Drafted by {rec.draftedById ? names[rec.draftedById] ?? "a former member" : "unknown"}
                {rec.approvedById ? ` · approved by ${names[rec.approvedById] ?? "a former member"}${rec.approvedAt ? ` on ${formatDateTime(rec.approvedAt)}` : ""}` : ""}
                {rec.dispatchedAt ? ` · sent by ${rec.dispatchMethod.toLowerCase()} on ${formatDate(rec.dispatchedAt)}` : ""}
              </p>
            </section>
          ) : null}

          <section className="card" aria-labelledby="hist-h">
            <h2 id="hist-h">History and notes</h2>
            <ShowMore noun="more" limit={5} items={rec.actions.map((a) => (
                <li key={a.id}>
                  <div>
                    <div className="small"><strong>{KIND_LABELS[a.kind] ?? a.kind}</strong>{a.note ? `: ${a.note}` : ""}</div>
                    <div className="small muted">{names[a.actorId] ?? "Former member"} · {formatDateTime(a.createdAt)}</div>
                  </div>
                </li>
              ))} />
            <form action={noteAction} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={rec.id} />
              <input name="note" placeholder="Add a note" aria-label="Note" required
                     style={{ flex: "1 1 240px", border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
              <button className="btn" type="submit">Add note</button>
            </form>
          </section>
        </div>

        <div className="stack-lg">
          <section className="card">
            <h2>Details</h2>
            <dl className="stack" style={{ gap: 8, margin: 0 }}>
              {[
                ["Direction", rec.direction === "INCOMING" ? "Incoming" : "Outgoing"],
                ["Sender", rec.senderName],
                ["Recipient", rec.recipientName],
                ["Copied to", rec.copiedTo || "—"],
                ["Received", formatDate(rec.dateReceived)],
                ["Reply needed by", formatDate(rec.responseDeadline)],
                ["Assigned to", rec.assignee ? rec.assignee.user.name : "Unassigned"],
                ["Department", rec.department ? `${rec.department.name} (${rec.department.code})` : "—"],
                ["Registered by", `${names[rec.createdById] ?? "Former member"} on ${formatDateTime(rec.createdAt)}`],
              ].map(([k, v]) => (
                <div key={k} className="row between small"><dt className="muted">{k}</dt><dd style={{ margin: 0, textAlign: "right" }}>{v}</dd></div>
              ))}
              {rec.asset ? (
                <div className="row between small"><dt className="muted">Asset</dt><dd style={{ margin: 0 }}><Link href={`/app/assets/${rec.asset.id}`}>{rec.asset.ref} · {rec.asset.name}</Link></dd></div>
              ) : null}
            </dl>
            {rec.description ? <p className="small" style={{ marginTop: 12 }}>{rec.description}</p> : null}
            {rec.requiredAction ? <p className="small" style={{ marginTop: 8 }}><strong>Response required:</strong> {rec.requiredAction}</p> : null}
          </section>

          <section className="card">
            <h2>Attachments</h2>
            {rec.attachments.length === 0 ? <p className="muted small">No attachments.</p> : (
              <ShowMore noun="more" limit={5} items={rec.attachments.map((a) => (
                  <li key={a.id}><div><a href={`/app/correspondence/attachments/${a.id}`}>{a.title}</a><div className="small muted">{(a.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(a.createdAt)}</div><SaveDocument url={`/app/correspondence/attachments/${a.id}`} fallbackName={a.title} /></div></li>
                ))} />
            )}
            {can(member.role, "correspondence.register") ? (
              <details className="inline" style={{ marginTop: 12 }}>
                <summary>Attach a file</summary>
                <form action={attachAction} className="stack">
                  <input type="hidden" name="id" value={rec.id} />
                  <Field label="Title"><input name="title" placeholder="For example: signed reply" /></Field>
                  <Field label="File" hint="Up to 4 MB."><input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" /></Field>
                  <button className="btn" type="submit">Attach</button>
                </form>
              </details>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
