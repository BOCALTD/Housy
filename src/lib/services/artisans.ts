import { z } from "zod";
import { prisma, withPublic, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { normalisePhone } from "../account-type-rules";
import { namesOverlap } from "../crm-rules";
import { RATEABLE, cleanTrades, rankArtisans, tradeLabel, TRADE_KEYS } from "../artisan-rules";
import { assertCan, type Ctx } from "./context";
import { notify } from "./notifications";

/**
 * Artisans are tradespeople registered with a company (its contractors). A company decides who joins and which of them it
 * offers to clients. When a deal closes, the client is offered that company's artisans and can ask for one; the company
 * arranges it. Clients see names, trades and areas, never an artisan's phone or email.
 */

async function tellManagers(companyId: string, n: { kind: string; title: string; body: string; link: string }) {
  await withTenant(companyId, "system", async (tx) => {
    const managers = await tx.membership.findMany({ where: { companyId, status: "ACTIVE", role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true }, take: 20 });
    for (const m of managers) await notify(tx, m.userId, n);
  });
}

/** Whether these people passed the Housy ID check (only "verified" is readable by others). */
async function idVerified(userIds: (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  const rows = await withPublic((tx) => tx.flatmateCheck.findMany({ where: { userId: { in: ids }, status: "VERIFIED" }, select: { userId: true } }));
  return new Set(rows.map((r) => r.userId));
}

/** Ratings, jobs done and ID verification for a company's artisans, read in the company's own context. */
async function artisanStats(companyId: string, artisans: { id: string; userId: string | null }[]) {
  const ids = artisans.map((a) => a.id);
  const [ratings, done, verified] = await Promise.all([
    withTenant(companyId, "system", (tx) => tx.artisanReview.groupBy({ by: ["contractorId"], where: { companyId, contractorId: { in: ids } }, _avg: { stars: true }, _count: { _all: true } })),
    withTenant(companyId, "system", (tx) => tx.artisanRequest.groupBy({ by: ["contractorId"], where: { companyId, contractorId: { in: ids }, status: "DONE" }, _count: { _all: true } })),
    idVerified(artisans.map((a) => a.userId)),
  ]);
  return new Map(artisans.map((a) => {
    const r = ratings.find((x) => x.contractorId === a.id);
    return [a.id, { stars: Math.round((r?._avg.stars ?? 0) * 10) / 10, reviews: r?._count._all ?? 0, jobsDone: done.find((x) => x.contractorId === a.id)?._count._all ?? 0, verified: !!a.userId && verified.has(a.userId) }];
  }));
}

// ---------- Registering with a company ----------

/** Companies an artisan can register with: those with a public profile. */
export async function artisanCompanies(qRaw = "") {
  const q = qRaw.trim().slice(0, 60);
  return withPublic((tx) => tx.companyProfile.findMany({
    where: { listed: true, ...(q ? { displayName: { contains: q, mode: "insensitive" } } : {}) },
    select: { companyId: true, displayName: true, tagline: true },
    orderBy: { followerCount: "desc" }, take: 40,
  }));
}

const applySchema = z.object({
  companyId: z.string().min(1, { error: "Choose the company to register with" }),
  name: z.string().trim().min(2, { error: "Enter your name" }).max(80),
  phone: z.string().trim().min(7, { error: "Enter your phone number" }).max(20),
  trades: z.array(z.string()).transform(cleanTrades).refine((t) => t.length > 0, { error: "Choose at least one trade" }),
  areas: z.string().trim().min(2, { error: "Say which areas you work in" }).max(200),
  years: z.string().trim().default("").transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 60), { error: "Enter your years of experience as a number" }),
  bio: z.string().trim().max(500).default(""),
});

