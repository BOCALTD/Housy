import { z } from "zod";
import { prisma, withPlatformAdmin, withUser } from "../db";
import { logActivity } from "../audit";
import { toCsv } from "../csv";
import { toDateOnlyString } from "../dates";
import { DEFAULT_RATING_INTERVAL_DAYS, SNOOZE_DAYS, ratingDue } from "../tier-rules";

// Asking people how the platform is doing. Everyone is asked once per interval (the administrator sets it), can say "remind me later",
// and can always answer without their name being shown to the administrator.

export const FEEDBACK_PAGE = 8;
const KEY = "rating_interval_days";

export async function readFeedbackSettings(): Promise<{ intervalDays: number }> {
  const r = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  const n = Number(r?.value);
  return { intervalDays: Number.isInteger(n) && n >= 1 ? n : DEFAULT_RATING_INTERVAL_DAYS };
}
export async function saveFeedbackSettings(adminId: string, raw: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("Enter a whole number of days from 1 to 365");
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: String(n), updatedById: adminId }, update: { value: String(n), updatedById: adminId } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "settings", entityId: "rating_interval", action: "settings.updated", detail: { intervalDays: n } });
  });
}

/** Should this person be asked now? Platform administrators are not asked. */
export async function feedbackDue(userId: string, now = new Date()): Promise<boolean> {
  const [user, st, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, isPlatformAdmin: true } }),
    withUser(userId, (tx) => tx.feedbackState.findUnique({ where: { userId } })),
    readFeedbackSettings(),
  ]);
  if (!user || user.isPlatformAdmin) return false;
  return ratingDue({ accountCreatedAt: user.createdAt, lastRatedAt: st?.lastRatedAt ?? null, snoozedUntil: st?.snoozedUntil ?? null, intervalDays: settings.intervalDays, now });
}

export async function snoozeFeedback(userId: string, now = new Date()) {
  const until = new Date(now.getTime() + SNOOZE_DAYS * 864e5);
  await withUser(userId, (tx) => tx.feedbackState.upsert({ where: { userId }, create: { userId, snoozedUntil: until }, update: { snoozedUntil: until } }));
}

const score = (label: string, required: boolean) => z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)),
  required ? z.number({ error: `Give a ${label} rating` }).int().min(1, "Choose 1 to 5").max(5, "Choose 1 to 5")
    : z.number().int().min(1).max(5).optional());
const optionalScore = (label: string) => score(label, false).optional();
const ratingSchema = z.object({
  overall: score("overall", true),
  ease: optionalScore("ease"), trust: optionalScore("trust"), support: optionalScore("support"),
  suggestion: z.string().trim().max(2000, "Keep it under 2000 characters").default(""),
  anonymous: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

export async function submitRating(userId: string, raw: z.input<typeof ratingSchema>) {
  const d = ratingSchema.parse(raw);
  const mem = await prisma.membership.count({ where: { userId, status: "ACTIVE" } });
  await withUser(userId, async (tx) => {
    await tx.platformRating.create({
      data: { userId, overall: d.overall as number, easeScore: d.ease ?? null, trustScore: d.trust ?? null, supportScore: d.support ?? null, suggestion: d.suggestion, anonymous: d.anonymous, userKind: mem > 0 ? "COMPANY_MEMBER" : "MEMBER" },
    });
    await tx.feedbackState.upsert({ where: { userId }, create: { userId, lastRatedAt: new Date() }, update: { lastRatedAt: new Date(), snoozedUntil: null } });
  });
}

// ---------- Admin ----------

async function admin(adminId: string) {
  const u = await prisma.user.findUnique({ where: { id: adminId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw new Error("Only the platform administrator can do that");
}
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

export async function feedbackSummary(adminId: string) {
  await admin(adminId);
  return withPlatformAdmin(adminId, async (tx) => {
    const rows = await tx.platformRating.findMany({ orderBy: { createdAt: "desc" }, take: 5000, select: { overall: true, easeScore: true, trustScore: true, supportScore: true, createdAt: true } });
    const dist = [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: rows.filter((r) => r.overall === n).length }));
    const months = new Map<string, number[]>();
    for (const r of rows) { const k = r.createdAt.toISOString().slice(0, 7); months.set(k, [...(months.get(k) ?? []), r.overall]); }
    const trend = [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12).map(([month, v]) => ({ month, count: v.length, average: avg(v) }));
    return { total: rows.length, overall: avg(rows.map((r) => r.overall)), ease: avg(rows.map((r) => r.easeScore)), trust: avg(rows.map((r) => r.trustScore)), support: avg(rows.map((r) => r.supportScore)), distribution: dist, trend };
  });
}

export async function listRatings(adminId: string, o: { page?: number; status?: string; onlyComments?: boolean } = {}) {
  await admin(adminId);
  const page = Math.max(0, o.page ?? 0);
  return withPlatformAdmin(adminId, async (tx) => {
    const where = { ...(o.status && ["NEW", "REVIEWED", "ACTIONED"].includes(o.status) ? { status: o.status as "NEW" } : {}), ...(o.onlyComments ? { suggestion: { not: "" } } : {}) };
    const [total, rows] = await Promise.all([
      tx.platformRating.count({ where }),
      tx.platformRating.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * FEEDBACK_PAGE, take: FEEDBACK_PAGE }),
    ]);
    const named = await tx.user.findMany({ where: { id: { in: rows.filter((r) => !r.anonymous).map((r) => r.userId) } }, select: { id: true, name: true } });
    // Anonymous answers never leave this function with a name on them.
    return { total, page, pages: Math.max(1, Math.ceil(total / FEEDBACK_PAGE)), rows: rows.map(({ userId, ...r }) => ({ ...r, who: r.anonymous ? "Anonymous" : named.find((n) => n.id === userId)?.name ?? "Member" })) };
  });
}

export async function reviewRating(adminId: string, id: string, status: string, note: string) {
  await admin(adminId);
  if (!["NEW", "REVIEWED", "ACTIONED"].includes(status)) throw new Error("Choose a status");
  await withPlatformAdmin(adminId, async (tx) => {
    await tx.platformRating.update({ where: { id }, data: { status: status as "NEW", adminNote: note.trim().slice(0, 500) } });
    await logActivity(tx, { companyId: null, actorId: adminId, entityType: "platform_rating", entityId: id, action: "feedback.reviewed", detail: { status } });
  });
}

export async function exportRatingsCsv(adminId: string): Promise<string> {
  await admin(adminId);
  const rows = await withPlatformAdmin(adminId, (tx) => tx.platformRating.findMany({ orderBy: { createdAt: "desc" }, take: 10000 }));
  return toCsv(["Date", "Overall", "Ease", "Trust", "Support", "Kind", "Anonymous", "Status", "Suggestion", "Admin note"],
    rows.map((r) => [toDateOnlyString(r.createdAt), r.overall, r.easeScore ?? "", r.trustScore ?? "", r.supportScore ?? "", r.userKind, r.anonymous ? "yes" : "no", r.status, r.suggestion, r.adminNote]));
}
