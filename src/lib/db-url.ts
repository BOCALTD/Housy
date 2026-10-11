/**
 * The runtime connection. When APP_DB_PASSWORD is set (hosted deployments), connect as the
 * restricted role "estate_app" on the same host as DATABASE_URL, so row-level security always
 * applies even if DATABASE_URL holds the owner's credentials (as Neon's Vercel integration sets it).
 */
export function runtimeDatabaseUrl(base = process.env.DATABASE_URL, password = process.env.APP_DB_PASSWORD): string | undefined {
  if (!base || !password) return undefined;
  const url = new URL(base);
  url.username = "estate_app";
  url.password = password;
  // PgBouncer-style poolers need Prisma's pgbouncer mode.
  if (url.hostname.includes("-pooler") && !url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
  return url.toString();
}
