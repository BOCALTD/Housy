import Link from "next/link";
import { requireUser, getMember } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { myCompanies } from "@/lib/services/companies";
import { logoutAction } from "@/app/auth-actions";
import { Icon } from "@/components/Icons";

export const metadata = { title: "Profile and settings" };
export const dynamic = "force-dynamic";

const ROWS: { href: string; title: string; text: string; icon: keyof typeof Icon }[] = [
  { href: "/me/verification", title: "Verification", text: "Prove who you are so agents and companies trust your enquiries.", icon: "shield" },
  { href: "/me/security", title: "Security", text: "Password, two-step sign-in and the devices signed in to your account.", icon: "lock" },
  { href: "/me/notification-settings", title: "Notifications and email", text: "Choose which alerts and emails you get.", icon: "bell" },
  { href: "/me/privacy", title: "Privacy and my data", text: "Download your data, control suggestions, or delete your account.", icon: "doc" },
  { href: "/me/plan", title: "Plan and billing", text: "Your plan, invoices and payments.", icon: "money" },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const [member, companies] = await Promise.all([getMember(), myCompanies(user.id).catch(() => [])]);
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  return (
    <div className="stack-lg">
      <section className="profile-hero">
        <div className="profile-cover" aria-hidden="true" />
        <div className="profile-row">
          <span className="profile-avatar" aria-hidden="true">{initials}</span>
          <div className="profile-id">
            <h1>{user.name}</h1>
            <p className="muted">{user.email}</p>
            <p className="profile-role">{member ? `${ROLE_LABELS[member.role]} at ${member.companyName}` : "Personal account"}</p>
          </div>
        </div>
      </section>

      {companies.length > 0 ? (
        <section className="card stack">
          <h2>Your workspaces</h2>
          <p className="muted">You use Housy as yourself and as a member of {companies.length === 1 ? "a company" : `${companies.length} companies`}.</p>
          <div className="row"><Link className="btn primary" href="/app">Open the workspace</Link><Link className="btn" href="/app/switch">Switch company</Link></div>
        </section>
      ) : null}

      <section className="card settings-list" aria-label="Settings">
        {ROWS.map((r) => {
          const I = Icon[r.icon];
          return (
            <Link key={r.href} href={r.href} className="settings-row">
              <span className="settings-ico"><I /></span>
              <span className="settings-text"><strong>{r.title}</strong><span>{r.text}</span></span>
              <span className="settings-go" aria-hidden="true">›</span>
            </Link>
          );
        })}
      </section>

      <section className="card stack">
        <h2>Sign out</h2>
        <p className="muted">Sign out of Housy on this device. Your saved homes, chats and alerts stay in your account.</p>
        <form action={logoutAction}><button className="btn danger-soft" type="submit">Sign out</button></form>
      </section>
    </div>
  );
}
