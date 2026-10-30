import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/labels";
import { Logo } from "./Logo";
import { InstallButton } from "./Pwa";

const COLS: { title: string; links: [string, string][] }[] = [
  { title: "Explore", links: [["/?purpose=SALE", "Buy property"], ["/?purpose=RENT", "Rent property"], ["/?purpose=LEASE", "Lease property"], ["/map", "Map search"], ["/flatmates", "Find a flatmate"], ["/reels", "Property reels"], ["/completed", "Recently completed"], ["/compare", "Compare properties"], ["/calculators", "Property calculators"], ["/market", "Market prices"]] },
  { title: "Professionals", links: [["/directory?kind=companies", "Companies"], ["/directory?kind=agents", "Agents"], ["/directory?kind=developers", "Developers"], ["/awards", "Top agents"], ["/join?as=company", "Register a company"], ["/join?as=agent", "Join as an agent"], ["/pricing", "Plans and pricing"], ["/api/v1/openapi", "Developer API"]] },
  { title: "Help", links: [["/how-it-works", "How it works"], ["/trust", "Trust and Safety Centre"], ["/safety", "Safety and verification"], ["/faq", "Questions and answers"], ["/reviews", "Reviews"], ["/support", "Contact and support"]] },
  { title: "Earn and share", links: [["/referrals", "Refer and earn"], ["/vacancies", "Report a vacancy"], ["/about", "About us"], ["/support", "Partner with us"]] },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <strong><Logo height={36} tone="light" /></strong>
            <p>Find property from verified companies and agents, check before you pay, and manage property portfolios in one place.</p>
            <InstallButton />
          </div>
          {COLS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h3>{c.title}</h3>
              <ul>{c.links.map(([href, label]) => <li key={label}><Link href={href}>{label}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="foot-bottom">
          <span>© {year} {PLATFORM_NAME}. Prices are in Nigerian naira unless stated.</span>
          <span>Verification badges describe checks on identity and business records. They are not a guarantee about any property.</span>
        </div>
      </div>
    </footer>
  );
}
