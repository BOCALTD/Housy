import Link from "next/link";
import { formatDate } from "@/lib/dates";
import type { PublicTrust } from "@/lib/services/kyc";

/** The trust level of a company or agent, from identity and business checks done by people. Small form for cards; full form lists each check with its scope and date. */
export function TrustBadge({ t, full = false }: { t: PublicTrust; full?: boolean }) {
  const mark = t.level === 3 ? "★" : t.level === 2 ? "✓" : t.level === 1 ? "•" : "–";
  const badge = <span className={`trust l${t.level}`} title={`${t.passed.length} of ${t.total} checks passed`}><i aria-hidden="true">{mark}</i>{t.levelName}{t.level > 0 ? ` · ${t.passed.length}/${t.total}` : ""}</span>;
  if (!full) return badge;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">{badge}<Link className="small tap" href="/safety">What the levels mean</Link></div>
      {t.checks.length ? (
        <ul className="check-list small">{t.checks.map((c) => <li key={c.code}><span><strong>{c.scope}</strong> on {formatDate(c.verifiedAt)}{c.expiresAt ? `, valid until ${formatDate(c.expiresAt)}` : ""}</span></li>)}</ul>
      ) : <p className="small muted">No checks have been completed yet.</p>}
    </div>
  );
}
