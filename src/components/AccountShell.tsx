import { SideShell } from "./SideShell";

/** A person's own account pages. Their links are in the main side panel (lib/nav.ts, accountSection). */
export async function AccountShell({ user, children }: { user: { id: string; name: string; email: string }; children: React.ReactNode }) {
  return (
    <SideShell label="My account" title={user.name} subtitle={user.email}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