export async function applyAsArtisan(userId: string, input: z.input<typeof applySchema>) {
  const d = applySchema.parse(input);
  const phone = normalisePhone(d.phone);
  if (!phone) throw new Error("Enter a phone number like 0803 123 4567");
  const company = await withPublic((tx) => tx.companyProfile.findFirst({ where: { companyId: d.companyId, listed: true }, select: { displayName: true } }));
  if (!company) throw new Error("That company is not taking artisan registrations");
  const app = await withUser(userId, async (tx) => {
    const existing = await tx.artisanApplication.findUnique({ where: { companyId_userId: { companyId: d.companyId, userId } } });
    if (existing?.status === "PENDING") throw new Error(`You have already applied to ${company.displayName}. They will reply soon.`);
    if (existing?.status === "APPROVED") throw new Error(`You are already one of ${company.displayName}'s artisans.`);
    const data = { name: d.name, phone, trades: d.trades, areas: d.areas, yearsExperience: d.years, bio: d.bio, status: "PENDING", decisionNote: "", decidedAt: null, decidedById: null };
    return existing ? tx.artisanApplication.update({ where: { id: existing.id }, data }) : tx.artisanApplication.create({ data: { companyId: d.companyId, userId, ...data } });
  });
  // Tell the company's managers (read in the company's own context, as the rest of the app does for cross-company notices).
  await tellManagers(d.companyId, { kind: "artisan.applied", title: `${d.name} wants to join your artisans`, body: d.trades.map(tradeLabel).join(", "), link: "/app/artisans" });
  return app;
}

export async function myArtisanApplications(userId: string) {
  const rows = await withUser(userId, (tx) => tx.artisanApplication.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }));
  const names = new Map((await withPublic((tx) => tx.companyProfile.findMany({ where: { companyId: { in: rows.map((r) => r.companyId) } }, select: { companyId: true, displayName: true } }))).map((p) => [p.companyId, p.displayName]));
  return rows.map((r) => ({ ...r, companyName: names.get(r.companyId) ?? "A company" }));
}

// ---------- The company's artisan desk ----------

export async function artisanDesk(ctx: Ctx) {
  assertCan(ctx, "maintenance.manage");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const [applications, roster, requests] = await Promise.all([
      tx.artisanApplication.findMany({ where: { companyId: ctx.companyId, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
      tx.contractor.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
      tx.artisanRequest.findMany({ where: { companyId: ctx.companyId, status: { in: ["OPEN", "ARRANGED"] } }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
    ]);
    const reviews = await tx.artisanReview.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, contractorId: true, stars: true, body: true, createdAt: true } });
    return { applications, roster, requests, reviews };
  }).then(async (d) => {
    const stats = await artisanStats(ctx.companyId, d.roster.map((c) => ({ id: c.id, userId: c.userId })));
    const appVerified = await idVerified(d.applications.map((a) => a.userId));
    return { ...d, stats, applications: d.applications.map((a) => ({ ...a, verified: appVerified.has(a.userId) })) };
  });
}

export async function decideApplication(ctx: Ctx, id: string, approve: boolean, noteRaw = "") {
  assertCan(ctx, "maintenance.manage");
  const note = z.string().trim().max(500).parse(noteRaw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const a = await tx.artisanApplication.findFirst({ where: { id, companyId: ctx.companyId, status: "PENDING" } });
    if (!a) throw new Error("That application is no longer waiting");
    let contractorId: string | null = null;
    if (approve) {
      const taken = await tx.contractor.findFirst({ where: { companyId: ctx.companyId, name: a.name }, select: { id: true } });
      const name = taken ? `${a.name} (${tradeLabel(a.trades[0] ?? "")})`.slice(0, 120) : a.name;
      const c = await tx.contractor.create({ data: { companyId: ctx.companyId, name, trade: a.trades.map(tradeLabel).join(", "), trades: a.trades, areas: a.areas, bio: a.bio, yearsExperience: a.yearsExperience, phone: a.phone, userId: a.userId, offerToClients: true, createdById: ctx.userId } });
      contractorId = c.id;
    }
    await tx.artisanApplication.update({ where: { id }, data: { status: approve ? "APPROVED" : "DECLINED", decisionNote: note, decidedById: ctx.userId, decidedAt: new Date(), contractorId } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "artisan_application", entityId: id, action: approve ? "artisan.approved" : "artisan.declined", detail: { name: a.name } });
    await notify(tx, a.userId, approve
      ? { kind: "artisan.approved", title: "You are now a registered artisan", body: "The company will offer you to its clients who need your trade.", link: "/artisans" }
      : { kind: "artisan.declined", title: "Your artisan registration was not accepted", body: note || "The company did not take on new artisans for now.", link: "/artisans" });
    return contractorId;
  });
}

