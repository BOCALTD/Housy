import { can, type Role } from "./permissions";
import type { SideGroup, SideItem } from "@/components/nav-types";

/**
 * Every menu on the site, in one place. The frame's side panel (components/Frame.tsx) shows the groups a person can use:
 * Explore and Professionals for everyone, then My account, the company Workspace and Platform administration when they
 * apply. A group opens itself when it holds the current page.
 */
export type NavSection = { key: string; label: string; groups: SideGroup[] };

export function exploreSection(): NavSection {
  return { key: "explore", label: "Explore", groups: [
    { label: "Explore", items: [
      { href: "/", label: "Home", icon: "home" },
      { href: "/browse", label: "Find property", icon: "search" },
      { href: "/assistant", label: "Ask Housy", icon: "sparkle" },
      { href: "/map", label: "Map search", icon: "map" },
      { href: "/reels", label: "Property reels", icon: "play" },
      { href: "/flatmates", label: "Flatmates", icon: "people" },
      { href: "/market", label: "Market prices", icon: "chart" },
      { href: "/compare", label: "Compare", icon: "grid" },
      { href: "/calculators", label: "Calculators", icon: "money" },
      { href: "/blog", label: "Blog and guides", icon: "book" },
    ] },
    { label: "Professionals", items: [
      { href: "/directory?kind=agents", label: "Agents", icon: "person" },
      { href: "/directory?kind=companies", label: "Companies", icon: "building" },
      { href: "/directory?kind=developers", label: "Developers", icon: "home" },
      { href: "/awards", label: "Top agents", icon: "star" },
      { href: "/artisans", label: "Artisans", icon: "wrench" },
      { href: "/verification-partners", label: "Verification partners", icon: "shield" },
    ] },
    { label: "Help", items: [
      { href: "/how-it-works", label: "How it works", icon: "sparkle" },
      { href: "/trust", label: "Trust and safety", icon: "shield" },
      { href: "/faq", label: "Questions and answers", icon: "chat" },
      { href: "/support", label: "Contact and support", icon: "bell" },
      { href: "/legal", label: "Legal and privacy", icon: "lock" },
    ] },
  ] };
}

