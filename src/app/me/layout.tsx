import { requireUser } from "@/lib/auth";
import { AccountShell } from "@/components/AccountShell";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AccountShell user={user}>{children}</AccountShell>;
}