const artisanEditSchema = z.object({
  trades: z.array(z.string()).transform(cleanTrades),
  areas: z.string().trim().max(200).default(""),
  bio: z.string().trim().max(500).default(""),
  offer: z.boolean(),
});
export async function updateArtisan(ctx: Ctx, contractorId: string, input: z.input<typeof artisanEditSchema>) {
  assertCan(ctx, "maintenance.manage");
  const d = artisanEditSchema.parse(input);
  if (d.offer && !d.trades.length) throw new Error("Choose at least one trade before offering this artisan to clients");
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.contractor.updateMany({ where: { id: contractorId, companyId: ctx.companyId }, data: { trades: d.trades, trade: d.trades.map(tradeLabel).join(", "), areas: d.areas, bio: d.bio, offerToClients: d.offer } });
    if (!r.count) throw new Error("Artisan not found");
  });
}

const STATUSES = ["OPEN", "ARRANGED", "DONE", "CANCELLED"] as const;
export async function updateArtisanRequest(ctx: Ctx, id: string, status: string, noteRaw = "", contractorId?: string | null) {
  assertCan(ctx, "maintenance.manage");
  if (!(STATUSES as readonly string[]).includes(status)) throw new Error("Choose a status");
  const note = z.string().trim().max(500).parse(noteRaw);
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const r = await tx.artisanRequest.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!r) throw new Error("Request not found");
    if (contractorId && !(await tx.contractor.findFirst({ where: { id: contractorId, companyId: ctx.companyId, active: true }, select: { id: true } }))) throw new Error("Choose one of your artisans");
    await tx.artisanRequest.update({ where: { id }, data: { status, companyNote: note, ...(contractorId !== undefined ? { contractorId } : {}) } });
    if (status !== r.status) await notify(tx, r.userId, { kind: "artisan.request", title: status === "ARRANGED" ? `Your ${tradeLabel(r.trade).toLowerCase()} is arranged` : status === "DONE" ? "Your artisan request is done" : status === "CANCELLED" ? "Your artisan request was cancelled" : "Your artisan request was updated", body: note, link: "/me/artisans" });
  });
}

// ---------- After a deal closes ----------

/** Called when a deal completes: the client (if they have a Housy account) is offered the company's artisans. */
/**
 * After a deal closes, offer the company's artisans to the client if they have a Housy account. The account is found by the
 * client's email; failing that, by their phone number in international form (so 0803… and +234 803… are the same, and a
 * number from Ghana or the UK is read with its own country code), but only when exactly one account has that number and
 * the names agree, because phone numbers on Housy are not confirmed by text message.
 */
export async function offerArtisansAfterDeal(tx: Tx, companyId: string, deal: { id: string; clientId: string; title: string }) {
  const client = await tx.client.findFirst({ where: { id: deal.clientId, companyId }, select: { name: true, emailNorm: true, email: true, phoneNorm: true } });
  if (!client) return null;
  const email = (client.emailNorm || client.email || "").trim().toLowerCase();
  let user = email ? await tx.user.findUnique({ where: { email }, select: { id: true } }) : null;
  let byPhone = false;
  if (!user && /^\d{8,15}$/.test(client.phoneNorm)) {
    const holders = await tx.user.findMany({ where: { phone: `+${client.phoneNorm}` }, select: { id: true, name: true }, take: 2 });
    if (holders.length === 1 && namesOverlap(holders[0].name, client.name)) { user = { id: holders[0].id }; byPhone = true; }
  }
  if (!user) return null;
  const offer = await tx.artisanOffer.upsert({ where: { dealId_userId: { dealId: deal.id, userId: user.id } }, create: { companyId, userId: user.id, dealId: deal.id }, update: {} });
  // Matched by phone: say less in the notification, in case the number has changed hands.
  await notify(tx, user.id, byPhone
    ? { kind: "artisan.offer", title: "Moving in? Artisans are ready when you need them", body: "The company you dealt with can arrange a trusted electrician, plumber, painter or carpenter. Ask from Artisans for my home.", link: "/me/artisans" }
    : { kind: "artisan.offer", title: "Moving in? Artisans are ready when you need them", body: `Need an electrician, plumber, painter or carpenter for ${deal.title}? Ask, and the company arranges a trusted artisan.`, link: "/me/artisans" });
  return offer.id;
}

