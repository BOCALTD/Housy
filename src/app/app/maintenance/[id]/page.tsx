import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getWorkOrder, PRIORITIES, RISKS } from "@/lib/services/maintenance";
import { PHOTO_PHASES } from "@/lib/services/photos";
import { formatKobo } from "@/lib/money";
import { formatDate, formatDateTime, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import {
  addMaterialAction, addPhotoAction, approveAction, assignAction, cancelAction, closeAction, completeAction, progressAction,
  removeMaterialAction, reopenAction, triageAction,
} from "../actions";

export const metadata = { title: "Work order" };

const FLOW = ["REPORTED", "TRIAGED", "APPROVED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const;

function koboToInput(k: bigint | null) {
  if (k === null) return "";
  const whole = k / 100n;
  const frac = k % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
}

export default async function WorkOrderPage({ params, searchParams }: { params: { id: string }; searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const data = await getWorkOrder(member, params.id);
  if (!data) notFound();
  const { wo, photos, contractors, members, names, materialsTotal } = data;
  const todayText = toDateOnlyString(todayInLagos());
  const hidden = <input type="hidden" name="workOrderId" value={wo.id} />;
  const who = (id: string | null) => (id ? names[id] ?? "Unknown user" : "—");
  const finished = wo.status === "CLOSED" || wo.status === "CANCELLED";
  const emergency = wo.priority === "EMERGENCY";
  const isWorker = can(member.role, "maintenance.work") && (wo.assigneeId === member.membershipId || can(member.role, "maintenance.manage"));
  const manage = can(member.role, "maintenance.manage") && !finished;
  const canApprove = can(member.role, "maintenance.approve") && !finished && wo.requestedById !== member.userId;
  const before = photos.filter((p) => p.phase === "BEFORE");
  const after = photos.filter((p) => p.phase === "AFTER");
  const other = photos.filter((p) => p.phase === "EVIDENCE");
  const gallery = (list: typeof photos) => list.length === 0 ? <p className="small muted">None</p> : (
    <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
      {list.map((p) => (
        <figure key={p.id} style={{ margin: 0, width: 180 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href={`/app/photos/${p.id}`}><img src={`/app/photos/${p.id}`} alt={p.caption || `${humanize(p.phase)} photograph`} width={180} style={{ maxWidth: "100%", height: "auto", borderRadius: 8, border: "1px solid var(--line)" }} /></a>
          <figcaption className="small muted">{p.caption || humanize(p.phase)} · {formatDate(p.createdAt)}</figcaption>
        </figure>
      ))}
    </div>
  );
  const stepIndex = FLOW.indexOf(wo.status === "AWAITING_PARTS" || wo.status === "INSPECTION_REQUIRED" ? "IN_PROGRESS" : (wo.status as (typeof FLOW)[number]));

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/maintenance">All work orders</Link> · <Link href={`/app/assets/${wo.asset.id}`}>{wo.asset.ref} · {wo.asset.name}</Link></p>
        <div className="row between">
          <div>
            <p className="eyebrow mono">{wo.ref}</p>
            <h1>{wo.title}</h1>
            <p className="muted">
              Reported by {wo.requesterName || who(wo.requestedById)} · {humanize(wo.source)} · priority {humanize(wo.priority).toLowerCase()} · risk {humanize(wo.riskLevel).toLowerCase()}
              {wo.targetDate ? ` · target ${formatDate(wo.targetDate)}` : ""}
            </p>
          </div>
          <div className="row">
            <Pill status={wo.status === "CLOSED" ? "DONE" : wo.status === "CANCELLED" ? "CANCELLED" : wo.status === "COMPLETED" ? "PENDING" : "OPEN"} label={humanize(wo.status)} />
            {emergency ? <Pill status="OVERDUE" label="Emergency" /> : null}
            {wo.safetyRisk ? <Pill status="OVERDUE" label="Safety risk" /> : null}
          </div>
        </div>
        {data.warranties.length > 0 && !finished ? (
          <div className="flash notice" role="status">
            <strong>This asset has a warranty in force.</strong> Check whether this repair is covered before paying for it: {data.warranties.slice(0, 2).map((w) => `${w.title} by ${w.provider} (to ${formatDate(w.endsOn)})`).join("; ")}{data.warranties.length > 2 ? `; and ${data.warranties.length - 2} more` : ""}.
          </div>
        ) : null}
        {wo.finding ? <p className="small muted">Raised from inspection finding <Link href={`/app/inspections/${wo.finding.inspectionId}`}>{wo.finding.title}</Link></p> : null}
        {wo.schedule ? <p className="small muted">Recurring job: {wo.schedule.title}</p> : null}
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {!finished ? (
        <ol className="row" style={{ gap: 8, listStyle: "none", padding: 0, flexWrap: "wrap" }} aria-label="Progress">
          {FLOW.map((s, i) => <li key={s} className="small" style={{ fontWeight: i === stepIndex ? 700 : 400, opacity: i <= stepIndex ? 1 : 0.5 }}>{i > 0 ? "→ " : ""}{humanize(s)}</li>)}
        </ol>
      ) : null}
      {emergency && !wo.approvedById && !finished ? <div className="card" role="note">Emergency work can go ahead before approval, but its cost must be approved by someone other than the person who reported it before the order can be closed.</div> : null}
      {wo.description ? <section className="card"><h2>Reported problem</h2><p style={{ whiteSpace: "pre-wrap" }}>{wo.description}</p></section> : null}

      <section className="card stack" aria-labelledby="cost-h">
        <h2 id="cost-h">People and cost</h2>
        <div className="fields">
          <div><div className="small muted">Assigned officer</div>{wo.assignee ? wo.assignee.user.name : "—"}</div>
          <div><div className="small muted">Contractor</div>{wo.contractor ? `${wo.contractor.name}${wo.contractor.trade ? ` (${wo.contractor.trade})` : ""}` : "—"}</div>
          <div><div className="small muted">Estimated cost</div>{wo.estimatedCostKobo !== null ? formatKobo(wo.estimatedCostKobo) : "—"}</div>
          <div><div className="small muted">Approved cost</div>{wo.approvedCostKobo !== null ? `${formatKobo(wo.approvedCostKobo)} by ${who(wo.approvedById)}` : "Not yet approved"}</div>
          <div><div className="small muted">Materials recorded</div>{formatKobo(materialsTotal)}</div>
          <div><div className="small muted">Actual cost</div>{wo.actualCostKobo !== null ? formatKobo(wo.actualCostKobo) : "—"}</div>
        </div>
        {manage && wo.status === "REPORTED" ? (
          <details className="inline"><summary>Triage</summary>
            <form action={triageAction} className="stack">
              {hidden}
              <div className="fields">
                <Field label="Priority"><select name="priority" defaultValue={wo.priority}><EnumOptions values={PRIORITIES} /></select></Field>
                <Field label="Risk"><select name="riskLevel" defaultValue={wo.riskLevel}><EnumOptions values={RISKS} /></select></Field>
                <Field label="Target date"><input name="targetDate" type="date" defaultValue={wo.targetDate ? toDateOnlyString(wo.targetDate) : ""} /></Field>
              </div>
              <Field label="Estimated cost (₦)"><input name="estimatedCost" inputMode="decimal" defaultValue={koboToInput(wo.estimatedCostKobo)} /></Field>
              <label className="row" style={{ gap: 8 }}><input type="checkbox" name="safetyRisk" defaultChecked={wo.safetyRisk} /> Safety risk</label>
              <Field label="Note"><input name="note" /></Field>
              <button className="btn primary" type="submit">Mark as triaged</button>
            </form>
          </details>
        ) : null}
        {canApprove && wo.status !== "REPORTED" || (canApprove && emergency) ? (
          <details className="inline"><summary>{wo.approvedById ? "Change the approved cost" : "Approve the cost"}</summary>
            <form action={approveAction} className="stack">
              {hidden}
              <Field label="Approved cost (₦)" hint="The most this work may cost."><input name="approvedCost" required inputMode="decimal" defaultValue={koboToInput(wo.approvedCostKobo ?? wo.estimatedCostKobo)} /></Field>
              <Field label="Note"><input name="note" /></Field>
              <button className="btn primary" type="submit">Approve</button>
            </form>
          </details>
        ) : null}
        {manage && !["REPORTED", "TRIAGED"].includes(wo.status) || (manage && emergency) ? (
          wo.status === "COMPLETED" ? null : (
            <details className="inline"><summary>{wo.assigneeId || wo.contractorId ? "Reassign" : "Assign"}</summary>
              <form action={assignAction} className="stack">
                {hidden}
                <Field label="Officer"><select name="assigneeId" defaultValue={wo.assigneeId ?? ""}><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Contractor"><select name="contractorId" defaultValue={wo.contractorId ?? ""}><option value="">None</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.trade ? ` (${c.trade})` : ""}</option>)}</select></Field>
                <Field label="Target date"><input name="targetDate" type="date" defaultValue={wo.targetDate ? toDateOnlyString(wo.targetDate) : ""} /></Field>
                <button className="btn primary" type="submit">Save</button>
              </form>
            </details>
          )
        ) : null}
      </section>

      {isWorker && !finished ? (
        <section className="card stack" aria-labelledby="work-h">
          <h2 id="work-h">Work</h2>
          <div className="row">
            {(["IN_PROGRESS", "AWAITING_PARTS", "INSPECTION_REQUIRED"] as const).filter((t) => t !== wo.status).map((t) => (
              <form key={t} action={progressAction} className="row">{hidden}<input type="hidden" name="to" value={t} />
                <input name="note" placeholder={t === "IN_PROGRESS" ? "Note (optional)" : "What is needed"} aria-label={`Note for ${humanize(t)}`} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "8px 10px", background: "var(--surface)" }} />
                <button className="btn" type="submit">{t === "IN_PROGRESS" ? (wo.status === "AWAITING_PARTS" || wo.status === "INSPECTION_REQUIRED" ? "Back to work" : "Start work") : humanize(t)}</button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="mat-h">
        <h2 id="mat-h">Materials</h2>
        {wo.materials.length === 0 ? <p className="muted small">No materials recorded.</p> : (
          <ul className="timeline">
            {wo.materials.map((m) => (
              <li key={m.id}>
                <div className="row between" style={{ width: "100%" }}>
                  <div>{m.quantity} {m.unit} {m.description} <span className="small muted">@ {formatKobo(m.unitCostKobo)} = {formatKobo(BigInt(m.quantity) * m.unitCostKobo)}</span></div>
                  {isWorker && !["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status) ? <form action={removeMaterialAction}>{hidden}<input type="hidden" name="materialId" value={m.id} /><button className="btn small" type="submit">Remove</button></form> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isWorker && !["COMPLETED", "CLOSED", "CANCELLED"].includes(wo.status) ? (
          <details className="inline"><summary>Add a material</summary>
            <form action={addMaterialAction} className="stack">
              {hidden}
              <Field label="Material"><input name="description" required /></Field>
              <div className="fields">
                <Field label="Quantity"><input name="quantity" required inputMode="numeric" defaultValue="1" /></Field>
                <Field label="Unit"><input name="unit" placeholder="pcs, bags, m" /></Field>
                <Field label="Unit cost (₦)"><input name="unitCost" required inputMode="decimal" /></Field>
              </div>
              <button className="btn primary" type="submit">Add</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="ph-h">
        <h2 id="ph-h">Before and after</h2>
        <div className="two">
          <div><h3 className="small muted">Before</h3>{gallery(before)}</div>
          <div><h3 className="small muted">After</h3>{gallery(after)}</div>
        </div>
        {other.length > 0 ? <div><h3 className="small muted">Other evidence</h3>{gallery(other)}</div> : null}
        {isWorker && !finished ? (
          <details className="inline"><summary>Add a photograph</summary>
            <form action={addPhotoAction} className="stack" encType="multipart/form-data">
              {hidden}
              <Field label="Photograph"><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></Field>
              <Field label="Taken"><select name="phase" defaultValue="BEFORE"><EnumOptions values={PHOTO_PHASES} /></select></Field>
              <Field label="Caption"><input name="caption" /></Field>
              <button className="btn primary" type="submit">Upload</button>
            </form>
          </details>
        ) : null}
      </section>

      {isWorker && ["IN_PROGRESS", "INSPECTION_REQUIRED"].includes(wo.status) ? (
        <section className="card stack" aria-labelledby="done-h">
          <h2 id="done-h">Complete the work</h2>
          <form action={completeAction} className="stack">
            {hidden}
            <div className="fields">
              <Field label="Completed on"><input name="completedOn" type="date" required defaultValue={todayText} max={todayText} /></Field>
              <Field label="Actual cost (₦)"><input name="actualCost" inputMode="decimal" defaultValue={materialsTotal > 0n ? koboToInput(materialsTotal) : ""} /></Field>
            </div>
            <Field label="What was done"><textarea name="notes" rows={3} required /></Field>
            <Field label="Job card or invoice reference" hint="Needed unless you have uploaded an after photograph."><input name="evidenceRef" /></Field>
            <div className="fields">
              <Field label="Asset unavailable from" hint="Optional, for downtime."><input name="downtimeFrom" type="date" /></Field>
              <Field label="Back in use on"><input name="downtimeTo" type="date" /></Field>
            </div>
            <button className="btn primary" type="submit">Mark as completed</button>
          </form>
        </section>
      ) : null}

      {wo.status === "COMPLETED" ? (
        <section className="card stack" aria-labelledby="ver-h">
          <h2 id="ver-h">Verify and close</h2>
          <p className="small">Completed {wo.completedOn ? formatDate(wo.completedOn) : ""} by {who(wo.completedById)}: {wo.completionNotes}{wo.evidenceRef ? ` (ref ${wo.evidenceRef})` : ""}</p>
          {can(member.role, "maintenance.verify") && wo.completedById !== member.userId && wo.assignee?.userId !== member.userId ? (
            <div className="row">
              <form action={closeAction} className="row">{hidden}<input type="hidden" name="note" value="" /><button className="btn primary" type="submit">Verify and close</button></form>
              <details className="inline"><summary>Send back</summary>
                <form action={reopenAction} className="stack">{hidden}<Field label="What is still wrong"><input name="note" required /></Field><button className="btn" type="submit">Send back for more work</button></form>
              </details>
            </div>
          ) : <p className="small muted">Someone other than the person who did or recorded the work must verify it.</p>}
        </section>
      ) : null}
      {wo.status === "CLOSED" ? <p className="small muted">Verified and closed by {who(wo.verifiedById)} on {wo.closedAt ? formatDateTime(wo.closedAt) : "—"}.{wo.downtimeFrom ? ` Asset unavailable ${formatDate(wo.downtimeFrom)}${wo.downtimeTo ? ` to ${formatDate(wo.downtimeTo)}` : ""}.` : ""}</p> : null}
      {wo.status === "CANCELLED" ? <p className="small muted">Cancelled: {wo.cancelReason}</p> : null}
      {manage ? (
        <details className="inline"><summary>Cancel this work order</summary>
          <form action={cancelAction} className="stack">{hidden}<Field label="Reason"><input name="reason" required /></Field><button className="btn danger" type="submit">Cancel work order</button></form>
        </details>
      ) : null}

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">History</h2>
        <ul className="timeline">
          {[...wo.events].reverse().map((e) => (
            <li key={e.id}><div><div>{humanize(e.kind)}{e.note ? `: ${e.note}` : ""}</div><div className="small muted">{formatDateTime(e.createdAt)} · {who(e.actorId)}</div></div></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
