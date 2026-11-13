import { notFound } from "next/navigation";
import { Field, Flash, sp, type SP } from "@/components/ui";
import { providerStaff } from "@/lib/services/verification-network";
import { VP_ROLES, VP_ROLE_LABELS, VP_ROLE_SUMMARY, mayManageRole, vpCan } from "@/lib/verification-network-rules";
import { OrgHeader, orgFor } from "../shared";
import { inviteAction, removeStaffAction, revokeInviteAction, roleAction, statusAction } from "../../actions";

export const metadata = { title: "Staff and roles", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ProviderStaffPage({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  if (!vpCan(ctx.role, "staff.view")) notFound();
  const { members, invitations } = await providerStaff(ctx);
  const manage = vpCan(ctx.role, "staff.manage") && ctx.active;
  const grantable = VP_ROLES.filter((r) => mayManageRole(ctx.role, r));
  const invite = sp(searchParams, "invite");
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} title="Staff and roles" />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {invite ? <section className="card stack vp-invite" role="status"><h2>Invitation link</h2><p className="small muted">Send it to the person (by email or message). It is shown only once and works for 14 days.</p><input readOnly className="vp-link" value={invite} aria-label="Invitation link" /></section> : null}

      <section className="card stack">
        <h2>People ({members.length})</h2>
        <ul className="vp-staff">{members.map((m) => {
          const canTouch = manage && !m.me && mayManageRole(ctx.role, m.role);
          return (
            <li key={m.id} className={m.status !== "ACTIVE" ? "off" : ""}>
              <div className="vp-staff-who"><strong>{m.name}{m.me ? " (you)" : ""}</strong><span className="small muted">{m.email}</span>
                <span className="small">{VP_ROLE_LABELS[m.role]}{m.status !== "ACTIVE" ? " · access suspended" : ""}</span></div>
              {canTouch ? (
                <details className="vp-fold vp-staff-acts"><summary>Change</summary>
                  <form action={roleAction} className="row wrap"><input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="id" value={m.id} />
                    <label className="field">Role<select name="role" defaultValue={m.role}>{grantable.map((r) => <option key={r} value={r}>{VP_ROLE_LABELS[r]}</option>)}</select></label>
                    <button className="btn small" type="submit" data-confirm={`Change ${m.name}'s role?`} data-confirm-body="What they can do changes straight away." data-confirm-ok="Change role" data-confirm-tone="default">Save role</button></form>
                  <div className="row wrap">
                    <form action={statusAction}><input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="id" value={m.id} /><input type="hidden" name="active" value={m.status === "ACTIVE" ? "no" : "yes"} />
                      <button className="btn small" type="submit" data-confirm={m.status === "ACTIVE" ? `Suspend ${m.name}'s access?` : `Restore ${m.name}'s access?`} data-confirm-body={m.status === "ACTIVE" ? "They can no longer see or do anything for the organisation. Their past work is kept." : "They can work for the organisation again in their role."} data-confirm-ok={m.status === "ACTIVE" ? "Suspend access" : "Restore access"} data-confirm-tone={m.status === "ACTIVE" ? undefined : "default"}>{m.status === "ACTIVE" ? "Suspend access" : "Restore access"}</button></form>
                    <form action={removeStaffAction}><input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="id" value={m.id} />
                      <button className="btn small danger" type="submit" data-confirm={`Remove ${m.name} from the organisation?`} data-confirm-body="They lose access straight away. Their past work stays on record." data-confirm-ok="Remove">Remove</button></form>
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}</ul>
      </section>

      {manage ? (
        <section className="card stack">
          <h2>Invite someone</h2>
          <form action={inviteAction} className="stack">
            <input type="hidden" name="code" value={ctx.code} />
            <div className="grid-2">
              <Field label="Their email"><input name="email" type="email" required maxLength={200} autoComplete="off" /></Field>
              <Field label="Role"><select name="role" required defaultValue="INVESTIGATOR">{grantable.map((r) => <option key={r} value={r}>{VP_ROLE_LABELS[r]}</option>)}</select></Field>
            </div>
            <button className="btn primary" type="submit">Create invitation</button>
          </form>
          {invitations.length ? (
            <>
              <h3>Waiting to be accepted</h3>
              <ul className="vp-docs">{invitations.map((i) => (
                <li key={i.id}><span><strong>{i.email}</strong><span className="small muted">{VP_ROLE_LABELS[i.role]} · until {i.expiresAt.toISOString().slice(0, 10)}</span></span>
                  {mayManageRole(ctx.role, i.role) ? <form action={revokeInviteAction}><input type="hidden" name="code" value={ctx.code} /><input type="hidden" name="id" value={i.id} /><button className="btn small" type="submit" data-confirm="Cancel this invitation?" data-confirm-body="The link stops working." data-confirm-ok="Cancel invitation">Cancel</button></form> : null}</li>
              ))}</ul>
            </>
          ) : null}
        </section>
      ) : null}

      <details className="card"><summary><h2 className="inline-h">What each role can do</h2></summary>
        <ul className="vp-roles">{VP_ROLES.map((r) => <li key={r}><strong>{VP_ROLE_LABELS[r]}</strong><span className="small muted">{VP_ROLE_SUMMARY[r]}</span></li>)}</ul>
      </details>
    </div>
  );
}
