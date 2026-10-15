import Link from "next/link";
import { requireUser } from "@/lib/auth";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="stack-lg">
      <div className="row between card workspace-bar" style={{ padding: "12px 16px" }}>
        <div><strong>{user.name}</strong><span className="small muted"> · {user.email}</span></div>
        <nav className="nav nav-scroll" aria-label="My account">
          <Link href="/me">Overview</Link>
          <Link href="/me/following">Following</Link>
          <Link href="/me/notifications">Notifications</Link>
          <Link href="/me/plan">My plan</Link>
          <Link href="/directory">Find agents and companies</Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
