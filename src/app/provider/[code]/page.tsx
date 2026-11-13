import Link from "next/link";
import { Flash, sp, type SP } from "@/components/ui";
import { providerOverview, providerProfile } from "@/lib/services/verification-network";
import { VP_ROLE_LABELS, VP_ROLES, vpCan } from "@/lib/verification-network-rules";
import { OrgHeader, orgFor } from "./shared";

export const metadata = { title: "Verification dashboard", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ProviderDashboard({ params: p, searchParams: s }: { params: Promise<{ code: string }>; searchParams?: Promise<SP> }) {
  const { code } = await p;
  const searchParams = await s;
  const ctx = await orgFor(code);
  const [o, prof] = await Promise.all([providerOverview(ctx), providerProfile(ctx)]);
  const staffTotal = Object.values(o.staff).reduce((n, x) => n + (x ?? 0), 0);
  const setup = [
    { done: prof.profile.length >= 40 && !!prof.contactEmail, label: "Complete the organisation's profile", href: "/profile", can: vpCan(ctx.role, "org.profile") },
    { done: o.offerings > 0, label: "Choose the services you offer, with prices and turnaround", href: "/profile#services", can: vpCan(ctx.role, "org.services") },
    { done: o.coverage > 0, label: "Choose the states you work in", href: "/profile#coverage", can: vpCan(ctx.role, "org.services") },
    { done: staffTotal > 1, label: "Invite your staff", href: "/staff", can: vpCan(ctx.role, "staff.manage") },
    { done: o.docs > 0, label: "Keep your licences and certificates on file", href: "/documents", can: vpCan(ctx.role, "org.documents") },
  ].filter((x) => x.can);
  const leadsOpen = (o.leads.SUBMITTED ?? 0) + (o.leads.CONTACTED ?? 0) + (o.leads.IN_PROGRESS ?? 0);
  return (
    <div className="wrap stack-lg vp">
      <OrgHeader ctx={ctx} back={false} />
      <Flash searchParams={{ error: sp(searchParams, "error"), notice: sp(searchParams, "notice") }} />
      {setup.some((x) => !x.done) ? (
        <section className="card stack">
          <h2>Set up your organisation</h2>
          <ol className="vp-setup">{setup.map((x) => <li key={x.label} className={x.done ? "done" : ""}><span className="vp-n" aria-hidden="true">{x.done ? "✓" : ""}</span><Link href={`/provider/${ctx.code}${x.href}`}>{x.label}</Link></li>)}</ol>
        </section>
      ) : null}
      <section className="vp-stats" aria-label="At a glance">
        <div className="card"><span className="vp-stat">{staffTotal}</span><span className="small muted">Staff</span></div>
        <div className="card"><span className="vp-stat">{o.offerings}</span><span className="small muted">Services offered</span></div>
        <div className="card"><span className="vp-stat">{o.coverage}</span><span className="small muted">States covered</span></div>
        <div className="card"><span className="vp-stat">{leadsOpen}</span><span className="small muted">Open enquiries from listings</span></div>
        {vpCan(ctx.role, "staff.manage") ? <div className="card"><span className="vp-stat">{o.pendingInvites}</span><span className="small muted">Invitations not yet accepted</span></div> : null}
      </section>
      <p className="small muted">Every number on this page is counted from your organisation&apos;s own records.</p>
      {o.expiring.length ? (
        <section className="card stack"><h2>Licences and certificates expiring soon</h2>
          <ul className="vp-docs">{o.expiring.map((d) => <li key={d.id}><span><strong>{d.title}</strong><span className={`small ${d.expiresOn! < new Date() ? "bad-text" : "warn-text"}`}>{d.expiresOn! < new Date() ? "Expired" : "Expires"} {d.expiresOn!.toISOString().slice(0, 10)}</span></span></li>)}</ul>
        </section>
      ) : null}
      <section className="vp-grid">
        <Link className="card vp-tile" href={`/provider/${ctx.code}/cases`}><strong>Verification cases</strong><span className="small muted">Offers from Housy, investigations, evidence and reports</span></Link>
        <Link className="card vp-tile" href={`/provider/${ctx.code}/profile`}><strong>Profile, services and coverage</strong><span className="small muted">How customers see you, what you offer and where</span></Link>
        {vpCan(ctx.role, "staff.view") ? <Link className="card vp-tile" href={`/provider/${ctx.code}/staff`}><strong>Staff and roles</strong><span className="small muted">{VP_ROLES.filter((r) => o.staff[r]).map((r) => `${o.staff[r]} ${VP_ROLE_LABELS[r].toLowerCase()}${o.staff[r]! > 1 ? "s" : ""}`).join(", ") || "Invite your team"}</span></Link> : null}
        <Link className="card vp-tile" href={`/provider/${ctx.code}/documents`}><strong>Documents</strong><span className="small muted">{o.docs} on file</span></Link>
        <Link className="card vp-tile" href={`/portal/provider/${ctx.providerId}`}><strong>Enquiries from listings</strong><span className="small muted">{leadsOpen} open</span></Link>
      </section>
    </div>
  );
}
