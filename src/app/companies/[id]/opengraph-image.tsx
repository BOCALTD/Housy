import { ensureReputation, publicCompany } from "@/lib/services/reviews";
import { CARD_SIZE, initialsOf, shareCard } from "@/lib/share-card";

// The link-preview picture for a shared company profile: name and rating.
export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "A property company's profile";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const c = /^[0-9a-f-]{36}$/.test(id) ? await publicCompany(id).catch(() => null) : null;
  if (!c) return shareCard({ eyebrow: "Company", title: "Find verified property companies", lines: [], cta: "See companies" });
  const rep = await ensureReputation("COMPANY", c.companyId).catch(() => null);
  return shareCard({
    initials: initialsOf(c.displayName),
    eyebrow: c.kind === "DEVELOPER" ? "Property developer" : "Property company",
    title: c.displayName,
    big: rep && rep.reviewCount > 0 ? `★ ${rep.average.toFixed(1)} · ${rep.reviewCount} review${rep.reviewCount === 1 ? "" : "s"}` : undefined,
    lines: [c.tagline],
    cta: "See properties",
  });
}
