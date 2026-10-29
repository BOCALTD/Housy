import { getPublicListing } from "@/lib/services/listings";
import { CARD_SIZE, cardPhoto, shareCard } from "@/lib/share-card";
import { formatKobo } from "@/lib/money";
import { priceSuffix } from "@/lib/listing-rules";

// The link-preview picture for a shared property: its first photo, price and place.
export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "A property for sale or rent";

export default async function Image({ params }: { params: Promise<{ ref: string }> }) {
  const l = await getPublicListing((await params).ref);
  if (!l) return shareCard({ eyebrow: "Property", title: "This property is no longer listed", lines: [], cta: "See similar homes" });
  return shareCard({
    photo: await cardPhoto(l.id),
    eyebrow: l.purpose === "SALE" ? "For sale" : `For ${l.purpose.toLowerCase()}`,
    title: l.title,
    big: `${formatKobo(l.priceKobo)}${priceSuffix(l.pricePeriod)}`,
    lines: [[l.bedrooms != null ? `${l.bedrooms} bed` : "", l.bathrooms != null ? `${l.bathrooms} bath` : ""].filter(Boolean).join(" · "), `${l.city}, ${l.state}`],
    cta: "See all photos",
  });
}
