import { prisma } from "../db";
import { system } from "./rewards";

export interface Health { ok: boolean; database: boolean; checkedAt: string }
export interface HealthDetail extends Health {
  email: { queued: number; oldestQueuedMinutes: number | null; failed: number; dead: number };
  payments: { pendingOverTwoDays: number; needingReview: number };
  warnings: string[];
}

/** Is the database reachable? Nothing else, so anyone may ask and nothing is revealed. */
export async function health(): Promise<Health> {
  let database = false;
  try { await prisma.$queryRaw`SELECT 1`; database = true; } catch { /* reported as down */ }
  return { ok: database, database, checkedAt: new Date().toISOString() };
}

/** What an operator watches: the email backlog and payments waiting too long. Only for callers holding the cron secret. */
export async function healthDetail(now = new Date()): Promise<HealthDetail> {
  const base = await health();
  if (!base.database) return { ...base, email: { queued: 0, oldestQueuedMinutes: null, failed: 0, dead: 0 }, payments: { pendingOverTwoDays: 0, needingReview: 0 }, warnings: ["The database cannot be reached."] };
  const d = await system(async (tx) => {
    const [queued, oldest, failed, dead, stale, review] = await Promise.all([
      tx.emailOutbox.count({ where: { status: "QUEUED" } }),
      tx.emailOutbox.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      tx.emailOutbox.count({ where: { status: "FAILED" } }),
      tx.emailOutbox.count({ where: { status: "DEAD" } }),
      tx.payment.count({ where: { status: "PENDING", provider: { not: "MANUAL" }, createdAt: { lt: new Date(now.getTime() - 2 * 864e5) } } }),
      tx.payment.count({ where: { status: "REVIEW" } }),
    ]);
    return { queued, oldestMin: oldest ? Math.round((now.getTime() - oldest.createdAt.getTime()) / 60000) : null, failed, dead, stale, review };
  });
  const warnings: string[] = [];
  if (d.oldestMin !== null && d.oldestMin > 60) warnings.push(`Email has been waiting ${d.oldestMin} minutes. Is the notification job running, and is an email provider connected?`);
  if (d.dead > 0) warnings.push(`${d.dead} emails gave up after repeated failures.`);
  if (d.stale > 0) warnings.push(`${d.stale} payments have waited over 2 days for the provider.`);
  if (d.review > 0) warnings.push(`${d.review} payments need a decision.`);
  return { ...base, email: { queued: d.queued, oldestQueuedMinutes: d.oldestMin, failed: d.failed, dead: d.dead }, payments: { pendingOverTwoDays: d.stale, needingReview: d.review }, warnings };
}
