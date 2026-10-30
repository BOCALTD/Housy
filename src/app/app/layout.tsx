import { getMember, requireUser } from "@/lib/auth";
import { can, ROLE_LABELS, type Role } from "@/lib/permissions";
import { asCompany, pendingIncoming } from "@/lib/services/collab";
import { SideShell, type SideGroup, type SideItem } from "@/components/SideShell";

type Row = [href: string, label: string, icon: SideItem["icon"], show: boolean, badge?: number];

function groupsFor(r: Role, incoming: number): SideGroup[] {
  const g = (label: string, rows: Row[]): SideGroup => ({ label, items: rows.filter((x) => x[3]).map(([href, l, icon, , badge]) => ({ href, label: l, icon, badge })) });
  return [
    g("Overview", [
      ["/app", "Dashboard", "grid", true],
      ["/app/analytics", "Analytics", "chart", true],
      ["/app/map", "Map", "map", true],
      ["/app/assistant", "Assistant", "sparkle", can(r, "ai.use")],
    ]),
    g("Properties", [
      ["/app/assets", "Assets", "building", true],
      ["/app/inspections", "Inspections", "clipboard", true],
      ["/field", "Field kit (works offline)", "clipboard", can(r, "inspection.conduct")],
      ["/app/maintenance", "Maintenance", "wrench", true],
      ["/app/inventory", "Inventory", "box", true],
      ["/app/compliance", "Compliance", "shield", true],
      ["/app/projects", "Projects", "home", can(r, "project.view")],
      ["/app/valuations", "Valuations", "chart", can(r, "valuation.view")],
    ]),
    g("Clients and sales", [
      ["/app/crm", "Clients", "people", can(r, "crm.view")],
      ["/app/deals", "Deals", "handshake", can(r, "crm.view")],
      ["/app/sales", "Sales", "money", can(r, "crm.view")],
      ["/app/commissions", "Commissions", "money", can(r, "crm.view")],
      ["/app/bookings", "Inspection bookings", "calendar", can(r, "booking.manage")],
      ["/app/collaborations", "Collaborations", "people", can(r, "collab.view"), incoming],
      ["/app/reviews", "Reviews", "star", can(r, "crm.manage")],
      ["/app/completed", "Completed deals", "door", can(r, "crm.manage")],
    ]),
    g("Money", [
      ["/app/service-charges", "Service charges", "money", can(r, "finance.view")],
      ["/app/reports", "Reports", "doc", can(r, "finance.view")],
      ["/app/billing", "Billing", "money", can(r, "billing.view")],
      ["/app/ads", "Advertising", "megaphone", can(r, "billing.view")],
    ]),
    g("Marketing", [
      ["/app/promotions", "Promotions", "megaphone", can(r, "listing.manage")],
      ["/app/profile", "Public profile", "person", can(r, "crm.view")],
    ]),
    g("Records", [
      ["/app/correspondence", "Correspondence", "chat", true],
      ["/app/files", "Files", "folder", true],
      ["/app/completeness", "Record completeness", "clipboard", true],
    ]),
    g("Company", [
      ["/app/portals", "Owner and vendor portals", "key", can(r, "portal.manage")],
      ["/app/team", "Team", "people", can(r, "team.manage")],
      ["/app/verification", "Verification", "shield", can(r, "kyc.manage")],
      ["/app/import", "Bring in records", "folder", can(r, "import.manage")],
      ["/app/api-keys", "API keys", "key", can(r, "api.manage")],
      ["/app/setup", "Business set-up", "sparkle", can(r, "settings.manage")],
      ["/app/settings", "Settings", "gear", can(r, "settings.manage")],
      ["/app/switch", "Switch company", "building", true],
    ]),
  ];
}

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const member = await getMember();
  if (!member) return <div className="stack-lg">{children}</div>;
  const incoming = can(member.role, "collab.view") ? await pendingIncoming(asCompany(member)).catch(() => 0) : 0;
  return (
    <SideShell label="Workspace" title={member.companyName} subtitle={`${member.userName} · ${ROLE_LABELS[member.role]}`} groups={groupsFor(member.role, incoming)}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
