import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SideShell } from "@/components/SideShell";

// To anyone who is not a signed-in administrator the admin area does not exist (404). Every page also checks for itself.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) notFound();
  return (
    <SideShell label="Platform admin" title="Platform administration" subtitle={session.user.name}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
