import { getSession } from "@/lib/auth";
import { AccountShell } from "@/components/AccountShell";

// Messages sit inside the account menu for a signed-in person.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <>{children}</>;
  return <AccountShell user={session.user}>{children}</AccountShell>;
}
