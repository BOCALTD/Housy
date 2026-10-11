import { headers } from "next/headers";
import { requireMember } from "@/lib/auth";
import { listTeam } from "@/lib/services/companies";
import { ALL_ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { inviteAction, updateMemberAction } from "./actions";

export const metadata = { title: "Team" };

export default async function TeamPage({ searchParams }: { searchParams?: SP }) {
  const member = await requireMember("team.manage");
  const { members, invitations } = await listTeam(member);
  const invite = sp(searchParams, "invite");
  const host = headers().get("host") ?? "localhost:3000";
  const proto = headers().get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteUrl = invite ? `${proto}://${host}/invite/${encodeURIComponent(invite)}` : null;

  return (
    <div className="stack-lg">
      <h1>Team</h1>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {inviteUrl ? (
        <div className="card stack" style={{ borderColor: "var(--brass)" }}>
          <h2>Share this invitation link</h2>
          <p className="small muted">Email sending is not set up yet. Send this link to the person you invited. It works once and expires in 7 days. It will not be shown again.</p>
          <input readOnly value={inviteUrl} aria-label="Invitation link" className="mono" style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 9, background: "var(--surface-2)" }} />
        </div>
      ) : null}

      <div className="two">
        <section className="card table-wrap">
          <h2>Members</h2>
          <table>
            <thead><tr><th>Name</th><th>Role and status</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.user.name}</strong><div className="small muted">{m.user.email}</div></td>
                  <td>
                    {m.id === member.membershipId ? (
                      <span>{ROLE_LABELS[m.role as Role]} <span className="small muted">(you)</span></span>
                    ) : (
                      <form action={updateMemberAction} className="row">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <select name="role" defaultValue={m.role} aria-label={`Role for ${m.user.name}`}>
                          {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <select name="status" defaultValue={m.status} aria-label={`Status for ${m.user.name}`}>
                          <option value="ACTIVE">Active</option>
                          <option value="SUSPENDED">Suspended</option>
                        </select>
                        <button className="btn small" type="submit">Save</button>
                      </form>
                    )}
                  </td>
                  <td><Pill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="stack-lg">
          <section className="card">
            <h2>Invite a staff member</h2>
            <form action={inviteAction} className="stack">
              <Field label="Email"><input name="email" id="inviteEmail" type="email" required /></Field>
              <Field label="Role">
                <select name="role" id="inviteRole" defaultValue="OFFICER">
                  {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </Field>
              <button className="btn primary" type="submit">Create invitation</button>
            </form>
          </section>
          {invitations.length > 0 ? (
            <section className="card">
              <h2>Pending invitations</h2>
              <ul className="timeline">
                {invitations.map((i) => (
                  <li key={i.id}><div>{i.email}<div className="small muted">{ROLE_LABELS[i.role as Role]} · expires {formatDate(i.expiresAt)}</div></div></li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
