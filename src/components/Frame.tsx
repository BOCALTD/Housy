"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { Logo, LogoMark } from "./Logo";
import type { NavSection } from "@/lib/nav";
import type { SideGroup } from "./nav-types";

export type FrameUser = { name: string; email: string; roleLabel: string; avatarUrl?: string | null; isAdmin: boolean };
export type FrameNotice = { id: string; title: string; body: string; link: string; at: string; unread: boolean };

const TOP_LEVEL = /^\/(?:|browse|map|reels|flatmates|market|directory|me|app|admin|messages|login|join|compare|calculators|awards|blog)$/;

function initials(s: string) { return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "•"; }

/** The link that matches the current page best: the longest path that the page starts with (query strings must match too). */
function activeKey(path: string, search: string, sections: NavSection[]) {
  let best = "", bestLen = -1;
  for (const s of sections) for (const g of s.groups) for (const i of g.items) {
    const [h, q] = i.href.split("?");
    const pathOk = path === h || (h !== "/" && path.startsWith(h + "/"));
    const queryOk = !q || q.split("&").every((kv) => search.includes(kv));
    const len = h.length + (q ? q.length : 0);
    if (pathOk && queryOk && len > bestLen) { best = i.href; bestLen = len; }
  }
  return best;
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function Groups({ groups, active, defaultOpen }: { groups: SideGroup[]; active: string; defaultOpen: boolean }) {
  return (
    <>
      {groups.filter((g) => g.items.length).map((g, gi) => {
        const holds = g.items.some((i) => i.href === active);
        return (
          <details key={g.label} className="rail-group" open={holds || (defaultOpen && gi < 2)}>
            <summary>{g.label}</summary>
            <ul>
              {g.items.map((i) => {
                const on = i.href === active;
                const Ico = i.icon ? Icon[i.icon] : null;
                return (
                  <li key={i.href}>
                    <Link href={i.href} className={`rail-link${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
                      {Ico ? <Ico /> : <span className="rail-dot" aria-hidden="true" />}
                      <span>{i.label}</span>
                      {i.badge ? <em className="rail-badge">{i.badge > 99 ? "99+" : i.badge}<span className="sr-only"> new</span></em> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </>
  );
}

/**
 * The frame every page sits in (the same pattern as Celia): a dark side panel with every section the person can use, a
 * sticky top bar with Back, search, the notification bell and the profile, and on phones a drawer plus a bottom tab bar.
 * Everything still works before (or without) the page's script: the menu opens through #rail, and the bell and Back are
 * ordinary links.
 */
export function Frame({ sections, user, notices, unreadNotices, unreadMessages, markAllRead, children }: {
  sections: NavSection[]; user: FrameUser | null; notices: FrameNotice[]; unreadNotices: number; unreadMessages: number;
  markAllRead: (form: FormData) => Promise<void>; children: React.ReactNode;
}) {
  const path = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const active = activeKey(path, search, sections);
  const current = sections.flatMap((s) => s.groups.flatMap((g) => g.items)).find((i) => i.href === active);
  const showBack = !TOP_LEVEL.test(path);
  const parent = path.split("/").slice(0, -1).join("/") || "/";

  useEffect(() => { setOpen(false); setBell(false); if (location.hash === "#rail") history.replaceState(null, "", location.pathname + location.search); }, [path, search]);
  useEffect(() => {
    document.body.classList.toggle("no-scroll", open);
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  useEffect(() => {
    if (!bell) return;
    const out = (e: MouseEvent) => { if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setBell(false); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", k); };
  }, [bell]);

  const tabs = [
    { href: "/", label: "Home", icon: Icon.home, on: path === "/" },
    { href: "/browse", label: "Find", icon: Icon.search, on: path.startsWith("/browse") || path.startsWith("/properties") || path === "/map" },
    { href: "/reels", label: "Reels", icon: Icon.play, on: path.startsWith("/reels") },
    { href: user ? "/messages" : "/flatmates", label: user ? "Chats" : "Flatmates", icon: user ? Icon.chat : Icon.people, on: user ? path.startsWith("/messages") : path.startsWith("/flatmates"), badge: user ? unreadMessages : 0 },
    { href: user ? "/me" : "/login", label: user ? "Me" : "Sign in", icon: Icon.person, on: path.startsWith("/me") || path === "/login" },
  ];

  return (
    <div className={`frame${open ? " drawer-open" : ""}`}>
      <aside className="rail" id="rail" aria-label="Main menu">
        <div className="rail-head">
          <Link href="/" className="rail-logo" aria-label="Housy home"><Logo height={30} tone="light" /></Link>
          <a href="#" className="rail-close" aria-label="Close menu" onClick={(e) => { e.preventDefault(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </a>
        </div>
        <form action="/browse" className="rail-search" role="search">
          <Icon.search />
          <input name="q" type="search" placeholder="Search area, estate or street" aria-label="Search property" enterKeyHint="search" />
        </form>
        <nav className="rail-nav" aria-label="Sections">
          {sections.map((s, si) => (
            <div key={s.key} className={`rail-section rail-${s.key}`}>
              {si > 0 ? <p className="rail-section-label">{s.label}</p> : null}
              <Groups groups={s.groups} active={active} defaultOpen={s.key === "explore"} />
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          {user ? (
            <Link href="/me/settings" className="rail-me">
              <span className="avatar" aria-hidden="true">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span>
              <span className="rail-me-text"><strong>{user.name}</strong><span>{user.roleLabel}</span></span>
              <Icon.gear />
            </Link>
          ) : (
            <div className="rail-guest">
              <Link className="btn primary" href="/login">Sign in</Link>
              <Link className="rail-join" href="/join">New here? Create a free account</Link>
            </div>
          )}
        </div>
      </aside>
      <a href="#" className="frame-scrim" aria-label="Close the menu" tabIndex={-1} onClick={(e) => { e.preventDefault(); setOpen(false); }} />

      <div className="frame-main">
        <header className="bar">
          <a href="#rail" className="bar-btn menu-btn" aria-label="Open menu" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(true); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h16M4 12h10M4 17h16" /></svg>
          </a>
          <Link href="/" className="bar-mark" aria-label="Housy home"><LogoMark size={34} tile /></Link>
          {showBack ? (
            <a href={parent} className="bar-btn bar-back" aria-label="Go back" onClick={(e) => {
              if (window.history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); window.history.back(); }
            }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
              <span>Back</span>
            </a>
          ) : null}
          <p className="bar-title">{current?.label ?? ""}</p>
          <span className="bar-spacer" />
          <form action="/browse" className="bar-search" role="search">
            <Icon.search />
            <input name="q" type="search" placeholder="Search Lekki, Wuse 2, Ikeja GRA…" aria-label="Search property" enterKeyHint="search" />
          </form>
          {user ? (
            <div className="bell" ref={bellRef}>
              <a href="/me/notifications" className="bar-btn bell-btn" aria-label={`Notifications${unreadNotices ? `, ${unreadNotices} unread` : ""}`} aria-expanded={bell}
                onClick={(e) => { e.preventDefault(); setBell((b) => !b); }}>
                <Icon.bell />
                {unreadNotices ? <span className="bell-count" aria-hidden="true">{unreadNotices > 99 ? "99+" : unreadNotices}</span> : null}
              </a>
              {bell ? (
                <div className="bell-panel" role="dialog" aria-label="Notifications">
                  <div className="bell-head">
                    <strong>Notifications</strong>
                    {unreadNotices ? <form action={markAllRead}><button type="submit" className="link-btn">Mark all as read</button></form> : null}
                  </div>
                  {notices.length ? (
                    <ul className="bell-list">
                      {notices.map((n) => (
                        <li key={n.id} className={n.unread ? "unread" : ""}>
                          <Link href={n.link || "/me/notifications"} onClick={() => setBell(false)}>
                            <span className="bell-dot" aria-hidden="true" />
                            <span className="bell-text"><strong>{n.title}</strong>{n.body ? <span>{n.body}</span> : null}<time>{ago(n.at)}</time></span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="bell-empty">You are all caught up. New messages, inspection updates and offers will show here.</p>}
                  <Link href="/me/notifications" className="bell-all" onClick={() => setBell(false)}>See all notifications</Link>
                </div>
              ) : null}
            </div>
          ) : null}
          {user ? (
            <Link href="/me/settings" className="bar-avatar" aria-label="Your profile and settings">
              <span className="avatar" aria-hidden="true">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</span>
            </Link>
          ) : (
            <Link href="/login" className="btn primary small bar-signin">Sign in</Link>
          )}
        </header>
        {children}
      </div>

      <nav className="tabbar" aria-label="Quick links">
        {tabs.map((t) => (
          <Link key={t.label} href={t.href} className={t.on ? "on" : ""} aria-current={t.on ? "page" : undefined}>
            <t.icon />
            <span>{t.label}</span>
            {t.badge ? <em aria-label={`${t.badge} unread`}>{t.badge > 9 ? "9+" : t.badge}</em> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
