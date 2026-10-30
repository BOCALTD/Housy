import Link from "next/link";
import type { AccountType } from "@/lib/account-type-rules";

const ICON: Record<AccountType, React.ReactNode> = {
  personal: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" />,
  agent: <path d="M9 7V5a3 3 0 0 1 6 0v2M4 7h16v12H4zM4 12h16" />,
  company: <path d="M4 21V5l8-3v19M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2" />,
};

export const ACCOUNT_COPY: Record<AccountType, {
  tab: string; blurb: string; signInEmail: string; signInIntro: string; joinTitle: string; joinIntro: string; photo: string; points: string[];
}> = {
  personal: {
    tab: "Personal", blurb: "Looking to rent, buy or share", signInEmail: "Email", signInIntro: "Your saved homes, alerts, messages and inspections.",
    joinTitle: "Create your free account", joinIntro: "For anyone looking to rent, buy, lease or find a flatmate.", photo: "/stock/hero-2.jpg",
    points: ["Every photo and detail of each property", "Save homes and get alerts for new ones", "Book inspections and message agents safely", "Find a flatmate who lives the way you do"],
  },
  agent: {
    tab: "Agent", blurb: "I find clients and list property", signInEmail: "Email you registered with", signInIntro: "Your listings, clients, viewings and commission.",
    joinTitle: "Join as an agent", joinIntro: "Your own profile, listings and client book. Agents employed by a company are invited by it instead.", photo: "/stock/buy.jpg",
    points: ["A public profile with your reviews and trust badge", "List property with photos, reels and a street map", "Keep your clients, leads and follow-ups in one place", "Work with other agents and share commission fairly"],
  },
  company: {
    tab: "Company", blurb: "Agency, manager or developer", signInEmail: "Company email", signInIntro: "Your company workspace: listings, tenants, rent and your team.",
    joinTitle: "Register your company", joinIntro: "You become the workspace administrator and invite your agents and staff next.", photo: "/stock/commercial.jpg",
    points: ["Publish listings with photos, offers, reels and a street map", "Get verified and show your trust badge on every listing", "Manage tenants, rent, maintenance, deals and documents", "Invite agents; each gets their own profile and reviews"],
  },
};

/** The three kinds of account, as a segmented control of links (works without JavaScript). */
export function AccountTabs({ current, base, next, cards = false }: { current: AccountType | null; base: "/login" | "/join"; next?: string; cards?: boolean }) {
  const q = (t: AccountType) => `${base}?as=${t}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return (
    <nav className={`acct-tabs${cards ? " cards" : ""}`} aria-label="Kind of account">
      {(Object.keys(ACCOUNT_COPY) as AccountType[]).map((t) => (
        <Link key={t} href={q(t)} className={`acct-tab${t === current ? " on" : ""}`} aria-current={t === current ? "page" : undefined} replace scroll={false}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[t]}</svg>
          <span><strong>{cards ? ACCOUNT_COPY[t].joinTitle : ACCOUNT_COPY[t].tab}</strong><small>{cards ? ACCOUNT_COPY[t].joinIntro : ACCOUNT_COPY[t].blurb}</small></span>
          {cards ? <span className="acct-go" aria-hidden="true">→</span> : null}
        </Link>
      ))}
    </nav>
  );
}
