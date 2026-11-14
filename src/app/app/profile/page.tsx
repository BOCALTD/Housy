import { requireMember } from "@/lib/auth";
import { myProfiles } from "@/lib/services/community";
import { companySubscription } from "@/lib/services/subscriptions";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { Field, Flash, Pill, sp, type SP } from "@/components/ui";
import Link from "next/link";
import { logoState } from "@/lib/services/company-logo";
import { agentProfileAction, companyProfileAction, logoRemoveAction, logoUploadAction, logoWatermarkAction } from "./actions";

export const metadata = { title: "Public profile and plan" };
export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams: searchP }: { searchParams?: Promise<SP> }) {
  const searchParams = await searchP;
  const member = await requireMember("crm.view");
  const [{ agent, company }, plan, logo] = await Promise.all([myProfiles(member), companySubscription(member.companyId, member.userId), logoState(member)]);
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
      {admin ? (
        <section className="card stack" aria-labelledby="logo-h">
          <h2 id="logo-h">Logo and photo watermark</h2>
          <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            {logo.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/companies/${member.companyId}/logo`} alt="Your logo" style={{ width: 120, height: 72, objectFit: "contain", background: "#fff", borderRadius: 12, border: "1px solid var(--line)", padding: 6 }} />
            ) : <span className="small muted">No logo yet.</span>}
            <p className="small muted" style={{ flex: "1 1 220px", margin: 0 }}>Shown on your public profile. {logo.allowed ? "Your plan includes the logo watermark, so Housy's mark is not put on your photos: show your logo on them, or keep them clean." : "Housy may add its mark to the photos the public sees. With the logo watermark (Pro and Elite), Housy's mark comes off and you can show your own logo, or keep photos clean."}</p>
          </div>
          <form action={logoUploadAction} className="stack">
            <Field label={logo.hasLogo ? "Replace the logo" : "Upload your logo"} hint="JPG, PNG or WEBP, under 3 MB. A logo on a transparent background looks best."><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></Field>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn" type="submit" data-confirm="Upload this logo?" data-confirm-body="It shows on your public profile, and on your photos if the watermark is on." data-confirm-ok="Upload" data-confirm-tone="default">Upload</button>
            </div>
          </form>
          {logo.hasLogo ? <form action={logoRemoveAction}><button className="btn danger" type="submit" data-confirm="Remove your logo?" data-confirm-body="It leaves your profile, and the logo watermark is switched off." data-confirm-ok="Remove logo">Remove logo</button></form> : null}
          <div className="stack" style={{ gap: 6 }}>
            <h3 className="small">Logo watermark on your property photos</h3>
            {logo.allowed ? <p className="small muted">{logo.watermark ? "Your photos show your logo." : "Your photos are clean: no watermark."}</p> : null}
            {logo.allowed ? (
              <form action={logoWatermarkAction} className="row" style={{ flexWrap: "wrap" }}>
                <input type="hidden" name="on" value={logo.watermark ? "0" : "1"} />
                <span className="small">{logo.watermark ? <span className="pill ok">On</span> : <span className="pill">Off</span>}</span>
                <button className="btn" type="submit" disabled={!logo.hasLogo && !logo.watermark} data-confirm={logo.watermark ? "Turn off the logo watermark?" : "Put your logo on your property photos?"} data-confirm-body={logo.watermark ? "Your logo leaves your photos, which then show clean (no watermark)." : "It shows on every photo of your published listings, in the bottom corner."} data-confirm-ok={logo.watermark ? "Turn off" : "Turn on"} data-confirm-tone="default">{logo.watermark ? "Turn off" : "Turn on"}</button>
              </form>
            ) : <p className="small muted">Part of the Pro and Elite plans. <Link href="/app/billing">See plans</Link></p>}
          </div>
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
