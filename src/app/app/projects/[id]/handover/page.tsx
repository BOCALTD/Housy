import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getProjectHandover } from "@/lib/services/project-handover";
import { DEFECT_SEVERITIES, DOC_KINDS } from "@/lib/project-rules";
import { formatDate, toDateOnlyString, todayInLagos } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import {
  addDocumentAction, addItemAction, addWarrantyAction, decideCompletionAction, defectWorkOrderAction, fixDefectAction, raiseDefectAction, recordHandoverAction,
  removeWarrantyAction, requestCompletionAction, tickItemAction, verifyDefectAction, withdrawCompletionAction,
} from "./actions";

export const metadata = { title: "Completion and handover" };

const defectTone = (s: string) => (s === "OVERDUE" ? "OVERDUE" : s === "CLOSED" ? "DONE" : s === "AWAITING_VERIFICATION" ? "HIGH" : "OPEN");
const warrantyTone = (s: string) => (s === "EXPIRED" ? "CANCELLED" : s === "EXPIRING" ? "HIGH" : s === "NOT_STARTED" ? "PENDING" : "DONE");

export default async function HandoverPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("project.view");
  const d = await getProjectHandover(member, params.id);
  if (!d) notFound();
  const p = d.project;
  const plan = can(member.role, "project.plan");
  const manage = can(member.role, "project.manage");
  const approve = can(member.role, "project.approve");
  const maint = can(member.role, "maintenance.request");
  const active = p.status === "ACTIVE";
  const completed = p.status === "COMPLETED";
  const handedOver = !!p.handoverOn;
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  const who = (id: string | null) => (id ? d.names[id] ?? "Unknown user" : "—");
  const pkg = (id: string | null) => { const w = d.packages.find((x) => x.id === id); return w ? `${w.code} ${w.title}` : "Whole project"; };
  const today = toDateOnlyString(todayInLagos());
  const openDefects = d.defects.filter((x) => x.status !== "VERIFIED").length;
  const ticked = d.items.filter((i) => i.done).length;
  const requested = !!p.completionRequestedById;
  const iRequested = p.completionRequestedById === member.userId;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href={`/app/projects/${p.id}`}>{p.ref} · {p.title}</Link></p>
        <h1>Completion and handover</h1>
        <p className="muted">Finish the works, record and clear defects, keep warranties and papers with the asset, and hand the project over.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <section className="stats" aria-label="Where this stands">
        <div className="stat"><b>{humanize(p.status)}</b><span>Project status</span></div>
        <div className="stat"><b>{p.completedAt ? formatDate(p.completedAt) : "—"}</b><span>Completed</span></div>
        <div className="stat"><b>{p.defectsPeriodEnd ? formatDate(p.defectsPeriodEnd) : "—"}</b><span>Defects period ends</span></div>
        <div className="stat"><b>{handedOver ? formatDate(p.handoverOn) : "Not yet"}</b><span>Handed over</span></div>
      </section>

      <section className="card stack">
        <details className="inline" open={active || undefined}>
          <summary><strong>Completion</strong> <span className="small muted">({completed ? "completed" : requested ? "waiting for a decision" : active ? "not yet requested" : humanize(p.status).toLowerCase()})</span></summary>
          {completed ? (
            <p>Completed on {formatDate(p.completedAt)}, approved by {who(p.completedById)}, requested by {who(p.completionRequestedById)}.</p>
          ) : !active ? (
            <p className="muted">Only an active project can be put forward for completion.</p>
          ) : (
            <>
              {d.readiness.blocks.length > 0 ? (
                <div className="stack" style={{ gap: 4 }}>
                  <strong className="small">Still to do before completion</strong>
                  <ShowMore noun="more" limit={3} items={d.readiness.blocks.map((b, i) => <li key={i}>{b}</li>)} />
                </div>
              ) : <p>Everything needed for completion is in place.</p>}
              {d.readiness.warnings.map((w, i) => <p key={i} className="small muted">Note: {w}</p>)}
              {requested ? (
                <div className="stack">
                  <p>Completion was requested by {who(p.completionRequestedById)}{p.completionNote ? `: ${p.completionNote}` : "."} Defects period: {p.defectsMonths} months.</p>
                  {iRequested ? <p className="small muted">You asked for this, so someone else must approve it.</p> : null}
                  {iRequested && plan ? <form action={withdrawCompletionAction}>{hidden}<button className="btn" type="submit">Withdraw request</button></form> : null}
                  {approve && !iRequested ? (
                    <form action={decideCompletionAction} className="stack">
                      {hidden}
                      <Field label="Note" hint="Required if you do not accept completion."><input name="note" /></Field>
                      <div className="row">
                        <button className="btn primary" type="submit" name="decision" value="approve">Approve completion</button>
                        <button className="btn" type="submit" name="decision" value="reject">Do not accept</button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : plan ? (
                <form action={requestCompletionAction} className="stack">
                  {hidden}
                  <div className="fields">
                    <Field label="Defects period (months)" hint="0 to 60. Normally 12."><input name="defectsMonths" inputMode="numeric" defaultValue="12" /></Field>
                  </div>
                  <Field label="Note"><input name="note" /></Field>
                  <button className="btn primary" type="submit" disabled={d.readiness.blocks.length > 0}>Request completion</button>
                </form>
              ) : null}
            </>
          )}
        </details>
      </section>

      <section className="card stack">
        <details className="inline" open={d.defects.some((x) => x.state === "OVERDUE") ? true : undefined}>
          <summary><strong>Defects</strong> <span className="small muted">({d.defects.length}{openDefects ? `, ${openDefects} not cleared` : ""})</span></summary>
          {d.defects.length === 0 ? <p className="muted">No defects recorded.</p> : (
            <ShowMore noun="more defects" limit={4} items={d.defects.map((x) => (
              <li key={x.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{x.ref}</strong> {x.title}<div className="small muted">{humanize(x.severity)} · {pkg(x.workPackageId)} · raised {formatDate(x.raisedOn)} by {who(x.raisedById)}{x.dueOn ? ` · due ${formatDate(x.dueOn)}` : ""}</div></div>
                  <Pill status={defectTone(x.state)} label={humanize(x.state)} />
                </div>
                {x.description ? <div className="small">{x.description}</div> : null}
                {x.fixNote ? <div className="small">Fix: {x.fixNote} ({who(x.fixedById)}, {formatDate(x.fixedOn)})</div> : null}
                {x.verifyNote ? <div className="small muted">{x.status === "VERIFIED" ? "Verified" : "Sent back"}: {x.verifyNote}</div> : null}
                {x.workOrderId ? <div className="small"><Link href={`/app/maintenance/${x.workOrderId}`}>Maintenance work order</Link></div> : null}
                {plan && x.status === "OPEN" && d.raisable ? (
                  <details className="inline"><summary>Mark as fixed</summary>
                    <form action={fixDefectAction} className="stack">{hidden}<input type="hidden" name="defectId" value={x.id} /><Field label="What was done"><input name="note" required /></Field><button className="btn" type="submit">Mark as fixed</button></form>
                  </details>
                ) : null}
                {plan && x.status === "FIXED" ? (
                  x.fixedById === member.userId ? <p className="small muted">You fixed this, so someone else must verify it.</p> : (
                    <details className="inline"><summary>Verify the fix</summary>
                      <form action={verifyDefectAction} className="stack">{hidden}<input type="hidden" name="defectId" value={x.id} /><Field label="Note" hint="Required if you send it back."><input name="note" /></Field>
                        <div className="row"><button className="btn primary" type="submit" name="decision" value="verify">Verify</button><button className="btn" type="submit" name="decision" value="reject">Send back</button></div>
                      </form>
                    </details>
                  )
                ) : null}
                {maint && !x.workOrderId && x.status !== "VERIFIED" ? <form action={defectWorkOrderAction}>{hidden}<input type="hidden" name="defectId" value={x.id} /><button className="btn" type="submit">Raise a maintenance work order</button></form> : null}
              </div></li>
            ))} />
          )}
          {plan && d.raisable ? (
            <details className="inline"><summary>Raise a defect</summary>
              <form action={raiseDefectAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Defect"><input name="title" required /></Field>
                  <Field label="Severity"><select name="severity" defaultValue="MEDIUM"><EnumOptions values={DEFECT_SEVERITIES} /></select></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">Whole project</option>{d.packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                  <Field label="Fix by"><input name="dueOn" type="date" min={today} /></Field>
                </div>
                <Field label="Details"><input name="description" /></Field>
                <button className="btn" type="submit">Raise defect</button>
              </form>
            </details>
          ) : <p className="small muted">New defects cannot be raised on this project now.</p>}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Warranties</strong> <span className="small muted">({d.warranties.length})</span></summary>
          <p className="small muted">Warranties are linked to the asset, so maintenance can see when a repair may be covered.</p>
          {d.warranties.length === 0 ? <p className="muted">No warranties recorded.</p> : (
            <ShowMore noun="more warranties" limit={4} items={d.warranties.map((w) => (
              <li key={w.id}><div className="row between" style={{ width: "100%" }}>
                <div><strong>{w.title}</strong> · {w.provider}<div className="small muted">{formatDate(w.startsOn)} to {formatDate(w.endsOn)}{w.coverage ? ` · ${w.coverage}` : ""}</div></div>
                <div className="row"><Pill status={warrantyTone(w.state)} label={humanize(w.state)} />{manage ? <form action={removeWarrantyAction}>{hidden}<input type="hidden" name="warrantyId" value={w.id} /><button className="btn" type="submit">Remove</button></form> : null}</div>
              </div></li>
            ))} />
          )}
          {plan && ["ACTIVE", "ON_HOLD", "COMPLETED"].includes(p.status) ? (
            <details className="inline"><summary>Add a warranty</summary>
              <form action={addWarrantyAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="What it covers"><input name="title" required /></Field>
                  <Field label="Given by"><input name="provider" required /></Field>
                  <Field label="Starts"><input name="startsOn" type="date" required defaultValue={today} /></Field>
                  <Field label="Ends"><input name="endsOn" type="date" required /></Field>
                  <Field label="Document"><select name="documentId" defaultValue=""><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
                </div>
                <Field label="Cover and conditions"><input name="coverage" /></Field>
                <button className="btn" type="submit">Add warranty</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline">
          <summary><strong>Documents</strong> <span className="small muted">({d.documents.length})</span></summary>
          {d.documents.length === 0 ? <p className="muted">No documents yet.</p> : (
            <ShowMore noun="more documents" limit={5} items={d.documents.map((x) => (
              <li key={x.id}><div className="row between" style={{ width: "100%" }}>
                <div><a href={`/app/project-docs/${x.id}`}>{x.title}</a><div className="small muted">{humanize(x.kind)} · {x.fileName} · {formatDate(x.createdAt)} · {who(x.uploadedById)}</div></div>
              </div></li>
            ))} />
          )}
          {plan && p.status !== "CANCELLED" ? (
            <details className="inline"><summary>Add a document</summary>
              <form action={addDocumentAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Title"><input name="title" required /></Field>
                  <Field label="Kind"><select name="kind" defaultValue="OTHER"><EnumOptions values={DOC_KINDS} /></select></Field>
                </div>
                <Field label="File" hint="PDF, JPG, PNG or WEBP, up to 4 MB."><input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></Field>
                <button className="btn" type="submit">Add document</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack">
        <details className="inline" open={completed && !handedOver ? true : undefined}>
          <summary><strong>Handover</strong> <span className="small muted">({handedOver ? "handed over" : completed ? `${ticked} of ${d.items.length} ticked` : "after completion"})</span></summary>
          {!completed ? <p className="muted">The handover checklist appears once the project is completed.</p> : (
            <>
              <ShowMore noun="more items" limit={5} items={d.items.map((i) => (
                <li key={i.id}><div className="row between" style={{ width: "100%" }}>
                  <div>{i.done ? "✓ " : ""}{i.title}{i.done ? <div className="small muted">{who(i.doneById)} on {formatDate(i.doneOn)}{i.note ? ` · ${i.note}` : ""}</div> : null}</div>
                  {plan && !handedOver ? (
                    <form action={tickItemAction} className="row">
                      {hidden}<input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="done" value={i.done ? "no" : "yes"} />
                      <button className="btn" type="submit">{i.done ? "Un-tick" : "Tick"}</button>
                    </form>
                  ) : null}
                </div></li>
              ))} />
              {plan && !handedOver ? (
                <details className="inline"><summary>Add a checklist item</summary>
                  <form action={addItemAction} className="stack">{hidden}<Field label="Item"><input name="title" required /></Field><button className="btn" type="submit">Add item</button></form>
                </details>
              ) : null}
              {handedOver ? (
                <p>Handed over to {p.handedToName} on {formatDate(p.handoverOn)}, recorded by {who(p.handoverById)}.{p.handoverNote ? ` ${p.handoverNote}` : ""}</p>
              ) : (
                <>
                  {d.handoverProblems.length > 0 ? <ShowMore noun="more" limit={3} items={d.handoverProblems.map((m, i) => <li key={i}>{m}</li>)} /> : null}
                  {manage ? (
                    <details className="inline"><summary>Record the handover</summary>
                      <form action={recordHandoverAction} className="stack">
                        {hidden}
                        <div className="fields">
                          <Field label="Handed over to"><input name="handedTo" required /></Field>
                          <Field label="Date"><input name="handoverOn" type="date" max={today} defaultValue={today} /></Field>
                        </div>
                        <Field label="Note"><input name="note" /></Field>
                        <button className="btn primary" type="submit">Record handover</button>
                      </form>
                    </details>
                  ) : <p className="small muted">A manager records the handover once the checklist is complete.</p>}
                </>
              )}
            </>
          )}
        </details>
      </section>
    </div>
  );
}
