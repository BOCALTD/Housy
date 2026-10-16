import { z } from "zod";
import { prisma, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import { parseNairaToKobo } from "../money";
import { DEFAULT_ALERT_CONFIG, alertConfigProblem, areaKeys, matchSearch, pickRecipients, type AlertConfig, type Reason } from "../alert-rules";
import { notify } from "./notifications";
import { system } from "./rewards";

// Property alerts. A newly approved property reaches only people who asked for it: they saved a matching search, follow the agent or
// company, or chose the area. Everyone is counted once, the list is capped, and the same property never alerts the same person twice.

const KEY = "alert_config";
async function adminOnly(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}

// ---------- Audience rules ----------

export async function readAlertConfig(): Promise<AlertConfig> {
  const r = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!r) return DEFAULT_ALERT_CONFIG;
  try { const c = { ...DEFAULT_ALERT_CONFIG, ...(JSON.parse(r.value) as Partial<AlertConfig>) }; return alertConfigProblem(c) ? DEFAULT_ALERT_CONFIG : c; } catch { return DEFAULT_ALERT_CONFIG; }
}
export async function saveAlertConfig(adminId: string, raw: { maxRecipients: unknown; savedSearches: boolean; followers: boolean; areas: boolean }) {
  await adminOnly(adminId);
  const c: AlertConfig = { maxRecipients: Number(raw.maxRecipients), savedSearches: raw.savedSearches, followers: raw.followers, areas: raw.areas };
  const problem = alertConfigProblem(c);
  if (problem) throw new Error(problem);
  await system(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(c), updatedById: adminId }, update: { value: JSON.stringify(c), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: KEY, action: "settings.updated", detail: c as never });
  });
}

// ---------- A person's saved searches and watched properties ----------

export const MAX_SAVED_SEARCHES = 10;
export const MAX_WATCHED = 50;
const searchSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name").max(80),
  purpose: z.enum(["", "SALE", "RENT", "LEASE"]).default(""),
  city: z.string().trim().max(80).default(""),
  q: z.string().trim().max(120).default(""),
  maxPrice: z.string().trim().optional().transform((v) => (v ? parseNairaToKobo(v) : null)),
  minBeds: z.string().trim().optional().transform((v) => (v ? Number.parseInt(v, 10) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100), "Enter a valid number of bedrooms"),
});

export async function saveSearch(userId: string, raw: z.input<typeof searchSchema>) {
  const d = searchSchema.parse(raw);
  if (!d.purpose && !d.city && !d.q && d.maxPrice == null && d.minBeds == null) throw new Error("Choose at least one thing to search for, such as an area or a purpose");
  return withUser(userId, async (tx) => {
    if ((await tx.savedSearch.count({ where: { userId } })) >= MAX_SAVED_SEARCHES) throw new Error(`You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`);
    return tx.savedSearch.create({ data: { userId, name: d.name, purpose: d.purpose, city: d.city, q: d.q, maxKobo: d.maxPrice, minBeds: d.minBeds } });
  });
}
export const deleteSearch = (userId: string, id: string) => withUser(userId, (tx) => tx.savedSearch.deleteMany({ where: { id, userId } }));
export const setSearchAlerts = (userId: string, id: string, on: boolean) => withUser(userId, (tx) => tx.savedSearch.updateMany({ where: { id, userId }, data: { alertsOn: on } }));
export const mySearches = (userId: string) => withUser(userId, (tx) => tx.savedSearch.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_SAVED_SEARCHES }));

export async function watchListing(userId: string, publicRef: string) {
  return withUser(userId, async (tx) => {
    const l = await tx.listing.findFirst({ where: { publicRef, status: "PUBLISHED" }, select: { id: true } });
    if (!l) throw new Error("This property is not available to watch");
    if ((await tx.watchedListing.count({ where: { userId } })) >= MAX_WATCHED) throw new Error(`You can watch ${MAX_WATCHED} properties. Stop watching one first.`);
    await tx.watchedListing.upsert({ where: { userId_listingId: { userId, listingId: l.id } }, create: { userId, listingId: l.id }, update: {} });
  });
}
export async function unwatchListing(userId: string, publicRef: string) {
  await withUser(userId, async (tx) => {
    const l = await tx.listing.findFirst({ where: { publicRef }, select: { id: true } });
    if (l) await tx.watchedListing.deleteMany({ where: { userId, listingId: l.id } });
  });
}
export const isWatching = (userId: string, listingId: string) => withUser(userId, async (tx) => !!(await tx.watchedListing.findUnique({ where: { userId_listingId: { userId, listingId } } })));
export async function myWatched(userId: string) {
  return withUser(userId, async (tx) => {
    const w = await tx.watchedListing.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_WATCHED });
    const ls = await tx.listing.findMany({ where: { id: { in: w.map((x) => x.listingId) } }, select: { id: true, publicRef: true, title: true, city: true, status: true, priceKobo: true } });
    return w.map((x) => ({ ...x, listing: ls.find((l) => l.id === x.listingId) ?? null }));
  });
}

// ---------- Telling the right people ----------

export interface AlertResult { sent: number; byReason: Record<Reason, number>; skipped?: string }

