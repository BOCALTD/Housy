import Link from "next/link";
import { PhoneField } from "@/components/PhoneField";
import { getSession, requireUser } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { profileFor } from "@/lib/services/profile";
import { SignOutButton } from "@/components/SessionSwitch";
import { Icon } from "@/components/Icons";
import { ProfileMedia } from "@/components/ProfileMedia";
import { ThemeChoice } from "@/components/ThemeSwitch";
import { getSearchPref } from "@/lib/services/search-prefs";
import { cookies } from "next/headers";
import { clearSearchPrefAction, saveSearchPrefAction } from "./actions";
import { becomeAgentAction, removeProfileImageAction, switchModeAction, takeBreakAction, updateAboutAction, uploadProfileImageAction } from "./actions";

export const metadata = { title: "Profile and settings" };
export const dynamic = "force-dynamic";

const ROWS: { href: string; title: string; text: string; icon: keyof typeof Icon }[] = [
  { href: "/me/verification", title: "Verification", text: "Prove who you are so agents and companies trust your enquiries.", icon: "shield" },
  { href: "/me/security", title: "Password and security", text: "Password, two-step sign-in and the devices signed in to your account.", icon: "lock" },
  { href: "/me/notification-settings", title: "Notifications and email", text: "Choose which alerts and emails you get.", icon: "bell" },
  { href: "/me/privacy", title: "Privacy and my data", text: "Download your data and control suggestions.", icon: "doc" },
  { href: "/me/plan", title: "Plan and billing", text: "Your plan, invoices and payments.", icon: "money" },
  { href: "/?intro=1", title: "Welcome tour", text: "See the four welcome slides again.", icon: "sparkle" },
];

