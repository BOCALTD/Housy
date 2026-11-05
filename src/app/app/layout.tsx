import { getMember, requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { SideShell } from "@/components/SideShell";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const member = await getMember();
  if (!member) return <div className="stack-lg">{children}</div>;
  return (
    <SideShell label="Workspace" title={member.companyName} subtitle={`${member.userName} · ${ROLE_LABELS[member.role]}`}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
