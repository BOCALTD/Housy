import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { listSchedules, PRIORITIES } from "@/lib/services/maintenance";
import { formatDate, todayInLagos, toDateOnlyString } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { EnumOptions, Field, Flash, Pill, ShowMore, sp, type SP } from "@/components/ui";
import { createScheduleAction, toggleScheduleAction } from "../actions";

export const metadata = { title: "Recurring maintenance" };

export default async function SchedulesPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("asset.view");
  const { schedules, assets, contractors, members, names } = await listSchedules(member);
  const manage = can(member.role, "maintenance.manage");
  const todayText = toDateOnlyString(todayInLagos());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <p className="small"><Link href="/app/maintenance">All work orders</Link></p>
        <h1>Recurring maintenance</h1>
        <p className="muted">A recurring job creates a work order ahead of each due date. Use "Create work orders that are due" on the maintenance page to bring them in.</p>
      </div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card">
        {schedules.length === 0 ? <p className="muted">No recurring jobs yet.</p> : (
          <ShowMore noun="more" limit={5} items={schedules.map((s) => (
              <li key={s.id}>
                <div className="row between" style={{ width: "100%" }}>
                  <div>
                    <strong>{s.title}</strong> <span className="small muted">{s.asset.ref} · {s.asset.name}</span>
                    <div className="small muted">Every {s.intervalMonths} month{s.intervalMonths === 1 ? "" : "s"} · next due {formatDate(s.nextDueOn)} · created {s.leadDays} days ahead{s.assigneeId ? ` · ${names[s.assigneeId] ?? "officer"}` : ""}{s.contractor ? ` · ${s.contractor.name}` : ""}</div>
                  </div>
                  <div className="row">
                    <Pill status={s.active ? "ACTIVE" : "CANCELLED"} label={s.active ? "Running" : "Paused"} />
                    {manage ? <form action={toggleScheduleAction}><input type="hidden" name="scheduleId" value={s.id} /><input type="hidden" name="active" value={s.active ? "false" : "true"} /><button className="btn small" type="submit">{s.active ? "Pause" : "Resume"}</button></form> : null}
                  </div>
                </div>
              </li>
            ))} />
        )}
      </section>
      {manage ? (
        <section className="card">
          <h2>Add a recurring job</h2>
          {assets.length === 0 ? <p className="muted">Register an asset first.</p> : (
            <form action={createScheduleAction} className="stack">
              <div className="fields">
                <Field label="Asset"><select name="assetId" required>{assets.map((a) => <option key={a.id} value={a.id}>{a.ref} · {a.name}</option>)}</select></Field>
                <Field label="Job"><input name="title" required placeholder="For example: Generator service" /></Field>
              </div>
              <Field label="Details"><textarea name="description" rows={2} /></Field>
              <div className="fields">
                <Field label="Repeat every (months)"><input name="intervalMonths" required inputMode="numeric" /></Field>
                <Field label="Next due"><input name="nextDueOn" type="date" required defaultValue={todayText} /></Field>
                <Field label="Create it this many days ahead"><input name="leadDays" inputMode="numeric" defaultValue="14" /></Field>
              </div>
              <div className="fields">
                <Field label="Priority"><select name="priority" defaultValue="NORMAL"><EnumOptions values={PRIORITIES} /></select></Field>
                <Field label="Officer"><select name="assigneeId" defaultValue=""><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Contractor"><select name="contractorId" defaultValue=""><option value="">None</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              </div>
              <Field label="Estimated cost (₦)"><input name="estimatedCost" inputMode="decimal" /></Field>
              <button className="btn primary" type="submit">Add recurring job</button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
