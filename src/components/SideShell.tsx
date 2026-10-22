"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export type IconName = keyof typeof Icon;
export type SideItem = { href: string; label: string; icon?: IconName; badge?: number };
export type SideGroup = { label: string; items: SideItem[] };

function activeHref(pathname: string, groups: SideGroup[]) {
  // The longest matching link wins, so /app/maintenance/x highlights Maintenance and not Dashboard.
  let best = "";
  for (const g of groups) for (const i of g.items) {
    const h = i.href.split("?")[0];
    if ((pathname === h || pathname.startsWith(h + "/")) && h.length > best.length) best = h;
  }
  return best;
}

/**
 * The side menu used by the workspace, the account, portals and platform administration (the same pattern as Strata):
 * a column of grouped links beside the page on wide screens, and a drawer that slides in from the left on phones and
 * tablets. Groups fold, and the group holding the current page opens itself, so the menu never runs down the page.
 */
export function SideShell({ title, subtitle, label, groups, children }: { title: string; subtitle?: string; label: string; groups: SideGroup[]; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  const active = activeHref(pathname, groups);
  const current = groups.flatMap((g) => g.items).find((i) => i.href.split("?")[0] === active);
  const initials = title.replace(/\[[^\]]*\]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "•";

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); openBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
  }, [open]);

  return (
    <div className={`shell${open ? " drawer-open" : ""}`}>
      <aside className="shell-side">
        <div className="shell-who">
          <span className="shell-avatar" aria-hidden="true">{initials}</span>
          <span className="shell-who-text"><strong>{title}</strong>{subtitle ? <span className="small muted">{subtitle}</span> : null}</span>
          <button ref={closeBtn} type="button" className="shell-close" aria-label="Close menu" onClick={() => { setOpen(false); openBtn.current?.focus(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <nav className="shell-nav" aria-label={label}>
          {groups.filter((g) => g.items.length).map((g, gi) => {
            const holdsActive = g.items.some((i) => i.href.split("?")[0] === active);
            return (
              <details key={g.label} className="shell-group" open={holdsActive || gi === 0}>
                <summary>{g.label}<span className="shell-count">{g.items.length}</span></summary>
                <ul>
                  {g.items.map((i) => {
                    const on = i.href.split("?")[0] === active;
                    const Ico = i.icon ? Icon[i.icon] : null;
                    return (
                      <li key={i.href}>
                        <Link href={i.href} className={`shell-link${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
                          {Ico ? <Ico /> : <span className="shell-dot" aria-hidden="true" />}
                          <span>{i.label}</span>
                          {i.badge ? <em className="shell-badge">{i.badge}<span className="sr-only"> new</span></em> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </nav>
      </aside>
      <div className="shell-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      <div className="shell-main">
        <button ref={openBtn} type="button" className="shell-open" aria-expanded={open} aria-label={`Open the ${label.toLowerCase()} menu`} onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          <span><strong>{current?.label ?? title}</strong><span className="small muted"> · {label}</span></span>
        </button>
        {children}
      </div>
    </div>
  );
}
