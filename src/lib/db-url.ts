/**
 * The runtime connection. When APP_DB_PASSWORD is set (hosted deployments), connect as the
 * restricted role "estate_app" on the same host as DATABASE_URL, so row-level security always
 * applies even if DATABASE_URL holds the owner's credentials (as a hosting integration may set it).
 */
export function runtimeDatabaseUrl(base = process.env.DATABASE_URL, password = process.env.APP_DB_PASSWORD): string | undefined {
  if (!base || !password) return undefined;
  const url = new URL(base);
  url.username = "estate_app";
  url.password = password;
  // The node-postgres driver sends unnamed statements, which PgBouncer-style poolers accept, so no pooler setting is added.
  return url.toString();
}
