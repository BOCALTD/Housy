import Link from "next/link";
import { getMember, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/permissions";
import { asCompany, pendingIncoming } from "@/lib/services/collab";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const member = await getMember();
  const incoming = member && can(member.role, "collab.view") ? await pendingIncoming(asCompany(member)).catch(() => 0) : 0;
  return (
    <div className="stack-lg">
      {member ? (
        <div className="row between card workspace-bar" style={{ padding: "12px 16px" }}>
          <div>
            <strong>{member.companyName}</strong>
            <span className="small muted"> · {member.userName}, {ROLE_LABELS[member.role]}</span>
          </div>
          <nav className="nav nav-scroll" aria-label="Workspace">
            <Link href="/app">Dashboard</Link>
            <Link href="/app/assets">Assets</Link>
            {can(member.role, "crm.view") ? <Link href="/app/crm">Clients</Link> : null}
            {can(member.role, "crm.view") ? <Link href="/app/deals">Deals</Link> : null}
            {can(member.role, "crm.view") ? <Link href="/app/sales">Sales</Link> : null}
            <Link href="/app/correspondence">Correspondence</Link>
            {can(member.role, "finance.view") ? <Link href="/app/service-charges">Service charges</Link> : null}
            <Link href="/app/inspections">Inspections</Link>
            <Link href="/app/maintenance">Maintenance</Link>
            <Link href="/app/inventory">Inventory</Link>
            {can(member.role, "project.view") ? <Link href="/app/projects">Projects</Link> : null}
            {can(member.role, "valuation.view") ? <Link href="/app/valuations">Valuations</Link> : null}
            <Link href="/app/compliance">Compliance</Link>
            {can(member.role, "finance.view") ? <Link href="/app/reports">Reports</Link> : null}
            <Link href="/app/files">Files</Link>
            {can(member.role, "collab.view") ? <Link href="/app/collaborations">Collaborations{incoming > 0 ? ` (${incoming})` : ""}</Link> : null}
            {can(member.role, "crm.manage") ? <Link href="/app/reviews">Reviews</Link> : null}
            {can(member.role, "crm.manage") ? <Link href="/app/completed">Completed deals</Link> : null}
            {can(member.role, "listing.manage") ? <Link href="/app/promotions">Promotions</Link> : null}
            {can(member.role, "crm.view") ? <Link href="/app/profile">Public profile</Link> : null}
            {can(member.role, "billing.view") ? <Link href="/app/billing">Billing</Link> : null}
            {can(member.role, "team.manage") ? <Link href="/app/team">Team</Link> : null}
            {can(member.role, "settings.manage") ? <Link href="/app/settings">Settings</Link> : null}
            <Link href="/app/switch">Switch company</Link>
          </nav>
        </div>
      ) : null}
      {children}
    </div>
  );
}
