import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { asPerson, pendingIncoming } from "@/lib/services/collab";
import { portalCount } from "@/lib/services/portals";
import { MoreMenu } from "@/components/MoreMenu";

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [incoming, portals] = await Promise.all([pendingIncoming(asPerson(user.id)).catch(() => 0), portalCount(user.id).catch(() => 0)]);
  // The first few links stay in view; the rest fold under "More", so the bar never stretches.
  const menu: [string, string][] = [
    ["/me", "Overview"],
    ["/me/inspections", "Inspections"],
    ["/me/saved", "Saved"],
    ["/me/notifications", "Notifications"],
    ...(portals > 0 ? [["/portal", `Portals (${portals})`] as [string, string]] : []),
    ["/me/collaborations", `Collaborations${incoming > 0 ? ` (${incoming})` : ""}`],
    ["/me/following", "Following"],
    ["/me/reviews", "My reviews"],
    ["/me/verification", "Verification"],
    ["/me/notification-settings", "Email settings"],
    ["/me/plan", "My plan"],
    ["/me/billing", "Billing"],
    ["/me/ads", "Advertising"],
    ["/me/security", "Security"],
    ["/me/privacy", "Privacy and my data"],
    ["/directory", "Find agents and companies"],
  ];
  const head = menu.slice(0, 5);
  const rest = menu.slice(5);
  return (
    <div className="stack-lg">
      <div className="row between card workspace-bar" style={{ padding: "12px 16px" }}>
        <div><strong>{user.name}</strong><span className="small muted"> · {user.email}</span></div>
        <nav className="nav workspace-nav" aria-label="My account">
          {head.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          <MoreMenu label={`More (${rest.length})`}>
            {rest.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </MoreMenu>
        </nav>
      </div>
      {children}
    </div>
  );
}
