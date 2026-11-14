import { requireMember } from "@/lib/auth";
import { ACCESS_PURPOSES, accessLogForCompany } from "@/lib/services/governance";
import { formatDateTime as fmtAccess } from "@/lib/dates";
import { getSettings } from "@/lib/services/settings";
import { listTeam } from "@/lib/services/companies";
import { formatReference } from "@/lib/correspondence-rules";
import { todayInLagos } from "@/lib/dates";
import { Field, Flash, ShowMore, TableMore, sp, type SP } from "@/components/ui";
import { BusinessCountry } from "@/components/BusinessCountry";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { businessRegionFull, countryTimeZone } from "@/lib/services/business-region";
import { closeWorkspaceAction, countryAction, timeZoneAction, departmentAction, memberDepartmentAction, pauseWorkspaceAction, prefixAction, reminderSettingsAction } from "./actions";

export const metadata = { title: "Company settings" };

export default async function SettingsPage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("settings.manage");
  const accessLog = await accessLogForCompany(member);
  const { timeZone: companyZone } = await businessRegionFull(member);
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
      <section className="card stack" id="access" aria-labelledby="access-h">
        <h2 id="access-h">Platform access to your records</h2>
        <p className="small muted">Platform administrators can open your company&apos;s records only after stating why, for one hour at a time. Each opening is listed here and your administrators are told.</p>
        {accessLog.length === 0 ? <p className="muted">Never opened.</p> : <ul className="timeline">{accessLog.slice(0, 10).map((g) => <li key={g.id}><span>{fmtAccess(g.createdAt)} · {ACCESS_PURPOSES[g.purpose as keyof typeof ACCESS_PURPOSES]}{g.caseRef ? ` · ${g.caseRef}` : ""}<div className="small muted">{g.note}</div></span></li>)}</ul>}
      </section>
      {member.role === "COMPANY_SUPER_ADMIN" ? (
        <section className="card stack" id="country" aria-labelledby="country-h">
          <h2 id="country-h">Country and currency</h2>
          <p className="small muted">Your prices, payment links, plan and Housy&apos;s commission are in this country&apos;s currency (now {member.currency}). Change it only if it is wrong or the business has moved.</p>
          <details className="vp-fold">
            <summary>Change the country</summary>
            <form action={countryAction} className="stack">
              <BusinessCountry value={member.country} />
              <ul className="check-list small">
                <li>The bank account clients pay into is cleared: add it again for the new country.</li>
                <li>Not possible while a payment link is waiting or an invoice is unpaid in the current currency.</li>
                <li>Published listings keep their price and currency until you edit them.</li>
              </ul>
              <div className="row"><button className="btn" type="submit" data-confirm="Change your country?" data-confirm-body="Your currency may change and your bank account for client payments is cleared." data-confirm-ok="Change country">Change country</button></div>
            </form>
          </details>
          <details className="vp-fold">
            <summary>Time zone ({member.timeZone.replace(/_/g, " ")})</summary>
            <form action={timeZoneAction} className="stack">
              <TimeZoneSelect value={companyZone} automatic={countryTimeZone(member.country)} label="Workspace time zone" />
              <p className="small muted">Used for due dates, reminders and times in this workspace. A member who chose their own time zone sees times in theirs.</p>
              <div className="row"><button className="btn" type="submit">Save time zone</button></div>
            </form>
          </details>
        </section>
      ) : null}
      {member.role === "COMPANY_SUPER_ADMIN" ? (
        <section className="card stack" id="leave" aria-labelledby="leave-h">
          <h2 id="leave-h">Pause or close this workspace</h2>
          <div className="leave-grid">
            <details className="leave-card">
              <summary><h3>Pause</h3><span className="muted small">Take a break. You can resume whenever you like.</span></summary>
              <form action={pauseWorkspaceAction} className="stack" style={{ marginTop: 10 }}>
                <ul className="check-list small">
                  <li>Your listings and profiles leave public view; nothing is deleted.</li>
                  <li>Your team cannot work in the workspace; API keys and portals stop.</li>
                  <li>Your plan is not renewed while paused.</li>
                </ul>
                <Field label="Note for your team (optional)"><input name="note" maxLength={500} /></Field>
                <div className="row"><button className="btn" type="submit" data-confirm="Pause this workspace?" data-confirm-body="Listings and profiles are hidden and your team is told. You can resume it from the same place." data-confirm-ok="Pause workspace" data-confirm-tone="default">Pause workspace</button></div>
              </form>
            </details>
            <details className="leave-card danger-zone">
              <summary><h3>Close for good</h3><span className="muted small">For a business that has stopped.</span></summary>
              <form action={closeWorkspaceAction} className="stack" style={{ marginTop: 10 }}>
                <p className="small">Everything is hidden, waiting payment links are cancelled and the plan stops. Records (leases, receipts, invoices) are kept as the law requires. Only Housy support can reopen it. Unpaid Housy invoices stay owed.</p>
                <Field label="Why are you closing it?"><input name="reason" required minLength={3} maxLength={500} /></Field>
                <Field label="Type CLOSE to confirm"><input name="confirm" required autoComplete="off" pattern="[Cc][Ll][Oo][Ss][Ee]" /></Field>
                <Field label="Your password"><input name="password" type="password" required autoComplete="current-password" /></Field>
                <div className="row"><button className="btn danger" type="submit" data-confirm="Close this workspace for good?" data-confirm-body="Your team loses access, listings are hidden and the plan stops. Only Housy support can reopen it." data-confirm-ok="Close workspace">Close workspace</button></div>
              </form>
            </details>
          </div>
        </section>
      ) : null}
    </div>
  );
}
