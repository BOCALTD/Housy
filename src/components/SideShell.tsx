import type { SideGroup } from "./nav-types";
export type { IconName, SideItem, SideGroup } from "./nav-types";

/**
 * A section of the site (the workspace, the account, portals, platform administration). Its links now live in the main side
 * panel (components/Frame.tsx, built from lib/nav.ts), so a section only adds a heading strip naming where you are.
 */
export function SideShell({ title, subtitle, label, children }: { title: string; subtitle?: string; label: string; groups?: SideGroup[]; children: React.ReactNode }) {
  const initials = title.replace(/\[[^\]]*\]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "•";
  return (
    <div className="section">
      <div className="section-strip">
        <span className="section-avatar" aria-hidden="true">{initials}</span>
        <span className="section-text"><span className="section-label">{label}</span><strong>{title}</strong>{subtitle ? <span className="small muted">{subtitle}</span> : null}</span>
      </div>
      {children}
    </div>
  );
}
