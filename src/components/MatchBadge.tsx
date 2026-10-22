import { band } from "@/lib/flatmate-rules";

/** A match score as a ring with the band underneath: Poorly matched, Average match, Excellent match or Perfectly matched. */
export function MatchBadge({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const b = band(score);
  return (
    <div className={`match-badge match-${b.tone} match-${size}`} role="img" aria-label={`${score}% match: ${b.label}`}>
      <span className="match-ring" style={{ ["--pct" as string]: `${score}` }}><span>{score}%</span></span>
      <span className="match-label">{b.label}</span>
    </div>
  );
}
