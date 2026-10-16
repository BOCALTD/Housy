import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, withPublic, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import {
  DEFAULT_AWARD_CONFIG, configProblem, monthEnded, monthLabel, monthRange, rankAgents, windowOver,
  type AgentMonthFacts, type AwardConfig, type Plaque,
} from "../award-rules";
import { notify } from "./notifications";
import { system } from "./rewards";

// Monthly Top Agent. A month is ranked from recorded facts only: verified completed sales, listings the platform approved, and published
// verified reviews. The facts and settings are stored with each run, so a published ranking can be recomputed and checked. Paid
// plans, promotions and sponsored views are not inputs. A published run has a correction period, then it is frozen.

export const AWARD_PAGE = 10;
const KEY = "award_config";

async function adminOnly(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true, name: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  return u;
}

// ---------- Settings ----------

const num = z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ invalid_type_error: "Enter whole numbers", required_error: "Enter whole numbers" }));
const configSchema = z.object({ wSales: num, wPosts: num, wRating: num, minSales: num, minPosts: num, minReviews: num, windowDays: num, completedDays: num });
export async function readAwardConfig(): Promise<AwardConfig> {
  const r = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  if (!r) return DEFAULT_AWARD_CONFIG;
  try { const c = JSON.parse(r.value) as AwardConfig; return configProblem(c) ? DEFAULT_AWARD_CONFIG : c; } catch { return DEFAULT_AWARD_CONFIG; }
}
export async function saveAwardConfig(adminId: string, raw: z.input<typeof configSchema>) {
  await adminOnly(adminId);
  const d = configSchema.parse(raw);
  const c: AwardConfig = { weights: { sales: d.wSales, posts: d.wPosts, rating: d.wRating }, minSales: d.minSales, minPosts: d.minPosts, minReviews: d.minReviews, windowDays: d.windowDays, completedDays: d.completedDays };
  const problem = configProblem(c);
  if (problem) throw new Error(problem);
  await system(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(c), updatedById: adminId }, update: { value: JSON.stringify(c), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "award_config", action: "settings.updated", detail: c as never });
  });
}

// ---------- Running a month ----------

interface StoredFacts { since: string; sales: number; posts: number; ratings: number[]; dealIds: string[]; listingIds: string[]; reviewIds: string[] }

async function gather(month: string): Promise<{ facts: AgentMonthFacts[]; stored: Map<string, StoredFacts> }> {
  const { start, end } = monthRange(month);
  const base = await system(async (tx) => {
    const all = await tx.agentProfile.findMany({ where: { listed: true }, orderBy: [{ userId: "asc" }, { createdAt: "asc" }], take: 5000 });
    const profiles = all.filter((p, i) => all.findIndex((x) => x.userId === p.userId) === i);
    const listings = await tx.listing.findMany({ where: { status: "PUBLISHED", postedById: { in: profiles.map((p) => p.userId) } }, select: { id: true, postedById: true } });
    const approvals = await tx.activityLog.findMany({ where: { entityType: "listing", action: "listing.approved", entityId: { in: listings.map((l) => l.id) } }, select: { entityId: true, createdAt: true } });
    const first = new Map<string, Date>();
    for (const a of approvals) if (!first.has(a.entityId) || a.createdAt < first.get(a.entityId)!) first.set(a.entityId, a.createdAt);
    const reviews = await tx.review.findMany({ where: { status: "PUBLISHED", agentUserId: { in: profiles.map((p) => p.userId) }, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: "asc" }, select: { id: true, agentUserId: true, reviewerId: true, overall: true } });
    return { profiles, listings, first, reviews };
  });
  // Deals belong to companies, so they are read inside each company's own scope. A deal's owner is the agent's membership.
  const dealsBy = new Map<string, string[]>();
  for (const companyId of [...new Set(base.profiles.map((p) => p.companyId))]) {
    const mine = base.profiles.filter((p) => p.companyId === companyId);
    const deals = await withTenant(companyId, "system", (tx) => tx.deal.findMany({ where: { type: "SALE", status: "COMPLETED", completedAt: { gte: start, lt: end }, ownerId: { in: mine.map((p) => p.membershipId) } }, select: { id: true, ownerId: true } }));
    for (const p of mine) dealsBy.set(p.userId, deals.filter((d) => d.ownerId === p.membershipId).map((d) => d.id));
  }
  const stored = new Map<string, StoredFacts>();
  const facts: AgentMonthFacts[] = [];
  for (const p of base.profiles) {
    const dealIds = dealsBy.get(p.userId) ?? [];
    const listingIds = base.listings.filter((l) => l.postedById === p.userId && base.first.get(l.id) && base.first.get(l.id)! >= start && base.first.get(l.id)! < end).map((l) => l.id);
    // One review per reviewer counts in a month, so a run of reviews from one person cannot swing the rating.
    const seen = new Set<string>(), rs = base.reviews.filter((r) => r.agentUserId === p.userId && !seen.has(r.reviewerId) && seen.add(r.reviewerId));
    if (!dealIds.length && !listingIds.length && !rs.length) continue;
    const s: StoredFacts = { since: p.createdAt.toISOString().slice(0, 10), sales: dealIds.length, posts: listingIds.length, ratings: rs.map((r) => r.overall), dealIds, listingIds, reviewIds: rs.map((r) => r.id) };
    stored.set(p.userId, s);
    facts.push({ userId: p.userId, displayName: p.displayName, companyName: p.companyName, since: s.since, sales: s.sales, posts: s.posts, ratings: s.ratings });
  }
  return { facts, stored };
}

