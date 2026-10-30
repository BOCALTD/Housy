import { getReel } from "@/lib/services/reels";
import { getPublicListing } from "@/lib/services/listings";
import { CARD_SIZE, cardPhoto, initialsOf, shareCard } from "@/lib/share-card";

// The link-preview picture for a shared reel: the property's photo when the reel is about one, with the caption.
export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "A property video";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const r = /^[0-9a-f-]{36}$/.test(id) ? await getReel(id, null).catch(() => null) : null;
  if (!r || r.status !== "PUBLISHED") return shareCard({ eyebrow: "Property reel", title: "Short property videos", lines: [], cta: "Watch reels" });
  const listing = r.listingRef ? await getPublicListing(r.listingRef) : null;
  return shareCard({
    photo: listing ? await cardPhoto(listing.id) : null,
    initials: initialsOf(r.authorName),
    eyebrow: "Property reel",
    title: r.caption || r.listingTitle || `A reel by ${r.authorName}`,
    lines: [r.companyName ? `${r.authorName} · ${r.companyName}` : r.authorName, r.city],
    cta: "Watch the reel",
  });
}
