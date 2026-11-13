import type { Kpis } from "@/lib/verification-quality-rules";

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
const num = (n: number | null, unit: string) => (n === null ? "—" : `${n} ${unit}`);

/** The performance indicators, as a responsive grid of figures. */
export function KpiGrid({ k }: { k: Kpis }) {
  const tile = (value: string, label: string, sub?: string) => (
    <div className="card"><span className="vp-stat">{value}</span><span className="small muted">{label}</span>{sub ? <span className="small muted">{sub}</span> : null}</div>
  );
  return (
    <div className="vp-kpis">
      {tile(pct(k.acceptanceRate), "Cases accepted", `${k.accepted} of ${k.offered} answered offers`)}
      {tile(num(k.medianHoursToAnswer, "h"), "Typical time to answer an offer")}
      {tile(pct(k.onTimeRate), "Reports on time", `${k.delivered} delivered`)}
      {tile(num(k.medianDaysToDeliver, "days"), "Typical time from acceptance to delivery")}
      {tile(pct(k.correctionRate), "Reports Housy sent back")}
      {tile(String(k.disputes), "Disputes", `${k.disputesUpheld} reopened`)}
      {tile(String(k.revoked), "Reports revoked")}
      {tile(k.averageRating === null ? "—" : `${k.averageRating} / 5`, "Customer rating", `${k.ratings} rating${k.ratings === 1 ? "" : "s"}`)}
      {tile(String(k.complaints), "Complaints", `${k.complaintsUpheld} upheld`)}
    </div>
  );
}