/** Called when the platform approves a property. Only the first approval alerts; edits and re-approvals do not. */
export async function alertNewListing(listingId: string, o: { now?: Date } = {}): Promise<AlertResult> {
  const none: AlertResult = { sent: 0, byReason: { SAVED_SEARCH: 0, FOLLOW: 0, AREA: 0 } };
  const cfg = await readAlertConfig();
  const base = await system(async (tx) => ({
    listing: await tx.listing.findUnique({ where: { id: listingId } }),
    approvals: await tx.activityLog.count({ where: { entityType: "listing", entityId: listingId, action: "listing.approved" } }),
  }));
  const l = base.listing;
  if (!l || l.status !== "PUBLISHED") return { ...none, skipped: "not published" };
  if (base.approvals > 1) return { ...none, skipped: "already announced" };
  const members = await withTenant(l.companyId, "system", (tx) => tx.membership.findMany({ where: { companyId: l.companyId }, select: { userId: true } }));
  const facts = { purpose: l.purpose, city: l.city, state: l.state, title: l.title, priceKobo: l.priceKobo, bedrooms: l.bedrooms };

  const groups = await system(async (tx) => {
    const g: { reason: Reason; label: string; userIds: string[] }[] = [];
    if (cfg.savedSearches) {
      const searches = await tx.savedSearch.findMany({ where: { alertsOn: true }, orderBy: { createdAt: "asc" }, take: 5000 });
      g.push({ reason: "SAVED_SEARCH", label: "it matches a search you saved", userIds: searches.filter((s) => matchSearch(facts, { purpose: s.purpose, city: s.city, q: s.q, maxKobo: s.maxKobo, minBeds: s.minBeds })).map((s) => s.userId) });
    }
    if (cfg.followers) {
      const follows = await tx.follow.findMany({ where: { OR: [...(l.postedById ? [{ targetKind: "AGENT" as const, targetId: l.postedById }] : []), { targetKind: { in: ["COMPANY", "DEVELOPER"] as ("COMPANY" | "DEVELOPER")[] }, targetId: l.companyId }] }, orderBy: { createdAt: "asc" }, take: 2000, select: { followerId: true } });
      g.push({ reason: "FOLLOW", label: "you follow the agent or company", userIds: follows.map((f) => f.followerId) });
    }
    if (cfg.areas) {
      const prefs = await tx.notificationPref.findMany({ where: { areas: { hasSome: areaKeys(l) } }, orderBy: { updatedAt: "asc" }, take: 2000, select: { userId: true } });
      g.push({ reason: "AREA", label: "it is in an area you chose", userIds: prefs.map((p) => p.userId) });
    }
    return g;
  });
  const who = pickRecipients(groups, new Set(members.map((m) => m.userId)), cfg.maxRecipients);
  if (!who.size) return none;
  const out: AlertResult = { sent: 0, byReason: { SAVED_SEARCH: 0, FOLLOW: 0, AREA: 0 } };
  await system(async (tx) => {
    for (const [userId, why] of who) {
      await notify(tx, userId, {
        kind: "alert.property", title: `New in ${l.city}: ${l.title}`.slice(0, 160), body: `You are seeing this because ${why.label}.`, link: `/properties/${l.publicRef}`,
        template: "property_alert", dedupeKey: `alert:${l.id}`,
        vars: { title: l.title, city: l.city, priceKobo: l.priceKobo.toString(), bedrooms: l.bedrooms, link: `/properties/${l.publicRef}`, reason: `${why.label[0].toUpperCase()}${why.label.slice(1)}` },
      });
      out.sent++; out.byReason[why.reason]++;
    }
    await logActivity(tx, { companyId: l.companyId, actorId: null, entityType: "listing", entityId: l.id, action: "listing.alerted", detail: { ...out.byReason, at: (o.now ?? new Date()).toISOString() } });
  });
  return out;
}

/** People watching a property hear when it stops or starts being available. */
export async function alertWatchers(listingId: string, change: string): Promise<number> {
  const watchers = await system(async (tx) => {
    const l = await tx.listing.findUnique({ where: { id: listingId } });
    if (!l) return null;
    return { l, users: (await tx.watchedListing.findMany({ where: { listingId }, take: 1000, select: { userId: true } })).map((w) => w.userId) };
  });
  if (!watchers || !watchers.users.length) return 0;
  const { l, users } = watchers;
  await system(async (tx) => {
    for (const userId of users) await notify(tx, userId, {
      kind: "alert.availability", title: `${l.title}: ${change}`.slice(0, 160), body: "A property you are watching has changed.", link: `/properties/${l.publicRef}`,
      template: "availability_alert", dedupeKey: `watch:${l.id}:${change}:${new Date().toISOString().slice(0, 10)}`, vars: { title: l.title, change, link: `/properties/${l.publicRef}` },
    });
  });
  return users.length;
}

/** Tell the platform team that a new agent or company has put a profile in the directory. */
export async function announceNewProfile(kind: "agent" | "company", name: string, link: string) {
  const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true }, take: 20 });
  if (!admins.length) return 0;
  await system(async (tx) => { for (const a of admins) await notify(tx, a.id, { kind: "onboarding.admin", title: `New ${kind} in the directory: ${name}`.slice(0, 160), body: "Take a look that the profile is genuine.", link, dedupeKey: `newprofile:${kind}:${name}` }); });
  return admins.length;
}

/** An enquiry reaches the people who deal with it: the person who posted the property, and the managers. */
export async function notifyEnquiry(listing: { id: string; companyId: string; title: string; postedById: string | null }, from: string, message: string) {
  const people = await withTenant(listing.companyId, "system", (tx) => tx.membership.findMany({ where: { companyId: listing.companyId, role: { in: ["COMPANY_SUPER_ADMIN", "MANAGER"] } }, select: { userId: true }, take: 20 }));
  const ids = new Set(people.map((p) => p.userId));
  if (listing.postedById) ids.add(listing.postedById);
  await system(async (tx) => { for (const userId of ids) await notify(tx, userId, { kind: "enquiry.new", title: `New enquiry about ${listing.title}`.slice(0, 160), body: `${from}: ${message}`.slice(0, 200), link: "/app/crm", template: "enquiry_received", vars: { listing: listing.title, from, message }, dedupeKey: `enquiry:${listing.id}:${from}:${message.slice(0, 40)}` }); });
}
