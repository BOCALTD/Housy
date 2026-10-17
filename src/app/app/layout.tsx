import Link from "next/link";
import { getMember, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/permissions";
import { asCompany, pendingIncoming } from "@/lib/services/collab";
import { MoreMenu } from "@/components/MoreMenu";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const member = await getMember();
  const incoming = member && can(member.role, "collab.view") ? await pendingIncoming(asCompany(member)).catch(() => 0) : 0;
  const r = member?.role;
  const menu: [string, string, boolean][] = r ? [
    ["/app", "Dashboard", true], ["/app/assets", "Assets", true],
    ["/app/crm", "Clients", can(r, "crm.view")], ["/app/deals", "Deals", can(r, "crm.view")], ["/app/sales", "Sales", can(r, "crm.view")],
    ["/app/correspondence", "Correspondence", true], ["/app/service-charges", "Service charges", can(r, "finance.view")],
    ["/app/inspections", "Inspections", true], ["/app/maintenance", "Maintenance", true], ["/app/inventory", "Inventory", true],
    ["/app/projects", "Projects", can(r, "project.view")], ["/app/valuations", "Valuations", can(r, "valuation.view")],
    ["/app/compliance", "Compliance", true], ["/app/reports", "Reports", can(r, "finance.view")], ["/app/files", "Files", true],
    ["/app/collaborations", `Collaborations${incoming > 0 ? ` (${incoming})` : ""}`, can(r, "collab.view")],
    ["/app/reviews", "Reviews", can(r, "crm.manage")], ["/app/completed", "Completed deals", can(r, "crm.manage")],
    ["/app/promotions", "Promotions", can(r, "listing.manage")], ["/app/profile", "Public profile", can(r, "crm.view")],
    ["/app/analytics", "Analytics", true], ["/app/map", "Map", true], ["/app/assistant", "Assistant", can(r, "ai.use")],
    ["/app/billing", "Billing", can(r, "billing.view")], ["/app/ads", "Advertising", can(r, "billing.view")],
    ["/app/import", "Bring in records", can(r, "import.manage")], ["/app/team", "Team", can(r, "team.manage")],
    ["/app/settings", "Settings", can(r, "settings.manage")], ["/app/switch", "Switch company", true],
  ] : [];
  const shown = menu.filter((m) => m[2]);
  const head = shown.slice(0, 6);
  const rest = shown.slice(6);
  return (
    <div className="stack-lg">
      {member ? (
        <div className="row between card workspace-bar" style={{ padding: "12px 16px" }}>
          <div>
            <strong>{member.companyName}</strong>
            <span className="small muted"> · {member.userName}, {ROLE_LABELS[member.role]}</span>
          </div>
          <nav className="nav workspace-nav" aria-label="Workspace">
            {head.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            {rest.length > 0 ? (
              <MoreMenu label={`More (${rest.length})`}>
                {rest.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
              </MoreMenu>
            ) : null}
          </nav>
        </div>
      ) : null}
      {children}
    </div>
  );
}