export function accountSection(c: { incoming: number; portals: number; flatmateWaiting: number; unreadMessages: number; unreadNotices: number; providers?: number }): NavSection {
  const groups: SideGroup[] = [
    { label: "My account", items: [
      { href: "/me", label: "Overview", icon: "grid" },
      { href: "/me/settings", label: "Profile and settings", icon: "gear" },
      { href: "/me/inspections", label: "Inspections", icon: "calendar" },
      { href: "/verification/cases", label: "Property verifications", icon: "shield" },
      { href: "/me/saved", label: "Saved and alerts", icon: "heart" },
      { href: "/me/artisans", label: "Artisans for my home", icon: "wrench" },
      { href: "/me/notifications", label: "Notifications", icon: "bell" },
      { href: "/messages", label: "Messages", icon: "chat" },
    ] },
    { label: "People and work", items: [
      { href: "/flatmates/matches", label: "Flatmate matches", icon: "heart" },
      { href: "/flatmates/requests", label: "Flatmate requests and rooms", icon: "chat", badge: c.flatmateWaiting },
      { href: "/me/collaborations", label: "Collaborations", icon: "handshake", badge: c.incoming },
      { href: "/me/following", label: "Following", icon: "people" },
      { href: "/me/reviews", label: "My reviews", icon: "star" },
      { href: "/referrals", label: "Refer and earn", icon: "money" },
      ...(c.providers ? [{ href: "/provider", label: "Verification work", icon: "shield" as const }] : []),
      ...(c.portals > 0 ? [{ href: "/portal", label: "Portals", icon: "key" as const, badge: c.portals }] : []),
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
  for (const g of groups) for (const i of g.items) {
    if (i.href === "/messages") i.badge = c.unreadMessages;
    if (i.href === "/me/notifications") i.badge = c.unreadNotices;
  }
  return { key: "account", label: "My account", groups };
}

type Row = [href: string, label: string, icon: SideItem["icon"], show: boolean, badge?: number];

export function workspaceSection(r: Role, incoming: number): NavSection {
  return { key: "workspace", label: "Workspace", groups: workspaceGroups(r, incoming) };
}

function workspaceGroups(r: Role, incoming: number): SideGroup[] {
  const g = (label: string, rows: Row[]): SideGroup => ({ label, items: rows.filter((x) => x[3]).map(([href, l, icon, , badge]) => ({ href, label: l, icon, badge })) });
  return [
    g("Overview", [
      ["/app", "Dashboard", "grid", true],
      ["/app/analytics", "Analytics", "chart", true],
      ["/app/map", "Map", "map", true],
      ["/app/assistant", "Assistant", "sparkle", can(r, "ai.use")],
    ]),
    g("Properties", [
      ["/app/assets", "Assets", "building", true],
      ["/app/listings", "Still available?", "clipboard", can(r, "listing.manage")],
      ["/app/inspections", "Inspections", "clipboard", true],
      ["/field", "Field kit (works offline)", "clipboard", can(r, "inspection.conduct")],
      ["/app/maintenance", "Maintenance", "wrench", true],
      ["/app/artisans", "Artisans", "wrench", can(r, "maintenance.manage")],
      ["/app/inventory", "Inventory", "box", true],
      ["/app/compliance", "Compliance", "shield", true],
      ["/app/projects", "Projects", "home", can(r, "project.view")],
      ["/app/valuations", "Valuations", "chart", can(r, "valuation.view")],
    ]),
    g("Clients and sales", [
      ["/app/crm", "Clients", "people", can(r, "crm.view")],
      ["/app/crm/files", "Client files", "folder", can(r, "crm.view")],
      ["/app/deals", "Deals", "handshake", can(r, "crm.view")],
      ["/app/sales", "Sales", "money", can(r, "crm.view")],
      ["/app/commissions", "Commissions", "money", can(r, "crm.view")],
      ["/app/bookings", "Inspection bookings", "calendar", can(r, "booking.manage")],
      ["/app/collaborations", "Collaborations", "people", can(r, "collab.view"), incoming],
      ["/app/reviews", "Reviews", "star", can(r, "crm.manage")],
      ["/app/completed", "Completed deals", "door", can(r, "crm.manage")],
    ]),
    g("Money", [
      ["/app/service-charges", "Service charges", "money", can(r, "finance.view")],
      ["/app/reports", "Reports", "doc", can(r, "finance.view")],
      ["/app/payments", "Client payments", "money", can(r, "billing.view")],
      ["/app/billing", "Billing", "money", can(r, "billing.view")],
      ["/app/ads", "Advertising", "megaphone", can(r, "billing.view")],
    ]),
    g("Marketing", [
      ["/app/promotions", "Promotions", "megaphone", can(r, "listing.manage")],
      ["/app/profile", "Public profile", "person", can(r, "crm.view")],
    ]),
    g("Records", [
      ["/app/correspondence", "Correspondence", "chat", true],
      ["/app/files", "Files", "folder", true],
      ["/app/completeness", "Record completeness", "clipboard", true],
    ]),
    g("Company", [
      ["/app/portals", "Owner and vendor portals", "key", can(r, "portal.manage")],
      ["/app/team", "Team", "people", can(r, "team.manage")],
      ["/app/verification", "Verification", "shield", can(r, "kyc.manage")],
      ["/app/import", "Bring in records", "folder", can(r, "import.manage")],
      ["/app/api-keys", "API keys", "key", can(r, "api.manage")],
      ["/app/setup", "Business set-up", "sparkle", can(r, "settings.manage")],
      ["/app/settings", "Settings", "gear", can(r, "settings.manage")],
      ["/app/switch", "Switch company", "building", true],
    ]),
  ];
}

export function adminSection(): NavSection {
  const groups: SideGroup[] = [
    { label: "Platform", items: [
      { href: "/admin", label: "Overview and listings", icon: "grid" },
      { href: "/admin/launch", label: "Launch readiness", icon: "clipboard" },
      { href: "/admin/companies", label: "Companies", icon: "building" },
      { href: "/admin/reference", label: "Reference data", icon: "gear" },
      { href: "/admin/partners", label: "Partners", icon: "handshake" },
      { href: "/admin/verification", label: "Verification network", icon: "shield" },
      { href: "/admin/verification/cases", label: "Verification cases", icon: "clipboard" },
      { href: "/admin/verification/payouts", label: "Verification payouts", icon: "money" },
      { href: "/admin/verification/quality", label: "Verification quality", icon: "star" },
    ] },
    { label: "Trust and safety", items: [
      { href: "/admin/cases", label: "Trust and Safety cases", icon: "shield" },
      { href: "/admin/kyc", label: "Identity and business checks", icon: "key" },
      { href: "/admin/flatmate-checks", label: "ID checks (flatmates and artisans)", icon: "people" },
      { href: "/admin/blog", label: "Blog", icon: "book" },
      { href: "/admin/people", label: "People", icon: "people" },
      { href: "/admin/sign-in-locks", label: "Sign-in locks", icon: "lock" },
      { href: "/admin/moderation", label: "Message reports", icon: "chat" },
      { href: "/admin/reviews", label: "Review moderation", icon: "star" },
      { href: "/admin/reels", label: "Reel moderation", icon: "play" },
      { href: "/admin/vacancies", label: "Vacancy reports", icon: "door" },
      { href: "/admin/completed", label: "Completed deals to check", icon: "clipboard" },
    ] },
    { label: "Money", items: [
      { href: "/admin/payments", label: "Payments", icon: "money" },
      { href: "/admin/settings", label: "Settings", icon: "gear" },
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
  return { key: "admin", label: "Platform admin", groups };
}
