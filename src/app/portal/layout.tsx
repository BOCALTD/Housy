import { getSession } from "@/lib/auth";
import { AccountShell } from "@/components/AccountShell";

// Invitation links open signed out, so the account menu appears only for a signed-in person.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <>{children}</>;
  return <AccountShell user={session.user}>{children}</AccountShell>;
}
