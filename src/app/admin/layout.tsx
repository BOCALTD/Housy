import { getSession } from "@/lib/auth";
import { SideShell, type SideGroup } from "@/components/SideShell";

// Every admin page still checks the administrator itself; the menu is only drawn for one.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return <>{children}</>;
  const groups: SideGroup[] = [
    { label: "Platform", items: [
      { href: "/admin", label: "Overview and listings", icon: "grid" },
      { href: "/admin/launch", label: "Launch readiness", icon: "clipboard" },
      { href: "/admin/companies", label: "Companies", icon: "building" },
      { href: "/admin/reference", label: "Reference data", icon: "gear" },
      { href: "/admin/partners", label: "Partners", icon: "handshake" },
    ] },
    { label: "Trust and safety", items: [
      { href: "/admin/cases", label: "Trust and Safety cases", icon: "shield" },
      { href: "/admin/kyc", label: "Identity and business checks", icon: "key" },
      { href: "/admin/moderation", label: "Message reports", icon: "chat" },
      { href: "/admin/reviews", label: "Review moderation", icon: "star" },
      { href: "/admin/reels", label: "Reel moderation", icon: "play" },
      { href: "/admin/vacancies", label: "Vacancy reports", icon: "door" },
      { href: "/admin/completed", label: "Completed deals to check", icon: "clipboard" },
    ] },
    { label: "Money", items: [
      { href: "/admin/payments", label: "Payments", icon: "money" },
      { href: "/admin/finance", label: "Finance", icon: "chart" },
      { href: "/admin/plans", label: "Plans and limits", icon: "doc" },
      { href: "/admin/ads", label: "Advertising", icon: "megaphone" },
      { href: "/admin/promotions", label: "Promotions", icon: "megaphone" },
    ] },
    { label: "Community", items: [
      { href: "/admin/collaborations", label: "Collaborations", icon: "people" },
      { href: "/admin/referrals", label: "Referrals", icon: "people" },
      { href: "/admin/rewards", label: "Rewards", icon: "star" },
      { href: "/admin/awards", label: "Top Agent awards", icon: "star" },
      { href: "/admin/feedback", label: "Ratings and feedback", icon: "heart" },
    ] },
    { label: "System", items: [
      { href: "/admin/notifications", label: "Notifications and email", icon: "bell" },
      { href: "/admin/ai", label: "Assistant", icon: "sparkle" },
    ] },
  ];
  return (
    <SideShell label="Platform admin" title="Platform administration" subtitle={session.user.name} groups={groups}>
      <div className="stack-lg">{children}</div>
    </SideShell>
  );
}
