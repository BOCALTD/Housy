import { getSession } from "@/lib/auth";
import { SideShell } from "@/components/SideShell";

// Every admin page still checks the administrator itself; the menu is only drawn for one.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return <>{children}</>;
  return (
    <SideShell label="Platform admin" title="Platform administration" subtitle={session.user.name}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
