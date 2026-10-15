import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listInspections, PURPOSES } from "@/lib/services/inspections";
import { formatDate, toDateOnlyString } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { scheduleInspectionAction } from "./actions";

export const metadata = { title: "Inspections" };

export default async function InspectionsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const d = await listInspections(member);
  const row = (i: (typeof d.overdue)[number]) => (
    <li key={i.id}>
      <div className="row between" style={{ width: "100%" }}>
        <div>
          <Link href={`/app/inspections/${i.id}`}><strong>{i.ref}</strong></Link> · {i.asset.name}
          <div className="small muted">{humanize(i.purpose)} · {formatDate(i.scheduledFor)} · {i.inspectorId ? d.names[i.inspectorId] ?? "Inspector" : "No inspector yet"}{i.conditionRating ? ` · ${humanize(i.conditionRating)}` : ""}</div>
        </div>
        <Pill status={i.status === "SUBMITTED" ? "PENDING" : i.scheduledFor < d.today ? "OVERDUE" : "OPEN"} label={i.status === "SUBMITTED" ? "Awaiting approval" : i.scheduledFor < d.today ? "Overdue" : "Scheduled"} />
      </div>
    </li>
  );
  const block = (title: string, items: typeof d.overdue, empty: string) => (
    <section className="card"><h2>{title}</h2>{items.length === 0 ? <p className="muted small">{empty}</p> : <ul className="timeline">{items.map(row)}</ul>}</section>
  );
  const todayText = toDateOnlyString(d.today);

  return (
    <div className="stack-lg">
      <div className="row between">
        <div className="stack" style={{ gap: 6 }}>
          <h1>Inspections</h1>
          <p className="muted">Schedule, record and approve inspections. An approved inspection becomes part of the asset's condition history.</p>
        </div>
        <Link className="btn" href="/app/inspections/templates">Templates ({d.templates.length})</Link>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {block("Overdue", d.overdue, "Nothing is overdue.")}
      {block("Awaiting approval", d.awaiting, "Nothing is waiting for approval.")}
      {block("Scheduled", d.scheduled, "Nothing is scheduled.")}
      <section className="card">
        <h2>Recently closed</h2>
        {d.recent.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="timeline">
            {d.recent.map((i) => (
              <li key={i.id}><div><Link href={`/app/inspections/${i.id}`}>{i.ref}</Link> · {i.asset.name}<div className="small muted">{humanize(i.purpose)} · {i.conductedOn ? formatDate(i.conductedOn) : formatDate(i.scheduledFor)}{i.conditionRating ? ` · ${humanize(i.conditionRating)}` : ""} · {humanize(i.status)}</div></div></li>
            ))}
          </ul>
        )}
      </section>
      {can(member.role, "inspection.manage") ? (
        <section className="card" aria-labelledby="sched-h">
          <h2 id="sched-h">Schedule an inspection</h2>
          {d.assets.length === 0 ? <p className="muted">Register an asset first.</p> : (
            <form action={scheduleInspectionAction} className="stack">
              <div className="fields">
                <Field label="Asset"><select name="assetId" required defaultValue={sp(searchParams, "assetId") ?? ""}>{d.assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
                <Field label="Purpose"><select name="purpose" defaultValue="ROUTINE"><EnumOptions values={PURPOSES} /></select></Field>
              </div>
              <div className="fields">
                <Field label="Checklist template"><select name="templateId" defaultValue=""><option value="">No checklist</option>{d.templates.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} ({t._count.items} items)</option>)}</select></Field>
                <Field label="Date"><input name="scheduledFor" type="date" required defaultValue={todayText} /></Field>
              </div>
              <div className="fields">
                <Field label="Inspector"><select name="inspectorId" defaultValue=""><option value="">Not assigned</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Responsible officer"><select name="responsibleId" defaultValue=""><option value="">Not assigned</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              </div>
              <div className="fields">
                <Field label="Location on site"><input name="location" /></Field>
                <Field label="Other participants"><input name="participants" /></Field>
              </div>
              <Field label="Repeat every (months)" hint="Blank for a one-off. The next inspection is scheduled when this one is approved."><input name="recurrenceMonths" inputMode="numeric" /></Field>
              <button className="btn primary" type="submit">Schedule</button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
