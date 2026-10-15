import Link from "next/link";
import { getMember, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/permissions";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const member = await getMember();
  return (
    <div className="stack-lg">
      {member ? (
        <div className="row between card" style={{ padding: "12px 16px" }}>
          <div>
            <strong>{member.companyName}</strong>
            <span className="small muted"> · {member.userName}, {ROLE_LABELS[member.role]}</span>
          </div>
          <nav className="nav" aria-label="Workspace">
            <Link href="/app">Dashboard</Link>
            <Link href="/app/assets">Assets</Link>
            <Link href="/app/correspondence">Correspondence</Link>
            {can(member.role, "finance.view") ? <Link href="/app/service-charges">Service charges</Link> : null}
            <Link href="/app/inspections">Inspections</Link>
            <Link href="/app/compliance">Compliance</Link>
            {can(member.role, "finance.view") ? <Link href="/app/reports">Reports</Link> : null}
            <Link href="/app/files">Files</Link>
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
