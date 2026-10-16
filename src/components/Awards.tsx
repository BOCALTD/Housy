import { PLAQUE_LABEL, monthLabel, type Plaque } from "@/lib/award-rules";

/** The embedded award. It names the month and year, and it is earned, never bought. */
export function PlaqueBadge({ plaque, month }: { plaque: Plaque; month: string }) {
  return (
    <span className={`plaque plaque-${plaque}`}>
      <span aria-hidden="true">{plaque === "GOLD" ? "★" : plaque === "DIAMOND" ? "◆" : "●"}</span>
      <span>Top Agent of the Month</span>
      <span>{monthLabel(month)}</span>
      <span className="sr-only">{PLAQUE_LABEL[plaque]}</span>
    </span>
  );
}
