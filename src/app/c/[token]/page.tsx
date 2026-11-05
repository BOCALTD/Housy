import type { Metadata } from "next";
import { viewClientLink } from "@/lib/services/client-files";
import { formatDate } from "@/lib/dates";
import { humanize } from "@/lib/labels";
import { ShowMore } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your property", robots: { index: false, follow: false }, referrer: "no-referrer" };

const ICONS: Record<string, string> = { documents: "📄", inspections: "🧭", inventory: "📦", projects: "🛠️", valuations: "📈" };

/** What a client sees from the private link their agent or company sent: read-only, only the parts that were shared. */
export default async function ClientView({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await viewClientLink(token).catch(() => null);
  if (!v) {
    return (
      <section className="card art-empty" style={{ maxWidth: 560, margin: "40px auto" }}>
        <div className="art-empty-ico" aria-hidden="true">🔒</div>
        <h1>This link has closed</h1>
        <p className="muted">It may have expired or been closed by the company. Ask them to send you a new one.</p>
      </section>
    );
  }
  return (
    <div className="stack-lg cf-client-view">
      <section className="cf-hero">
        <div>
          <p className="eyebrow">{v.companyName} · shared with {v.clientName}</p>
          <h1>{v.asset.name}</h1>
          <p className="muted">{humanize(v.asset.category || v.asset.assetClass)} · {[v.asset.city, v.asset.state].filter(Boolean).join(", ")} · this link works until {formatDate(v.expiresAt)}</p>
        </div>
        <div className="cf-hero-art" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <nav className="cf-jump" aria-label="Sections">{v.sections.map((s) => <a key={s.key} href={`#${s.key}`} className={`cf-tile t-${s.key}`}><span aria-hidden="true">{ICONS[s.key]}</span><b>{s.items.length}</b><small>{s.title}</small></a>)}</nav>
      {v.sections.map((s) => (
        <section key={s.key} id={s.key} className="card stack">
          <h2>{ICONS[s.key]} {s.title}</h2>
          {s.items.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : (
            <ShowMore limit={6} noun="items" items={s.items.map((it) => (
              <div key={it.id} className="cf-item">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  {s.key === "documents" ? <a href={`/c/${token}/doc/${it.id}`} rel="noreferrer"><strong>{it.title}</strong></a> : <strong>{it.title}</strong>}
                  <span className="small muted">{it.detail}</span>
                </div>
                <div className="cf-item-side">{it.amount ? <b>{it.amount}</b> : null}{it.when ? <time className="small muted">{formatDate(it.when)}</time> : null}</div>
              </div>
            ))} />
          )}
        </section>
      ))}
      <p className="small muted">Read-only. Figures come from {v.companyName}&apos;s records on Housy; ask them if something looks wrong.</p>
    </div>
  );
}
