import Link from "next/link";
import { PropPhoto } from "./ui";
import { GoldBadge, PremiumTag, PriceBlock, PromoRibbon } from "./Promo";
import type { TierName } from "@/lib/tier-rules";
import { keyFacts, priceSuffix } from "@/lib/listing-rules";

type L = { id: string; publicRef: string; title: string; purpose: string; priceKobo: bigint; bedrooms: number | null; bathrooms: number | null; city: string; state: string; propertyType: string; pricePeriod: string; toilets: number | null; buildingSqm: number | null; landSqm: number | null; furnishing: string; negotiable: boolean; coverPhotoId: string | null; tier: TierName; promo: { campaignName: string; pct: number; theme: string; originalKobo: bigint; promoKobo: bigint } | null };

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
        </span>
        <strong>{l.title}</strong>
        <PriceBlock priceKobo={l.priceKobo} promo={l.promo} suffix={priceSuffix(l.pricePeriod)} />
        <span className="small muted">{[...keyFacts(l, typeLabels).slice(0, 4), `${l.city}, ${l.state}`].join(" · ")}{l.negotiable ? " · Negotiable" : ""}</span>
      </div>
    </Link>
  );
}
