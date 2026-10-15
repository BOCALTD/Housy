import { requireMember } from "@/lib/auth";
import { getSettings } from "@/lib/services/settings";
import { listTeam } from "@/lib/services/companies";
import { formatReference } from "@/lib/correspondence-rules";
import { todayInLagos } from "@/lib/dates";
import { Field, Flash, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { departmentAction, memberDepartmentAction, prefixAction, reminderSettingsAction } from "./actions";

export const metadata = { title: "Company settings" };

export default async function SettingsPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("settings.manage");
  const [{ company, departments }, team] = await Promise.all([getSettings(member), listTeam(member)]);
  const year = todayInLagos().getUTCFullYear();
  const example = formatReference(company.refPrefix, departments[0]?.code ?? null, year, 7);

  return (
    <div className="stack-lg">
      <h1>Company settings</h1>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />

      <div className="two">
        <div className="stack-lg">
          <section className="card stack">
            <h2>Correspondence references</h2>
            <p className="small muted">References follow PREFIX/DEPARTMENT/YEAR/NUMBER. Numbers restart each year. Example: <span className="mono">{example}</span></p>
            <form action={prefixAction} className="row">
              <input name="refPrefix" id="refPrefix" defaultValue={company.refPrefix} maxLength={8} aria-label="Reference prefix" className="mono"
                     style={{ width: 140, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: "var(--surface)" }} />
              <button className="btn" type="submit">Save prefix</button>
            </form>
          </section>

          <section className="card stack">
            <h2>Reminders</h2>
            <p className="small muted">Deadlines show as due soon this many days ahead, and as escalated once they are overdue by the second number of days. Reminders appear in the app; no emails or messages are sent.</p>
            <form action={reminderSettingsAction} className="stack">
              <div className="fields">
                <Field label="Due soon, days ahead"><input name="leadDays" inputMode="numeric" required defaultValue={company.reminderLeadDays} /></Field>
                <Field label="Escalate after, days overdue"><input name="escalationDays" inputMode="numeric" required defaultValue={company.escalationDays} /></Field>
              </div>
              <button className="btn" type="submit">Save reminder settings</button>
            </form>
          </section>

          <section className="card table-wrap">
            <h2>Member departments</h2>
            <TableMore limit={12} noun="more rows" head={<tr><th>Member</th><th>Department</th></tr>} rows={team.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}<div className="small muted">{m.user.email}</div></td>
                    <td>
                      <form action={memberDepartmentAction} className="row">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <select name="departmentId" defaultValue={m.departmentId ?? ""} aria-label={`Department for ${m.user.name}`}>
                          <option value="">None</option>
                          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    </td>
                  </tr>
                ))} />
          </section>
        </div>

        <section className="card stack">
          <h2>Departments</h2>
          {departments.length === 0 ? <p className="muted small">No departments yet.</p> : (
            <ShowMore noun="more" limit={5} items={departments.map((d) => (
                <li key={d.id}><div>{d.name} <span className="mono small muted">{d.code}</span><div className="small muted">{d._count.members} {d._count.members === 1 ? "member" : "members"}</div></div></li>
              ))} />
          )}
          <form action={departmentAction} className="stack">
            <Field label="Name"><input name="name" id="deptName" required placeholder="Legal" /></Field>
            <Field label="Code" hint="2 to 8 letters or digits. Used in references."><input name="code" id="deptCode" required maxLength={8} placeholder="LEG" className="mono" /></Field>
            <button className="btn primary" type="submit">Add department</button>
          </form>
        </section>
      </div>
    </div>
  );
}
