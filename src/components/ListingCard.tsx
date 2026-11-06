import Link from "next/link";
import { PropPhoto } from "./ui";
import { GoldBadge, PremiumTag, PriceBlock, PromoRibbon } from "./Promo";
import type { TierName } from "@/lib/tier-rules";
import { keyFacts, priceSuffix } from "@/lib/listing-rules";

type L = { id: string; publicRef: string; title: string; purpose: string; priceKobo: bigint; bedrooms: number | null; bathrooms: number | null; city: string; state: string; propertyType: string; pricePeriod: string; toilets: number | null; buildingSqm: number | null; landSqm: number | null; furnishing: string; negotiable: boolean; coverPhotoId: string | null; tier: TierName; promo: { campaignName: string; pct: number; theme: string; originalKobo: bigint; promoKobo: bigint } | null;
  /** From Best match (lib/match-rules.ts): how the price compares with the area, why it ranks here, and copies of the same home. */
  verdict?: { kind: "good" | "fair" | "high"; pct: number } | null; matchWhy?: string[]; alsoListed?: { publicRef: string }[] };

/** One property card, used in carousels and result grids. */
export function ListingCard({ l, typeLabels }: { l: L; typeLabels?: Record<string, string> }) {
  return (
    <Link href={`/properties/${l.publicRef}`} className={`prop${l.promo ? " has-promo" : ""}`}>
      <div className="prop-img"><PropPhoto id={l.coverPhotoId} /></div>
      <div className="prop-body">
        {l.promo ? <PromoRibbon name={l.promo.campaignName} pct={l.promo.pct} theme={l.promo.theme} /> : null}
        <span className="promo-tags">
          <span className="pill brand">{l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`}</span>
          <PremiumTag tier={l.tier} /><GoldBadge tier={l.tier} />
          {l.verdict?.kind === "good" ? <span className="pill ok good-price" title={`About ${Math.abs(l.verdict.pct)}% under the typical price for this kind of home in ${l.city}`}>Good price</span> : null}
        </span>
        <strong>{l.title}</strong>
        <PriceBlock priceKobo={l.priceKobo} promo={l.promo} suffix={priceSuffix(l.pricePeriod)} />
        <span className="small muted">{[...keyFacts(l, typeLabels).slice(0, 4), `${l.city}, ${l.state}`].join(" · ")}{l.negotiable ? " · Negotiable" : ""}</span>
        {l.matchWhy?.filter((w) => !w.startsWith("Good price")).length ? <span className="match-why">{l.matchWhy.filter((w) => !w.startsWith("Good price")).slice(0, 2).map((w) => <em key={w}>{w}</em>)}</span> : null}
        {l.alsoListed?.length ? <span className="small muted">Also listed by {l.alsoListed.length} other {l.alsoListed.length === 1 ? "agent" : "agents"}</span> : null}
      </div>
    </Link>
  );
}
