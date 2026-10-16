import { formatKobo } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { TierName } from "@/lib/tier-rules";

// How promotions and plan levels look. Colour is never the only signal: every tag also says what it is in words.

const THEME_CLASS: Record<string, string> = { RED: "t-red", GOLD: "t-gold", GREEN: "t-green", PURPLE: "t-purple", BLUE: "t-blue" };

export function PromoRibbon({ name, pct, theme }: { name: string; pct: number; theme: string }) {
  return (
    <span className={`promo-ribbon ${THEME_CLASS[theme] ?? "t-red"}`}>
      <span className="promo-spark" aria-hidden="true">✦</span>
      <span className="promo-name">{name}</span>
      <span className="promo-pct">{pct}% off</span>
    </span>
  );
}

/** The listed price struck through in red and the reviewed price in green. */
export function PriceBlock({ priceKobo, promo, suffix }: { priceKobo: bigint; promo?: { originalKobo: bigint; promoKobo: bigint; pct: number } | null; suffix?: string }) {
  if (!promo) return <span className="price">{formatKobo(priceKobo)}{suffix}</span>;
  return (
    <span className="price-promo">
      <span className="sr-only">Was </span><s className="price-was">{formatKobo(promo.originalKobo)}</s>
      <span className="sr-only"> now </span><strong className="price-now">{formatKobo(promo.promoKobo)}{suffix}</strong>
      <span className="price-save">You save {formatKobo(promo.originalKobo - promo.promoKobo)}</span>
    </span>
  );
}

export function PromoEnds({ endsOn }: { endsOn: Date }) {
  return <span className="small muted">Offer ends {formatDate(endsOn)}</span>;
}

export function GoldBadge({ tier }: { tier: TierName }) {
  if (tier !== "GOLD") return null;
  return <span className="gold-badge" title="Gold member: reviewed and subscribed at the top level"><span aria-hidden="true">★</span> Gold</span>;
}
export function PremiumTag({ tier }: { tier: TierName }) {
  if (tier !== "GOLD") return null;
  return <span className="premium-tag">Premium listing</span>;
}