export default async function SettingsPage() {
  const tc = (await cookies()).get("theme")?.value;
  const theme = tc === "light" || tc === "dark" ? tc : "system";
  const user = await requireUser();
  const [p, session, myPref] = await Promise.all([profileFor(user.id), getSession(), getSearchPref(user.id).catch(() => null)]);
  const activeCompany = session?.companyId ?? null;
  const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const modes = [
    { to: "personal", title: "Me", text: "Look for property, chat, save homes and find flatmates.", on: !activeCompany, icon: "person" as const },
    ...(p.agentBusiness ? [{ to: p.agentBusiness.companyId, title: "Agent", text: p.agentBusiness.company.name, on: activeCompany === p.agentBusiness.companyId, icon: "handshake" as const }] : []),
    ...p.companies.map((c) => ({ to: c.companyId, title: c.company.name, text: ROLE_LABELS[c.role as Role] ?? c.role, on: activeCompany === c.companyId, icon: "building" as const })),
  ];
  return (
    <div className="stack-lg">
      <section className="profile-hero">
        <div className="profile-cover" style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}>
          <ProfileMedia kind="cover" label={p.coverUrl ? "Change cover" : "Add a cover photo"} hasImage={!!p.coverUrl} action={uploadProfileImageAction} remove={removeProfileImageAction} />
        </div>
        <div className="profile-row">
          <div className="profile-avatar-wrap">
            <span className="profile-avatar" aria-hidden="true">{p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : initials}</span>
            <ProfileMedia kind="avatar" label={p.avatarUrl ? "Change photo" : "Add a photo"} hasImage={!!p.avatarUrl} action={uploadProfileImageAction} remove={removeProfileImageAction} />
          </div>
          <div className="profile-id">
            <h1>{p.name}</h1>
            <p className="muted">{p.email}</p>
            {p.bio ? <p className="profile-bio">{p.bio}</p> : null}
            <p className="profile-role">{modes.find((m) => m.on)?.title === "Me" ? "Using Housy as yourself" : `Working as ${modes.find((m) => m.on)?.title ?? "yourself"}`}</p>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="mode-h">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="mode-h">Use Housy as</h2>
          <p className="muted">One account, every hat you wear. Switch any time; nothing is lost.</p>
        </div>
        <div className="mode-grid">
          {modes.map((m) => {
            const I = Icon[m.icon];
            return (
              <form key={m.to} action={switchModeAction} className={`mode-card${m.on ? " on" : ""}`}>
                <input type="hidden" name="to" value={m.to} />
                <button type="submit" disabled={m.on} aria-pressed={m.on}>
                  <span className="mode-ico"><I /></span>
                  <span className="mode-text"><strong>{m.title}</strong><span>{m.text}</span></span>
                  <span className="mode-state">{m.on ? "In use" : "Switch"}</span>
                </button>
              </form>
            );
          })}
        </div>
        {!p.agentBusiness ? (
          <details className="disclose">
            <summary>Work as an agent too</summary>
            <form action={becomeAgentAction} className="stack" style={{ marginTop: 12 }}>
              <p className="muted small">You keep this account. You get an agent workspace for your listings, clients and deals, and can switch back to your personal side with one tap.</p>
              <div className="fields">
                <label className="field">Trading name (optional)<input name="tradingName" maxLength={80} placeholder="e.g. Ada Homes" /></label>
                <PhoneField label="Phone clients can call" required />
              </div>
              <button className="btn primary" type="submit">Create my agent workspace</button>
            </form>
          </details>
        ) : null}
      </section>

      <section className="card stack" id="my-search" aria-labelledby="mysearch-h">
        <h2 id="mysearch-h">My search</h2>
        <p className="small muted">Tell us once what you are looking for. Your home page shows the best matches first, reels start with homes that fit, and search is one tap away. Change or clear it any time.</p>
        <form action={saveSearchPrefAction} className="stack">
          <div className="fields">
            <label className="field">Where<input name="city" maxLength={80} defaultValue={myPref?.city ?? ""} placeholder="City or area, e.g. Lekki" /></label>
            <label className="field">Rent or buy<select name="purpose" defaultValue={myPref?.purpose ?? ""}><option value="">Either</option><option value="RENT">Rent</option><option value="SALE">Buy</option></select></label>
            <label className="field">Budget (₦)<input name="maxPrice" inputMode="numeric" data-money defaultValue={myPref?.maxNaira ? String(Math.round(myPref.maxNaira)) : ""} placeholder="Most you want to pay" /></label>
            <label className="field">Bedrooms, at least<input name="minBeds" inputMode="numeric" maxLength={2} defaultValue={myPref?.minBeds ?? ""} /></label>
          </div>
          <p className="small muted">For rent, the budget is for a year.</p>
          <div className="row"><button className="btn primary" type="submit">Save my search</button></div>
        </form>
        {myPref ? <form action={clearSearchPrefAction}><button className="btn" type="submit" data-confirm="Clear your search?" data-confirm-body="Best matches stop until you set it again." data-confirm-ok="Clear" data-confirm-tone="default">Clear my search</button></form> : null}
      </section>

      <section className="card stack" aria-labelledby="look-h">
        <h2 id="look-h">Appearance</h2>
        <p className="small muted">Choose light or dark, or follow the setting on this device. Saved on this browser.</p>
        <ThemeChoice initial={theme} />
      </section>

      <section className="card stack" aria-labelledby="about-h">
        <h2 id="about-h">About you</h2>
        <form action={updateAboutAction} className="stack">
          <label className="field">Name<input name="name" required minLength={2} maxLength={80} defaultValue={p.name} autoComplete="name" /></label>
          <label className="field">Bio<textarea name="bio" maxLength={280} rows={3} defaultValue={p.bio} placeholder="A line about you: what you are looking for, or what you do." /></label>
          <button className="btn primary" type="submit">Save profile</button>
        </form>
      </section>

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

      <section className="card stack" aria-labelledby="leave-h">
        <h2 id="leave-h">Sign out, take a break or leave</h2>
        <div className="leave-grid">
          <div className="leave-card">
            <h3>Sign out</h3>
            <p className="muted small">Sign out on this device. Everything stays in your account.</p>
            <SignOutButton name={user.name} />
          </div>
          <details className="leave-card">
            <summary><h3>Take a break</h3><span className="muted small">Hide your profile and pause emails. Signing in again ends the break.</span></summary>
            <form action={takeBreakAction} className="stack" style={{ marginTop: 10 }}>
              <fieldset className="choice-row">
                <legend className="small muted">For how long?</legend>
                {[["week", "A week"], ["month", "A month"], ["quarter", "Three months"], ["open", "Until I come back"]].map(([v, l], i) => (
                  <label key={v} className="chip-choice"><input type="radio" name="length" value={v} defaultChecked={i === 1} /><span>{l}</span></label>
                ))}
              </fieldset>
              <ul className="check-list small">
                <li>Your profile, photo and listings in the directory are hidden.</li>
                <li>Emails stop, except security and billing.</li>
                <li>You are signed out on every device. Your chats, saved homes and data are kept.</li>
              </ul>
              <label className="check"><input type="checkbox" name="confirm" value="yes" required /><span>I want to take a break</span></label>
              <button className="btn" type="submit" data-confirm="Start your break?" data-confirm-body="You are signed out on every device, your profile is hidden and emails pause. Signing in again ends the break." data-confirm-ok="Start my break" data-confirm-tone="default">Start my break</button>
            </form>
          </details>
          <div className="leave-card danger-zone">
            <h3>Delete account</h3>
            <p className="muted small">Removes your account for good. You confirm with your password.</p>
            <Link className="btn danger-soft" href="/me/privacy#delete">Delete my account…</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
