import { compactNaira, type Stat } from "@/lib/market-rules";

/** A monthly trend as bars; months without enough listings show as gaps, not as zero. */
export function TrendBars({ points, label }: { points: { month: string; median: number | null; n: number }[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.median ?? 0));
  const shown = points.filter((p) => p.median !== null);
  if (shown.length < 2) return <p className="small muted">Not enough listings over the last year to show a trend yet.</p>;
  return (
    <figure className="trend" aria-label={label}>
      <div className="trend-bars" role="list">
        {points.map((p) => (
          <div key={p.month} className="trend-col" role="listitem" aria-label={`${monthName(p.month)}: ${p.median === null ? "not enough listings" : compactNaira(p.median)}`}>
            <span className="trend-val">{p.median === null ? "" : compactNaira(p.median)}</span>
            <span className={`trend-bar${p.median === null ? " gap" : ""}`} style={{ height: `${p.median === null ? 4 : Math.max(6, (p.median / max) * 100)}%` }} />
            <span className="trend-m">{monthName(p.month).slice(0, 3)}</span>
          </div>
        ))}
      </div>
      <figcaption className="small muted">{label}. Median asking figure of homes listed each month; months with too few listings are left blank.</figcaption>
    </figure>
  );
}

/** A median with the middle half of the market as a range. */
export function RangeLine({ s, unit = "" }: { s: Stat | null; unit?: string }) {
  if (!s) return <span className="muted">Not enough listings yet</span>;
  return <span><strong>{compactNaira(s.median)}{unit}</strong> <span className="small muted">most between {compactNaira(s.low)} and {compactNaira(s.high)} · {s.n} listings</span></span>;
}

const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
