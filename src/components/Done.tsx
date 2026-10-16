import Link from "next/link";
import { SIMILAR_PURPOSE, type Card } from "@/lib/services/completed";
import { formatDate } from "@/lib/dates";

/** A completed deal card. It shows the kind of property, its area and when it completed, and nothing that identifies the people or the price. */
export function DoneCard({ c }: { c: Card }) {
  const days = Math.floor((Date.now() - c.completedAt.getTime()) / 864e5);
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : formatDate(c.completedAt);
  return (
    <div className="done-card">
      <span className="done-status">{c.status}</span>
      <strong>{[c.bedrooms != null ? `${c.bedrooms}-bedroom` : null, c.category].filter(Boolean).join(" ")}</strong>
      <span className="small muted">{c.area}</span>
      <span className="small muted">Completed {when}</span>
      <Link className="small" href={`/?city=${encodeURIComponent(c.city)}&purpose=${SIMILAR_PURPOSE[c.kind]}`}>See similar available properties</Link>
    </div>
  );
}
