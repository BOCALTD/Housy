import { z } from "zod";
import { prisma, withPublic, withTenant, withUser, type Tx } from "../db";
import { logActivity } from "../audit";
import { normalisePhone } from "../account-type-rules";
import { cleanTrades, tradeLabel, TRADE_KEYS } from "../artisan-rules";
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
    return { applications, roster, requests };
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
export async function offerArtisansAfterDeal(tx: Tx, companyId: string, deal: { id: string; clientId: string; title: string }) {
  const client = await tx.client.findFirst({ where: { id: deal.clientId, companyId }, select: { emailNorm: true, email: true } });
  const email = (client?.emailNorm || client?.email || "").trim().toLowerCase();
  if (!email) return null;
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;
  const offer = await tx.artisanOffer.upsert({ where: { dealId_userId: { dealId: deal.id, userId: user.id } }, create: { companyId, userId: user.id, dealId: deal.id }, update: {} });
  await notify(tx, user.id, { kind: "artisan.offer", title: "Moving in? Artisans are ready when you need them", body: `Need an electrician, plumber, painter or carpenter for ${deal.title}? Ask, and the company arranges a trusted artisan.`, link: "/me/artisans" });
  return offer.id;
}

/** Artisans a company offers to its clients: names, trades and areas only, read in the company's own context. */
async function offeredArtisans(companyId: string) {
  return withTenant(companyId, "system", (tx) => tx.contractor.findMany({
    where: { companyId, offerToClients: true, active: true },
    select: { id: true, companyId: true, name: true, trades: true, areas: true, bio: true, yearsExperience: true },
    orderBy: { name: "asc" }, take: 40,
  }));
}

export async function myArtisanCorner(userId: string) {
  const { offers, requests } = await withUser(userId, async (tx) => ({
    offers: await tx.artisanOffer.findMany({ where: { userId, dismissedAt: null }, orderBy: { createdAt: "desc" } }),
    requests: await tx.artisanRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
  }));
  const companies = [...new Set([...offers.map((o) => o.companyId), ...requests.map((r) => r.companyId)])];
  const artisans = (await Promise.all([...new Set(offers.map((o) => o.companyId))].map(offeredArtisans))).flat();
  const names = new Map((await withPublic((tx) => tx.companyProfile.findMany({ where: { companyId: { in: companies } }, select: { companyId: true, displayName: true } }))).map((p) => [p.companyId, p.displayName]));
  return {
    offers: offers.map((o) => ({ ...o, companyName: names.get(o.companyId) ?? "Your agent", artisans: artisans.filter((a) => a.companyId === o.companyId) })),
    requests: requests.map((r) => ({ ...r, companyName: names.get(r.companyId) ?? "Your agent" })),
  };
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
