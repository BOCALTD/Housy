import { asPerson, pendingIncoming } from "@/lib/services/collab";
import { portalCount } from "@/lib/services/portals";
import { waitingFlatmateRequests } from "@/lib/services/flatmates";
import { SideShell, type SideGroup } from "./SideShell";

/** The side menu for a person's own account pages and the portals they hold. */
export async function AccountShell({ user, children }: { user: { id: string; name: string; email: string }; children: React.ReactNode }) {
  const [incoming, portals, flatmateWaiting] = await Promise.all([pendingIncoming(asPerson(user.id)).catch(() => 0), portalCount(user.id).catch(() => 0), waitingFlatmateRequests(user.id).catch(() => 0)]);
  const groups: SideGroup[] = [
    { label: "My account", items: [
      { href: "/me", label: "Overview", icon: "grid" },
      { href: "/me/inspections", label: "Inspections", icon: "calendar" },
      { href: "/me/saved", label: "Saved and alerts", icon: "heart" },
      { href: "/me/notifications", label: "Notifications", icon: "bell" },
      { href: "/messages", label: "Messages", icon: "chat" },
    ] },
    { label: "People and work", items: [
      { href: "/flatmates/matches", label: "Flatmate matches", icon: "heart" },
      { href: "/flatmates/requests", label: "Flatmate requests and rooms", icon: "chat", badge: flatmateWaiting },
      { href: "/me/collaborations", label: "Collaborations", icon: "handshake", badge: incoming },
      { href: "/me/following", label: "Following", icon: "people" },
      { href: "/me/reviews", label: "My reviews", icon: "star" },
      ...(portals > 0 ? [{ href: "/portal", label: "Portals", icon: "key" as const, badge: portals }] : []),
      { href: "/directory", label: "Find agents and companies", icon: "search" },
    ] },
    { label: "Plan and payments", items: [
      { href: "/me/plan", label: "My plan", icon: "star" },
      { href: "/me/billing", label: "Billing", icon: "money" },
      { href: "/me/ads", label: "Advertising", icon: "megaphone" },
    ] },
    { label: "Settings", items: [
      { href: "/me/verification", label: "Verification", icon: "shield" },
      { href: "/me/notification-settings", label: "Email settings", icon: "bell" },
      { href: "/me/security", label: "Security", icon: "lock" },
      { href: "/me/privacy", label: "Privacy and my data", icon: "doc" },
    ] },
  ];
  return (
    <SideShell label="My account" title={user.name} subtitle={user.email} groups={groups}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
