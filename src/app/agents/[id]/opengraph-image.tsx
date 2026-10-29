import { ensureReputation, publicAgent } from "@/lib/services/reviews";
import { CARD_SIZE, initialsOf, shareCard } from "@/lib/share-card";

// The link-preview picture for a shared agent profile: name, company and rating.
export const size = CARD_SIZE;
export const contentType = "image/png";
export const alt = "An estate agent's profile";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const a = /^[0-9a-f-]{36}$/.test(id) ? await publicAgent(id).catch(() => null) : null;
  if (!a) return shareCard({ eyebrow: "Agent", title: "Find trusted agents", lines: [], cta: "See agents" });
  const rep = await ensureReputation("AGENT", a.userId).catch(() => null);
  return shareCard({
    initials: initialsOf(a.displayName),
    eyebrow: a.companyName ? `Agent · ${a.companyName}` : "Agent",
    title: a.displayName,
    big: rep && rep.reviewCount > 0 ? `★ ${rep.average.toFixed(1)} · ${rep.reviewCount} review${rep.reviewCount === 1 ? "" : "s"}` : undefined,
    lines: [a.headline],
    cta: "See profile",
  });
}
