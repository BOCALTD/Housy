import { withPublic } from "../db";
import { HOME_COUNTRY } from "../countries";

/** Live figures for the home page. Each counts only what the public can see, so none of them can be inflated by drafts or hidden records. */
export async function siteCounts() {
  return withPublic(async (tx) => {
    const [companies, agents, listings, completed, cities] = await Promise.all([
      tx.companyProfile.count({ where: { listed: true } }),
      tx.agentProfile.count({ where: { listed: true } }),
      tx.listing.count({ where: { status: "PUBLISHED" } }),
      tx.completedDisplay.count({ where: { status: "APPROVED" } }),
      tx.listing.groupBy({ by: ["city"], where: { status: "PUBLISHED" } }).then((r) => r.length),
    ]);
    return { companies, agents, listings, completed, cities };
  });
}

/** Published listings counted by city, for the visitor's country first. Falls back to the home country when theirs has none. */
export async function cityCounts(country: string, limit = 8) {
  return withPublic(async (tx) => {
    const by = async (c: string) => (await tx.listing.groupBy({ by: ["city", "state"], where: { status: "PUBLISHED", country: c }, _count: { _all: true } }))
      .map((r) => ({ city: r.city, state: r.state, count: r._count._all })).sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)).slice(0, limit);
    const mine = await by(country);
    if (mine.length || country === HOME_COUNTRY) return { country, cities: mine };
    return { country: HOME_COUNTRY, cities: await by(HOME_COUNTRY) };
  });
}

/** How many published listings there are for each purpose (for the "browse by" tiles). */
export async function purposeCounts() {
  const rows = await withPublic((tx) => tx.listing.groupBy({ by: ["purpose"], where: { status: "PUBLISHED" }, _count: { _all: true } }));
  return Object.fromEntries(rows.map((r) => [r.purpose, r._count._all])) as Partial<Record<"SALE" | "RENT" | "LEASE", number>>;
}

/** The most recent published reviews with something written in them. Reviews come only from real, recorded interactions. */
export async function latestReviews(limit = 9) {
  const rows = await withPublic((tx) => tx.review.findMany({ where: { status: "PUBLISHED", NOT: { body: "" } }, orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, ref: true, overall: true, body: true, reviewerName: true, basis: true, companyId: true, agentUserId: true, createdAt: true } }));
  if (!rows.length) return [];
  const [companies, agents] = await Promise.all([
    withPublic((tx) => tx.companyProfile.findMany({ where: { companyId: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { companyId: true, displayName: true } })),
    withPublic((tx) => tx.agentProfile.findMany({ where: { userId: { in: rows.map((r) => r.agentUserId).filter((x): x is string => !!x) }, listed: true }, select: { userId: true, displayName: true } })),
  ]);
  return rows.map((r) => ({
    ...r,
    // First name and initial only, so a review never publishes someone's full name.
    reviewerName: r.reviewerName.trim().split(/\s+/).map((w, i) => (i === 0 ? w : `${w[0]}.`)).slice(0, 2).join(" "),
    about: r.agentUserId ? agents.find((a) => a.userId === r.agentUserId)?.displayName ?? "An agent" : companies.find((c) => c.companyId === r.companyId)?.displayName ?? "A company",
  }));
}

export async function publicPartners() {
  return withPublic((tx) => tx.partner.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { name: "asc" }], take: 40, select: { id: true, name: true, kind: true, url: true, blurb: true, logoMime: true } }));
}

export async function partnerLogo(id: string) {
  return withPublic((tx) => tx.partner.findFirst({ where: { id, active: true }, select: { logoMime: true, logoBytes: true } }));
}