const hashOf = (facts: AgentMonthFacts[], cfg: AwardConfig) => createHash("sha256").update(JSON.stringify({ cfg, facts: [...facts].sort((a, b) => (a.userId < b.userId ? -1 : 1)) })).digest("hex");

/** Rank a finished month. Each call makes a new version; nothing already published changes until the new one is published. */
export async function computeMonth(adminId: string, month: string, now = new Date()) {
  await adminOnly(adminId);
  monthRange(month);
  if (!monthEnded(month, now)) throw new Error(`${monthLabel(month)} has not finished yet. A month is ranked once it is over.`);
  const cfg = await readAwardConfig();
  const { facts, stored } = await gather(month);
  const results = rankAgents(facts, cfg);
  const hash = hashOf(facts, cfg);
  return system(async (tx) => {
    const runs = await tx.awardRun.findMany({ where: { month }, orderBy: { version: "desc" } });
    if (runs.some((r) => r.status === "FROZEN")) throw new Error(`${monthLabel(month)} is frozen. It can no longer change.`);
    await tx.awardRun.updateMany({ where: { month, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
    const run = await tx.awardRun.create({ data: { month, version: (runs[0]?.version ?? 0) + 1, config: cfg as never, inputsHash: hash, computedById: adminId, computedAt: now } });
    for (const r of results) {
      const s = stored.get(r.userId)!;
      await tx.awardEntry.create({
        data: {
          runId: run.id, userId: r.userId, displayName: r.displayName, companyName: r.companyName, eligible: r.eligible, reason: r.reason, sales: r.sales, posts: r.posts, reviews: r.reviews,
          avgRating: r.avgRating, ratingScore: r.ratingScore, normSales: r.normSales, normPosts: r.normPosts, normRating: r.normRating, score: r.score, rank: r.rank, plaque: r.plaque, facts: s as never,
        },
      });
    }
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "award_run", entityId: run.id, action: "award.computed", detail: { month, version: run.version, agents: results.length } });
    return run;
  });
}

/** Recompute a run from the facts it stored and the settings it used, and say whether the stored result matches. */
export async function verifyRun(adminId: string, runId: string) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const run = await tx.awardRun.findUniqueOrThrow({ where: { id: runId } });
    const entries = await tx.awardEntry.findMany({ where: { runId } });
    const facts: AgentMonthFacts[] = entries.map((e) => { const f = e.facts as unknown as StoredFacts; return { userId: e.userId, displayName: e.displayName, companyName: e.companyName, since: f.since, sales: f.sales, posts: f.posts, ratings: f.ratings }; });
    const again = rankAgents(facts, run.config as unknown as AwardConfig);
    const diffs = again.filter((r) => { const e = entries.find((x) => x.userId === r.userId)!; return e.rank !== r.rank || e.plaque !== r.plaque || Math.abs(e.score - r.score) > 1e-9; }).map((r) => r.userId);
    return { matches: diffs.length === 0, checked: entries.length, diffs };
  });
}

