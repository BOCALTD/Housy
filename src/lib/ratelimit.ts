import { createHash } from "node:crypto";
import { prisma } from "./db";

/**
 * Fixed-window rate limiter shared by every server instance (PostgreSQL table rate_limits).
 * Works on serverless hosts, where in-memory counters reset on each new instance.
 * Keys are hashed, so no email addresses or IP addresses are stored.
 * Returns true when the action is allowed.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const hashed = createHash("sha256").update(key).digest("hex");
  const seconds = windowMs / 1000;
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${hashed}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds}::double precision)
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${seconds}::double precision)
                   THEN now() ELSE rate_limits.window_start END
    RETURNING count`;
  // Occasionally clear windows that ended more than a day ago.
  if (Math.random() < 0.01) {
    await prisma.$executeRaw`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  }
  return Number(rows[0]?.count ?? 0) <= limit;
}
