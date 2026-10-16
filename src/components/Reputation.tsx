import { BADGES, BASIS_LABEL, CATEGORIES, type BadgeKey } from "@/lib/reputation-rules";
import { formatDate } from "@/lib/dates";
import type { PublicReview } from "@/lib/services/reviews";

// Earned reputation. Nothing on this page can be bought, and it is kept visibly apart from "Premium" and promotion tags.

export function BadgeRow({ badges }: { badges: string[] }) {
  if (!badges.length) return null;
  return <span className="promo-tags">{badges.map((b) => <span key={b} className="rep-badge" title={BADGES[b as BadgeKey]?.how}>{BADGES[b as BadgeKey]?.label ?? b}</span>)}</span>;
}
export function ScoreLine({ score, count, average }: { score: number; count: number; average: number }) {
  return (
    <span className="rep-score">
      <strong>Reputation {score}/100</strong>
      <span className="small muted">{count === 0 ? "No reviews yet" : `${average.toFixed(1)} out of 5 from ${count} verified ${count === 1 ? "review" : "reviews"}`}</span>
    </span>
  );
}
export function ReviewCard({ r, report }: { r: PublicReview; report?: React.ReactNode }) {
  const scores = CATEGORIES.filter((c) => r.scores[c.key] != null);
  return (
    <div className="stack" style={{ width: "100%", gap: 6 }}>
      <div className="row between"><div><strong>{r.overall} out of 5</strong> <span className="small muted">{r.who} · {formatDate(r.createdAt)}</span></div><span className="pill disc">{BASIS_LABEL[r.basis]}</span></div>
      {r.body ? <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.body}</p> : null}
      {scores.length ? <details className="inline"><summary>Ratings by area</summary><ul className="timeline">{scores.map((c) => <li key={c.key}>{c.label}: <strong>{r.scores[c.key]}</strong> out of 5</li>)}</ul></details> : null}
      {r.response ? <div className="flash" style={{ background: "var(--surface-2)" }}><strong>Reply from the reviewed party:</strong> <span style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.response}</span></div> : null}
      {report}
    </div>
  );
}
export function RatingFields({ prefix = "" }: { prefix?: string }) {
  const Stars = ({ name, label, required }: { name: string; label: string; required?: boolean }) => (
    <fieldset className="stars"><legend className="small">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name={prefix + name} value={n} required={required} aria-label={`${n} out of 5`} /><span aria-hidden="true">{n}</span></label>)}</fieldset>
  );
  return (
    <>
      <Stars name="overall" label="Overall" required />
      <details className="inline"><summary>Rate particular areas (optional)</summary>
        <div className="stack">{CATEGORIES.map((c) => <Stars key={c.key} name={c.key} label={c.label} />)}</div></details>
    </>
  );
}