export async function publishRun(adminId: string, runId: string, now = new Date()) {
  const admin = await adminOnly(adminId);
  const winners = await system(async (tx) => {
    const run = await tx.awardRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error("Run not found");
    if (run.status !== "DRAFT") throw new Error("Only a new calculation can be published");
    if (!monthEnded(run.month, now)) throw new Error("The month has not finished");
    const prior = await tx.awardRun.findFirst({ where: { month: run.month, status: { in: ["PUBLISHED", "FROZEN"] } } });
    if (prior?.status === "FROZEN") throw new Error("This month is frozen");
    if (prior) await tx.awardRun.update({ where: { id: prior.id }, data: { status: "SUPERSEDED" } });
    await tx.awardRun.update({ where: { id: runId }, data: { status: "PUBLISHED", publishedAt: now, publishedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "award_run", entityId: runId, action: "award.published", detail: { month: run.month, version: run.version, by: admin.name } });
    return { month: run.month, top: await tx.awardEntry.findMany({ where: { runId, plaque: { not: null } } }) };
  });
  await system(async (tx) => {
    for (const w of winners.top) await notify(tx, w.userId, { kind: "award", title: `Top Agent of the Month: ${monthLabel(winners.month)}`, body: `You placed number ${w.rank}.`, link: `/awards/${winners.month}` });
  });
}

export async function freezeRun(adminId: string, runId: string, now = new Date()) {
  await adminOnly(adminId);
  await system(async (tx) => {
    const run = await tx.awardRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "PUBLISHED" || !run.publishedAt) throw new Error("Only a published ranking can be frozen");
    const cfg = run.config as unknown as AwardConfig;
    if (!windowOver(run.publishedAt, cfg.windowDays, now)) throw new Error(`The correction period runs for ${cfg.windowDays} days after publication. It is not over yet.`);
    if (await tx.awardDispute.count({ where: { runId, status: "OPEN" } })) throw new Error("Decide the open disputes before freezing");
    await tx.awardRun.update({ where: { id: runId }, data: { status: "FROZEN", frozenAt: now, frozenById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "award_run", entityId: runId, action: "award.frozen", detail: { month: run.month } });
  });
}

// ---------- Disputes ----------

export async function openAwardDispute(userId: string, runId: string, reason: string, now = new Date()) {
  const why = z.string().trim().min(10, "Explain what is wrong (at least 10 characters)").max(1000).parse(reason);
  await system(async (tx) => {
    const run = await tx.awardRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "PUBLISHED" || !run.publishedAt) throw new Error("Only a published ranking in its correction period can be disputed");
    const cfg = run.config as unknown as AwardConfig;
    if (windowOver(run.publishedAt, cfg.windowDays, now)) throw new Error("The correction period for this month is over");
    if (!(await tx.awardEntry.findUnique({ where: { runId_userId: { runId, userId } } }))) throw new Error("You are not in this ranking");
    if (await tx.awardDispute.findUnique({ where: { runId_userId: { runId, userId } } })) throw new Error("You have already disputed this ranking");
    await tx.awardDispute.create({ data: { runId, userId, reason: why } });
  });
}
export async function decideAwardDispute(adminId: string, id: string, decision: "uphold" | "reject", note: string) {
  await adminOnly(adminId);
  const why = z.string().trim().min(5, "Give your reason (at least 5 characters)").parse(note);
  await system(async (tx) => {
    const d = await tx.awardDispute.findUnique({ where: { id } });
    if (!d) throw new Error("Dispute not found");
    if (d.status !== "OPEN") throw new Error("This has already been decided");
    await tx.awardDispute.update({ where: { id }, data: { status: decision === "uphold" ? "UPHELD" : "REJECTED", decidedById: adminId, decidedAt: new Date(), decision: why } });
    await notify(tx, d.userId, { kind: "award", title: `Your ranking dispute was ${decision === "uphold" ? "upheld" : "not upheld"}`, body: decision === "uphold" ? `${why} The month will be recalculated.` : why, link: "/awards" });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "award_dispute", entityId: id, action: `award.dispute_${decision}`, detail: { note: why } });
  });
}
export async function myDispute(userId: string, runId: string) {
  return withUser(userId, (tx) => tx.awardDispute.findUnique({ where: { runId_userId: { runId, userId } } }));
}