/** Artisans a company offers to its clients: names, trades and areas only, read in the company's own context. */
async function offeredArtisans(companyId: string) {
  return withTenant(companyId, "system", (tx) => tx.contractor.findMany({
    where: { companyId, offerToClients: true, active: true },
    select: { id: true, companyId: true, name: true, trades: true, areas: true, bio: true, yearsExperience: true, userId: true },
    orderBy: { name: "asc" }, take: 40,
  }));
}

/** The property a deal was about, as one line of place words, for matching artisans' areas. */
async function dealPlace(companyId: string, dealId: string | null): Promise<string> {
  if (!dealId) return "";
  const d = await withTenant(companyId, "system", (tx) => tx.deal.findFirst({ where: { id: dealId, companyId }, select: { asset: { select: { address: true, city: true, state: true } } } })).catch(() => null);
  return d ? [d.asset.address, d.asset.city, d.asset.state].filter(Boolean).join(", ") : "";
}

/**
 * What a client sees: each offer with the company's artisans ranked for them (the trade they pick, then who works where the
 * property is, then ID verification, ratings and jobs done), and their requests with a way to rate each arranged job.
 */
export async function myArtisanCorner(userId: string, want: { trade?: string } = {}) {
  const trade = want.trade && (TRADE_KEYS as string[]).includes(want.trade) ? want.trade : undefined;
  const { offers, requests, rated } = await withUser(userId, async (tx) => ({
    offers: await tx.artisanOffer.findMany({ where: { userId, dismissedAt: null }, orderBy: { createdAt: "desc" } }),
    requests: await tx.artisanRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    rated: await tx.artisanReview.findMany({ where: { userId }, select: { requestId: true, stars: true } }),
  }));
  const companies = [...new Set([...offers.map((o) => o.companyId), ...requests.map((r) => r.companyId)])];
  const byCompany = new Map(await Promise.all([...new Set(offers.map((o) => o.companyId))].map(async (cid) => {
    const list = await offeredArtisans(cid);
    return [cid, { list, stats: await artisanStats(cid, list) }] as const;
  })));
  const names = new Map((await withPublic((tx) => tx.companyProfile.findMany({ where: { companyId: { in: companies } }, select: { companyId: true, displayName: true } }))).map((p) => [p.companyId, p.displayName]));
  const artisanNames = new Map([...byCompany.values()].flatMap((c) => c.list.map((a) => [a.id, a.name] as const)));
  const outOffers = await Promise.all(offers.map(async (o) => {
    const c = byCompany.get(o.companyId);
    const place = await dealPlace(o.companyId, o.dealId);
    const ranked = rankArtisans((c?.list ?? []).map((a) => ({ id: a.id, name: a.name, trades: a.trades, areas: a.areas, bio: a.bio, yearsExperience: a.yearsExperience, ...(c!.stats.get(a.id) ?? { stars: 0, reviews: 0, jobsDone: 0, verified: false }) })), { trade, place });
    return { ...o, companyName: names.get(o.companyId) ?? "Your agent", place, artisans: ranked };
  }));
  const ratedMap = new Map(rated.map((r) => [r.requestId, r.stars]));
  return {
    trade,
    offers: outOffers,
    requests: requests.map((r) => ({ ...r, companyName: names.get(r.companyId) ?? "Your agent", artisanName: r.contractorId ? artisanNames.get(r.contractorId) ?? null : null, myStars: ratedMap.get(r.id) ?? null, canRate: !ratedMap.has(r.id) && !!r.contractorId && (RATEABLE as readonly string[]).includes(r.status) })),
  };
}

