import { getSession } from "@/lib/auth";
import { AccountShell } from "@/components/AccountShell";

// Signed in, flatmate pages sit in the account menu; signed out, the introduction is shown on its own.
export default async function FlatmatesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <>{children}</>;
  return <AccountShell user={session.user}>{children}</AccountShell>;
}