// ---------- Reading ----------

/** The public run for a month: published or frozen, never a draft or a replaced one. */
export const currentRun = (month: string) => withPublic((tx) => tx.awardRun.findFirst({ where: { month, status: { in: ["PUBLISHED", "FROZEN"] } } }));
export const publishedMonths = () => withPublic((tx) => tx.awardRun.findMany({ where: { status: { in: ["PUBLISHED", "FROZEN"] } }, orderBy: { month: "desc" }, take: 120, select: { id: true, month: true, status: true, publishedAt: true } }));

export async function leaderboard(month: string, page = 0) {
  const run = await currentRun(month);
  if (!run) return null;
  return withPublic(async (tx) => {
    const where = { runId: run.id, eligible: true };
    const [total, rows] = await Promise.all([tx.awardEntry.count({ where }), tx.awardEntry.findMany({ where, orderBy: { rank: "asc" }, skip: Math.max(0, page) * AWARD_PAGE, take: AWARD_PAGE })]);
    return { run, total, page, pages: Math.max(1, Math.ceil(total / AWARD_PAGE)), rows };
  });
}

/** Awards a set of agents hold, from the public rankings. */
export async function awardsFor(userIds: string[]) {
  const out = new Map<string, { month: string; plaque: Plaque; rank: number }[]>();
  if (!userIds.length) return out;
  const rows = await withPublic((tx) => tx.awardEntry.findMany({ where: { userId: { in: userIds }, plaque: { not: null } } }));
  const runs = await withPublic((tx) => tx.awardRun.findMany({ where: { id: { in: rows.map((r) => r.runId) }, status: { in: ["PUBLISHED", "FROZEN"] } }, select: { id: true, month: true } }));
  for (const r of rows) {
    const run = runs.find((x) => x.id === r.runId);
    if (!run) continue;
    out.set(r.userId, [...(out.get(r.userId) ?? []), { month: run.month, plaque: r.plaque as Plaque, rank: r.rank! }]);
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => (a.month < b.month ? 1 : -1)));
  return out;
}

export async function adminAwardOverview(adminId: string) {
  await adminOnly(adminId);
  return system(async (tx) => {
    const runs = await tx.awardRun.findMany({ orderBy: [{ month: "desc" }, { version: "desc" }], take: 60 });
    const disputes = await tx.awardDispute.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 50 });
    const entries = await tx.awardEntry.findMany({ where: { runId: { in: disputes.map((d) => d.runId) }, userId: { in: disputes.map((d) => d.userId) } } });
    const counts = await tx.awardEntry.groupBy({ by: ["runId"], where: { runId: { in: runs.map((r) => r.id) } }, _count: { _all: true } });
    return {
      runs: runs.map((r) => ({ ...r, entries: counts.find((c) => c.runId === r.id)?._count._all ?? 0 })),
      disputes: disputes.map((d) => ({ ...d, entry: entries.find((e) => e.runId === d.runId && e.userId === d.userId) ?? null })),
    };
  });
}