const rateSchema = z.object({
  requestId: z.string().min(1),
  stars: z.coerce.number().int({ error: "Choose 1 to 5 stars" }).min(1, { error: "Choose 1 to 5 stars" }).max(5, { error: "Choose 1 to 5 stars" }),
  body: z.string().trim().max(600).default(""),
});

/** Rate an artisan job the company arranged: once per request, by the client who asked. The company is told. */
export async function rateArtisanJob(userId: string, input: z.input<typeof rateSchema>) {
  const d = rateSchema.parse(input);
  const r = await withUser(userId, async (tx) => {
    const req = await tx.artisanRequest.findFirst({ where: { id: d.requestId, userId } });
    if (!req) throw new Error("Request not found");
    if (!req.contractorId || !(RATEABLE as readonly string[]).includes(req.status)) throw new Error("You can rate the job once the company has arranged an artisan");
    if (await tx.artisanReview.findUnique({ where: { requestId: req.id }, select: { id: true } })) throw new Error("You have already rated this job");
    const own = await withTenant(req.companyId, "system", (t) => t.contractor.findFirst({ where: { id: req.contractorId!, companyId: req.companyId }, select: { id: true } }));
    if (!own) throw new Error("That artisan is no longer with the company");
    return tx.artisanReview.create({ data: { requestId: req.id, companyId: req.companyId, userId, contractorId: req.contractorId, stars: d.stars, body: d.body } });
  });
  await tellManagers(r.companyId, { kind: "artisan.rated", title: `A client rated an artisan job ${"★".repeat(r.stars)}`, body: d.body.slice(0, 120) || "No comment", link: "/app/artisans#reviews" });
  return r;
}

const requestSchema = z.object({
  offerId: z.string().min(1),
  trade: z.string().refine((t) => (TRADE_KEYS as string[]).includes(t), { error: "Choose the trade you need" }),
  contractorId: z.string().trim().optional(),
  note: z.string().trim().min(5, { error: "Say what needs doing" }).max(1000),
  address: z.string().trim().max(300).default(""),
  preferredOn: z.string().trim().default("").transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)).refine((v) => v === null || !Number.isNaN(v.getTime()), { error: "Choose a valid date" }),
});

export async function requestArtisan(userId: string, input: z.input<typeof requestSchema>) {
  const d = requestSchema.parse(input);
  const r = await withUser(userId, async (tx) => {
    const offer = await tx.artisanOffer.findFirst({ where: { id: d.offerId, userId } });
    if (!offer) throw new Error("You can ask for artisans after a deal with the company closes");
    if (d.contractorId && !(await offeredArtisans(offer.companyId)).some((a) => a.id === d.contractorId)) throw new Error("Choose one of the artisans shown");
    const open = await tx.artisanRequest.count({ where: { userId, status: "OPEN" } });
    if (open >= 10) throw new Error("You have 10 requests waiting. Wait for the company to reply before asking again.");
    return tx.artisanRequest.create({ data: { companyId: offer.companyId, userId, dealId: offer.dealId, contractorId: d.contractorId || null, trade: d.trade, note: d.note, address: d.address, preferredOn: d.preferredOn } });
  });
  const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await tellManagers(r.companyId, { kind: "artisan.requested", title: `${who?.name ?? "A client"} needs a ${tradeLabel(d.trade).toLowerCase()}`, body: d.note.slice(0, 120), link: "/app/artisans" });
  return r;
}

export async function dismissArtisanOffer(userId: string, offerId: string) {
  await withUser(userId, (tx) => tx.artisanOffer.updateMany({ where: { id: offerId, userId }, data: { dismissedAt: new Date() } }));
}
