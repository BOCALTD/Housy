import { requireMember } from "@/lib/auth";
import { myProfiles } from "@/lib/services/community";
import { companySubscription } from "@/lib/services/subscriptions";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import { agentProfileAction, companyProfileAction } from "./actions";

export const metadata = { title: "Public profile and plan" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const [{ agent, company }, plan] = await Promise.all([myProfiles(member), companySubscription(member.companyId, member.userId)]);
  const admin = can(member.role, "settings.manage");
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 6 }}><h1>Public profile and plan</h1><p className="muted">What people looking for property can see, and the plan your company holds. Nothing is listed until you tick the box.</p></div>
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      <section className="card stack">
        <h2>Your profile as an agent</h2>
        <form action={agentProfileAction} className="stack">
          <div className="fields">
            <Field label="Name to show"><input name="displayName" required defaultValue={agent?.displayName ?? member.userName} /></Field>
            <Field label="One line about you"><input name="headline" maxLength={160} defaultValue={agent?.headline ?? ""} /></Field>
          </div>
          <Field label="About you"><textarea name="bio" rows={3} maxLength={1500} defaultValue={agent?.bio ?? ""} /></Field>
          <label className="row"><input type="checkbox" name="listed" defaultChecked={agent?.listed ?? false} /> List me in the public directory</label>
          <label className="row"><input type="checkbox" name="acceptsMessages" defaultChecked={agent?.acceptsMessages ?? true} /> Allow people to message me</label>
          <button className="btn primary" type="submit">Save</button>
        </form>
        {agent ? <p className="small muted">{agent.followerCount} {agent.followerCount === 1 ? "follower" : "followers"}</p> : null}
      </section>
      {admin ? (
        <section className="card stack">
          <h2>Company profile</h2>
          <form action={companyProfileAction} className="stack">
            <div className="fields">
              <Field label="Name to show"><input name="displayName" required defaultValue={company?.displayName ?? member.companyName} /></Field>
              <Field label="Listed as"><select name="kind" defaultValue={company?.kind ?? "COMPANY"}><option value="COMPANY">Company</option><option value="DEVELOPER">Developer</option></select></Field>
            </div>
            <Field label="One line about the company"><input name="tagline" maxLength={160} defaultValue={company?.tagline ?? ""} /></Field>
            <Field label="About the company"><textarea name="about" rows={3} maxLength={3000} defaultValue={company?.about ?? ""} /></Field>
            <label className="row"><input type="checkbox" name="listed" defaultChecked={company?.listed ?? false} /> List the company in the public directory</label>
            <button className="btn primary" type="submit">Save</button>
          </form>
          {company ? <p className="small muted">{company.followerCount} {company.followerCount === 1 ? "follower" : "followers"}</p> : null}
        </section>
      ) : null}
      <section className="card stack">
        <div className="row between"><h2>Company plan</h2>{plan.sub ? <Pill status={plan.state === "ACTIVE" || plan.state === "TRIAL" ? "ACTIVE" : plan.state === "GRACE" || plan.state === "READ_ONLY" ? "PENDING" : "SUSPENDED"} label={humanize(plan.state)} /> : null}</div>
        <p>{plan.explanation}</p>
        {plan.sub ? <p className="small muted">{plan.sub.plan.name}, until {formatDate(plan.sub.periodEnd)}.{plan.next ? ` On ${formatDate(plan.next.on)} it becomes ${humanize(plan.next.becomes).toLowerCase()}.` : ""}</p> : <p className="small muted">Plans are set up by the platform for now. Online payment is not available yet.</p>}
      </section>
    </div>
  );
}
