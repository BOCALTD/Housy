import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getProject } from "@/lib/services/project";
import { WORK_STATUSES } from "@/lib/project-rules";
import { formatKobo } from "@/lib/money";
import { formatDate, toDateOnlyString, todayInLagos } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import {
  achieveMilestoneAction, addMilestoneAction, addPackageAction, cancelAction, decideBudgetAction, decideCommitmentAction, decideInvoiceAction, decideVariationAction,
  forecastAction, holdAction, payInvoiceAction, progressAction, recordInvoiceAction, removeMilestoneAction, removePackageAction, requestCommitmentAction,
  requestVariationAction, resumeAction, startAction, submitBudgetAction, updatePackageAction, updateProjectAction,
} from "../actions";

export const metadata = { title: "Project" };

const stateTone = (s: string) => (s === "DONE" ? "DONE" : s === "LATE" ? "OVERDUE" : s === "BEHIND" || s === "BLOCKED" ? "HIGH" : "OPEN");
const nairaInput = (k: bigint) => `${k / 100n}.${String(k % 100n).padStart(2, "0")}`;

export default async function ProjectPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("project.view");
  const data = await getProject(member, params.id);
  if (!data) notFound();
  const { project: p, packages, milestones, commitments, invoices, variations, forecasts, names, contractors, members, cost, contractSums, states, progress, lateMilestones } = data;
  const manage = can(member.role, "project.manage");
  const plan = can(member.role, "project.plan");
  const money = can(member.role, "project.cost");
  const approve = can(member.role, "project.approve");
  const open = ["PLANNING", "ACTIVE", "ON_HOLD"].includes(p.status);
  const active = p.status === "ACTIVE";
  const hidden = <input type="hidden" name="projectId" value={p.id} />;
  const who = (id: string | null) => (id ? names[id] ?? "Unknown user" : "—");
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Not assigned";
  const pkgName = (id: string | null) => { const w = packages.find((x) => x.id === id); return w ? `${w.code} ${w.title}` : "General"; };
  const today = todayInLagos();
  const pendingCommitments = commitments.filter((c) => c.status === "PENDING");
  const pendingInvoices = invoices.filter((i) => i.status === "RECEIVED");
  const pendingVariations = variations.filter((v) => v.status === "PENDING");
  const approvedCommitments = commitments.filter((c) => c.status === "APPROVED");
  const decideForm = (action: (f: FormData) => Promise<never>, idName: string, id: string, ownId: string, needs: string) => (
    ownId === member.userId ? <p className="small muted">You {needs}, so someone else must decide.</p> : (
      <form action={action} className="stack">
        {hidden}<input type="hidden" name={idName} value={id} />
        <Field label="Note" hint="Required if you reject."><input name="note" /></Field>
        <div className="row"><button className="btn primary" type="submit" name="decision" value="approve">Approve</button><button className="btn" type="submit" name="decision" value="reject">Reject</button></div>
      </form>
    )
  );

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/projects">All projects</Link> · <Link href={`/app/assets/${p.asset.id}`}>{p.asset.ref} · {p.asset.name}</Link></p>
        <div className="row between">
          <div>
            <p className="eyebrow mono">{p.ref}</p>
            <h1>{p.title}</h1>
            <p className="muted">{humanize(p.kind)} · {formatDate(p.plannedStart)} to {formatDate(p.plannedEnd)} · manager {memberName(p.managerId)}</p>
          </div>
          <div className="row">{cost.overBudget && p.status !== "PLANNING" ? <Pill status="OVERDUE" label="Forecast over budget" /> : null}<Pill status={p.status} label={humanize(p.status)} /></div>
        </div>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <p className="small"><Link href={`/app/projects/${p.id}/delivery`}>Delivery: contractors, materials, risks, site inspections and quality checks</Link></p>
      <p className="small"><Link href={`/app/projects/${p.id}/handover`}>Completion and handover: defects, warranties, documents and handover</Link></p>

      <section className="stats" aria-label="Cost and progress">
        <div className="stat"><b>{progress}%</b><span>Complete</span></div>
        <div className="stat"><b>{formatKobo(cost.budgetKobo)}</b><span>{p.budgetStatus === "APPROVED" ? "Approved budget" : "Draft budget"}</span></div>
        <div className="stat"><b>{formatKobo(cost.committedKobo)}</b><span>Committed</span></div>
        <div className="stat"><b>{formatKobo(cost.invoicedKobo)}</b><span>Invoiced (approved)</span></div>
        <div className="stat"><b>{formatKobo(cost.forecastKobo)}</b><span>Forecast at completion</span></div>
        <div className={`stat${cost.varianceKobo < 0n ? " alert" : ""}`}><b>{formatKobo(cost.varianceKobo)}</b><span>{cost.varianceKobo < 0n ? "Over budget" : "Under budget"}</span></div>
      </section>
      {p.status === "ON_HOLD" ? <div className="flash notice" role="status">On hold: {p.holdReason}</div> : null}
      {p.status === "CANCELLED" ? <div className="flash error" role="alert">Cancelled: {p.cancelReason}</div> : null}
      {lateMilestones > 0 ? <div className="flash error" role="alert">{lateMilestones} milestone{lateMilestones === 1 ? " is" : "s are"} overdue.</div> : null}

      {manage && open ? (
        <section className="card stack" aria-label="Project controls">
          <div className="row">
            {p.status === "PLANNING" ? <form action={startAction}>{hidden}<button className="btn primary" type="submit">Start project</button></form> : null}
            {p.status === "ON_HOLD" ? <form action={resumeAction}>{hidden}<button className="btn primary" type="submit">Resume</button></form> : null}
          </div>
          {active ? <details className="inline"><summary>Put on hold</summary><form action={holdAction} className="stack">{hidden}<Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Put on hold</button></form></details> : null}
          <details className="inline"><summary>Edit the project</summary>
            <form action={updateProjectAction} className="stack">
              {hidden}
              <div className="fields">
                <Field label="Title"><input name="title" required defaultValue={p.title} /></Field>
                <Field label="Project manager"><select name="managerId" defaultValue={p.managerId ?? ""}><option value="">Not assigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Planned start"><input name="plannedStart" type="date" required defaultValue={toDateOnlyString(p.plannedStart)} /></Field>
                <Field label="Planned end"><input name="plannedEnd" type="date" required defaultValue={toDateOnlyString(p.plannedEnd)} /></Field>
                <Field label="Contingency (₦)"><input name="contingency" inputMode="decimal" defaultValue={nairaInput(p.contingencyKobo)} /></Field>
              </div>
              <Field label="Description"><textarea name="description" rows={3} defaultValue={p.description} /></Field>
              <button className="btn" type="submit">Save</button>
            </form>
          </details>
          <details className="inline"><summary>Cancel the project</summary><form action={cancelAction} className="stack">{hidden}<Field label="Reason"><input name="reason" required /></Field><button className="btn" type="submit">Cancel project</button></form></details>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="bud-h">
        <details className="inline" open={p.budgetStatus === "SUBMITTED" && approve ? true : undefined}>
          <summary id="bud-h"><strong>Budget approval</strong> <span className="small muted">({humanize(p.budgetStatus)})</span></summary>
          <p className="small">Work package budgets {formatKobo(cost.packages.filter((x) => x.id).reduce((a, x) => a + x.budgetKobo, 0n))} plus contingency {formatKobo(p.contingencyKobo)}. {p.budgetStatus === "APPROVED" ? `Approved budget ${formatKobo(p.approvedBudgetKobo ?? 0n)} by ${who(p.budgetDecidedById)}.` : ""}</p>
          {p.budgetNote ? <p className="small muted">Note: {p.budgetNote}</p> : null}
          {p.budgetStatus === "DRAFT" && plan && p.status === "PLANNING" ? <form action={submitBudgetAction}>{hidden}<button className="btn primary" type="submit">Send budget for approval</button></form> : null}
          {p.budgetStatus === "SUBMITTED" ? <p className="small muted">Submitted by {who(p.budgetSubmittedById)}.</p> : null}
          {p.budgetStatus === "SUBMITTED" && approve ? decideForm(decideBudgetAction, "projectId", p.id, p.budgetSubmittedById ?? "", "submitted this budget") : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="wp-h">
        <details className="inline">
          <summary id="wp-h"><strong>Work packages</strong> <span className="small muted">({packages.length})</span></summary>
          <ShowMore noun="more work packages" limit={4} items={packages.map((w) => {
            const c = cost.packages.find((x) => x.id === w.id);
            return (
              <li key={w.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{w.code}</strong> {w.title}<div className="small muted">{formatDate(w.plannedStart)} to {formatDate(w.plannedEnd)} · {memberName(w.responsibleId)}</div></div>
                  <div className="row"><Pill status={stateTone(states[w.id])} label={humanize(states[w.id])} /><strong>{w.percentComplete}%</strong></div>
                </div>
                {c ? <div className="small muted">Budget {formatKobo(w.budgetKobo)} · committed {formatKobo(c.committedKobo)} · invoiced {formatKobo(c.invoicedKobo)} · forecast {formatKobo(c.forecastKobo)}{c.overrunKobo > 0n ? ` · over by ${formatKobo(c.overrunKobo)}` : ""}</div> : null}
                {plan && active ? (
                  <details className="inline"><summary>Update progress</summary>
                    <form action={progressAction} className="stack">
                      {hidden}<input type="hidden" name="packageId" value={w.id} />
                      <div className="fields">
                        <Field label="Status"><select name="status" defaultValue={w.status}>{WORK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
                        <Field label="Percent complete"><input name="percent" inputMode="numeric" defaultValue={w.percentComplete} /></Field>
                      </div>
                      <Field label="Note" hint="Required if blocked."><input name="note" /></Field>
                      <button className="btn" type="submit">Save progress</button>
                    </form>
                  </details>
                ) : null}
                {money && active ? (
                  <details className="inline"><summary>Forecast the cost to complete</summary>
                    <form action={forecastAction} className="stack">
                      {hidden}<input type="hidden" name="packageId" value={w.id} />
                      <Field label="Estimate to complete (₦)" hint={c?.etcKobo !== null && c?.etcKobo !== undefined ? `Currently ${formatKobo(c.etcKobo)}.` : "Not yet forecast."}><input name="etc" inputMode="decimal" required /></Field>
                      <Field label="Basis"><input name="note" /></Field>
                      <button className="btn" type="submit">Record forecast</button>
                    </form>
                  </details>
                ) : null}
                {plan && open ? (
                  <details className="inline"><summary>Edit or remove</summary>
                    <form action={updatePackageAction} className="stack">
                      {hidden}<input type="hidden" name="packageId" value={w.id} />
                      <div className="fields">
                        <Field label="Title"><input name="title" required defaultValue={w.title} /></Field>
                        <Field label="Responsible"><select name="responsibleId" defaultValue={w.responsibleId ?? ""}><option value="">Not assigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                        <Field label="Contractor"><select name="contractorId" defaultValue={w.contractorId ?? ""}><option value="">None</option>{contractors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                        <Field label="Start"><input name="plannedStart" type="date" required defaultValue={toDateOnlyString(w.plannedStart)} /></Field>
                        <Field label="End"><input name="plannedEnd" type="date" required defaultValue={toDateOnlyString(w.plannedEnd)} /></Field>
                        <Field label="Budget (₦)" hint={p.budgetStatus === "DRAFT" ? undefined : "Locked once the budget is submitted."}><input name="budget" inputMode="decimal" defaultValue={nairaInput(w.budgetKobo)} /></Field>
                      </div>
                      <Field label="Description"><input name="description" defaultValue={w.description} /></Field>
                      <button className="btn" type="submit">Save</button>
                    </form>
                    {p.budgetStatus === "DRAFT" ? <form action={removePackageAction} style={{ marginTop: 8 }}>{hidden}<input type="hidden" name="packageId" value={w.id} /><button className="btn" type="submit">Remove work package</button></form> : null}
                  </details>
                ) : null}
              </div></li>
            );
          })} />
          {packages.length === 0 ? <p className="muted">No work packages yet.</p> : null}
          {plan && open ? (
            <details className="inline"><summary>Add a work package</summary>
              <form action={addPackageAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Title"><input name="title" required /></Field>
                  <Field label="Responsible"><select name="responsibleId" defaultValue=""><option value="">Not assigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                  <Field label="Contractor"><select name="contractorId" defaultValue=""><option value="">None</option>{contractors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                  <Field label="Start"><input name="plannedStart" type="date" required defaultValue={toDateOnlyString(p.plannedStart)} /></Field>
                  <Field label="End"><input name="plannedEnd" type="date" required defaultValue={toDateOnlyString(p.plannedEnd)} /></Field>
                  <Field label="Budget (₦)" hint={p.budgetStatus === "DRAFT" ? undefined : "The budget is submitted, so new packages start at zero."}><input name="budget" inputMode="decimal" defaultValue={p.budgetStatus === "DRAFT" ? "" : "0"} /></Field>
                </div>
                <Field label="Description"><input name="description" /></Field>
                <button className="btn" type="submit">Add work package</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="ms-h">
        <details className="inline">
          <summary id="ms-h"><strong>Milestones</strong> <span className="small muted">({milestones.filter((m) => m.achievedOn).length} of {milestones.length} achieved)</span></summary>
          {milestones.length === 0 ? <p className="muted">No milestones yet.</p> : (
            <ShowMore noun="more milestones" limit={5} items={milestones.map((m) => (
              <li key={m.id}><div className="row between" style={{ width: "100%" }}>
                <div>{m.title}<div className="small muted">Due {formatDate(m.dueOn)}{m.workPackageId ? ` · ${pkgName(m.workPackageId)}` : ""}{m.achievedOn ? ` · achieved ${formatDate(m.achievedOn)} (${who(m.achievedById)})` : ""}</div></div>
                <div className="row">
                  {m.achievedOn ? <Pill status="DONE" label="Achieved" /> : m.dueOn.getTime() < today.getTime() ? <Pill status="OVERDUE" label="Overdue" /> : <Pill status="OPEN" label="Open" />}
                  {plan && active && !m.achievedOn ? <form action={achieveMilestoneAction}>{hidden}<input type="hidden" name="milestoneId" value={m.id} /><button className="btn" type="submit">Achieved</button></form> : null}
                  {plan && open && !m.achievedOn ? <form action={removeMilestoneAction}>{hidden}<input type="hidden" name="milestoneId" value={m.id} /><button className="btn" type="submit">Remove</button></form> : null}
                </div>
              </div></li>
            ))} />
          )}
          {plan && open ? (
            <details className="inline"><summary>Add a milestone</summary>
              <form action={addMilestoneAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Milestone"><input name="title" required /></Field>
                  <Field label="Due"><input name="dueOn" type="date" required /></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">Whole project</option>{packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                </div>
                <button className="btn" type="submit">Add milestone</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="cm-h">
        <details className="inline" open={approve && pendingCommitments.length > 0 ? true : undefined}>
          <summary id="cm-h"><strong>Commitments</strong> <span className="small muted">({approvedCommitments.length} approved{pendingCommitments.length ? `, ${pendingCommitments.length} waiting` : ""})</span></summary>
          {commitments.length === 0 ? <p className="muted">Nothing committed yet.</p> : (
            <ShowMore noun="more commitments" limit={4} items={commitments.map((c) => (
              <li key={c.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{c.ref}</strong> · {c.supplierName}<div className="small muted">{c.description} · {pkgName(c.workPackageId)}</div></div>
                  <div className="row"><strong>{formatKobo(c.status === "APPROVED" ? contractSums[c.id] ?? c.amountKobo : c.amountKobo)}</strong><Pill status={c.status} label={humanize(c.status)} /></div>
                </div>
                <div className="small muted">Requested by {who(c.requestedById)}{c.decidedById ? ` · decided by ${who(c.decidedById)}` : ""}{c.decisionNote ? ` · ${c.decisionNote}` : ""}{c.status === "APPROVED" && (contractSums[c.id] ?? c.amountKobo) !== c.amountKobo ? ` · original ${formatKobo(c.amountKobo)}` : ""}</div>
                {c.status === "PENDING" && approve ? decideForm(decideCommitmentAction, "commitmentId", c.id, c.requestedById, "requested this") : null}
              </div></li>
            ))} />
          )}
          {money && active ? (
            <details className="inline"><summary>Request a commitment</summary>
              <form action={requestCommitmentAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Contractor"><select name="contractorId" defaultValue=""><option value="">Other supplier</option>{contractors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                  <Field label="Supplier name" hint="If not a listed contractor."><input name="supplierName" /></Field>
                  <Field label="Amount (₦)"><input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Work package"><select name="workPackageId" defaultValue=""><option value="">General</option>{packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                </div>
                <Field label="What is being bought"><input name="description" required /></Field>
                <button className="btn" type="submit">Send for approval</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="inv-h">
        <details className="inline" open={approve && pendingInvoices.length > 0 ? true : undefined}>
          <summary id="inv-h"><strong>Invoices</strong> <span className="small muted">({invoices.length}{pendingInvoices.length ? `, ${pendingInvoices.length} waiting` : ""})</span></summary>
          {invoices.length === 0 ? <p className="muted">No invoices yet.</p> : (
            <ShowMore noun="more invoices" limit={4} items={invoices.map((i) => (
              <li key={i.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{i.invoiceNo}</strong> · {i.commitment.supplierName}<div className="small muted">{i.commitment.ref} · {formatDate(i.invoiceDate)}{i.dueDate ? ` · due ${formatDate(i.dueDate)}` : ""}</div></div>
                  <div className="row"><strong>{formatKobo(i.amountKobo)}</strong><Pill status={i.status === "RECEIVED" ? "PENDING" : i.status === "PAID" ? "DONE" : i.status} label={i.status === "RECEIVED" ? "Waiting" : humanize(i.status)} /></div>
                </div>
                <div className="small muted">Recorded by {who(i.recordedById)}{i.decidedById ? ` · decided by ${who(i.decidedById)}` : ""}{i.paidOn ? ` · paid ${formatDate(i.paidOn)} by ${who(i.paidById)}` : ""}{i.decisionNote ? ` · ${i.decisionNote}` : ""}</div>
                {i.status === "RECEIVED" && approve ? decideForm(decideInvoiceAction, "invoiceId", i.id, i.recordedById, "recorded this") : null}
                {i.status === "APPROVED" && approve ? <form action={payInvoiceAction} className="row" style={{ alignItems: "flex-end" }}>{hidden}<input type="hidden" name="invoiceId" value={i.id} /><Field label="Paid on"><input name="paidOn" type="date" /></Field><button className="btn" type="submit">Mark as paid</button></form> : null}
              </div></li>
            ))} />
          )}
          {money && (active || p.status === "ON_HOLD") && approvedCommitments.length > 0 ? (
            <details className="inline"><summary>Record an invoice</summary>
              <form action={recordInvoiceAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Commitment"><select name="commitmentId" required defaultValue="">{<option value="" disabled>Choose</option>}{approvedCommitments.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.supplierName}</option>)}</select></Field>
                  <Field label="Invoice number"><input name="invoiceNo" required /></Field>
                  <Field label="Invoice date"><input name="invoiceDate" type="date" required /></Field>
                  <Field label="Due date"><input name="dueDate" type="date" /></Field>
                  <Field label="Amount (₦)"><input name="amount" inputMode="decimal" required /></Field>
                </div>
                <button className="btn" type="submit">Record invoice</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="var-h">
        <details className="inline" open={approve && pendingVariations.length > 0 ? true : undefined}>
          <summary id="var-h"><strong>Variations</strong> <span className="small muted">({variations.length}{pendingVariations.length ? `, ${pendingVariations.length} waiting` : ""})</span></summary>
          {variations.length === 0 ? <p className="muted">No variations.</p> : (
            <ShowMore noun="more variations" limit={4} items={variations.map((v) => (
              <li key={v.id}><div className="stack" style={{ gap: 6, width: "100%" }}>
                <div className="row between">
                  <div><strong>{v.ref}</strong> · {v.title}<div className="small muted">{v.target === "BUDGET" ? "Changes the budget" : `Changes ${commitments.find((c) => c.id === v.commitmentId)?.ref ?? "a commitment"}`}{v.timeImpactDays ? ` · adds ${v.timeImpactDays} day${v.timeImpactDays === 1 ? "" : "s"}` : ""}</div></div>
                  <div className="row"><strong>{formatKobo(v.amountKobo)}</strong><Pill status={v.status} label={humanize(v.status)} /></div>
                </div>
                <div className="small">{v.reason}</div>
                <div className="small muted">Requested by {who(v.requestedById)}{v.decidedById ? ` · decided by ${who(v.decidedById)}` : ""}{v.decisionNote ? ` · ${v.decisionNote}` : ""}</div>
                {v.status === "PENDING" && approve ? decideForm(decideVariationAction, "variationId", v.id, v.requestedById, "requested this") : null}
              </div></li>
            ))} />
          )}
          {money && active ? (
            <details className="inline"><summary>Request a variation</summary>
              <form action={requestVariationAction} className="stack">
                {hidden}
                <div className="fields">
                  <Field label="Changes"><select name="target" defaultValue="COMMITMENT"><option value="COMMITMENT">A commitment&apos;s contract sum</option><option value="BUDGET">The project budget</option></select></Field>
                  <Field label="Commitment" hint="For a contract variation."><select name="commitmentId" defaultValue="">{<option value="">None</option>}{approvedCommitments.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.supplierName}</option>)}</select></Field>
                  <Field label="Work package" hint="For a budget variation, adds the funds to this package."><select name="workPackageId" defaultValue=""><option value="">None</option>{packages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
                  <Field label="Amount (₦)" hint="Use a minus sign for a reduction."><input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Extra days"><input name="timeImpactDays" inputMode="numeric" /></Field>
                </div>
                <Field label="Title"><input name="title" required /></Field>
                <Field label="Why the change is needed"><textarea name="reason" rows={2} required /></Field>
                <button className="btn" type="submit">Send for approval</button>
              </form>
            </details>
          ) : null}
        </details>
      </section>

      <section className="card stack" aria-labelledby="fc-h">
        <details className="inline">
          <summary id="fc-h"><strong>Forecast history</strong> <span className="small muted">({forecasts.length})</span></summary>
          {forecasts.length === 0 ? <p className="muted">No forecasts recorded.</p> : (
            <ShowMore noun="older forecasts" limit={5} items={forecasts.map((f) => <li key={f.id}>{pkgName(f.workPackageId)}: {formatKobo(f.etcKobo)} to complete<div className="small muted">{who(f.recordedById)} · {formatDate(f.createdAt)}{f.note ? ` · ${f.note}` : ""}</div></li>)} />
          )}
        </details>
      </section>
    </div>
  );
}
