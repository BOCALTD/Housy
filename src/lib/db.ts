import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { runtimeDatabaseUrl } from "./db-url";
import "./zod-messages";

/**
 * A Prisma client on the node-postgres driver (Prisma 7 always talks to the database through a driver adapter).
 * The pool waits up to 10 seconds for a free connection, as Prisma's own pool did before; DATABASE_POOL_MAX sets its size.
 */
export function clientFor(connectionString: string) {
  const max = Number(process.env.DATABASE_POOL_MAX) || 10;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 }) });
}

// One Prisma client per process. In development, reuse it across hot reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? clientFor(runtimeDatabaseUrl() ?? process.env.DATABASE_URL ?? "");
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

type Context = {
  companyId?: string;
  userId?: string;
  inviteTokenHash?: string;
  apiTokenHash?: string;
  platformAdmin?: boolean;
};

/**
 * Run database work inside a transaction with the row-level security context set.
 * set_config(..., true) scopes the values to this transaction only, so pooled
 * connections never leak one request's company into another.
 */
async function withContext<T>(ctx: Context, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT
      set_config('app.company_id', ${ctx.companyId ?? ""}, true) AS a,
      set_config('app.user_id', ${ctx.userId ?? ""}, true) AS b,
      set_config('app.invite_token_hash', ${ctx.inviteTokenHash ?? ""}, true) AS c,
      set_config('app.platform_admin', ${ctx.platformAdmin ? "on" : ""}, true) AS d,
      set_config('app.api_token_hash', ${ctx.apiTokenHash ?? ""}, true) AS e`;
    return fn(tx);
  });
}

/** Company-scoped work. Callers must still filter by companyId; RLS is the second line of defence. */
export function withTenant<T>(companyId: string, userId: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ companyId, userId }, fn);
}

/** Public, unauthenticated work. RLS exposes only published listings. */
export function withPublic<T>(fn: (tx: Tx) => Promise<T>) {
  return withContext({}, fn);
}

/** A signed-in user's own memberships across companies (company switcher, sign-in). */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ userId }, fn);
}

/** Reading an invitation by the token presented in the invite link. */
export function withInviteToken<T>(inviteTokenHash: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ inviteTokenHash }, fn);
}

/** Accepting an invitation as a signed-in user: the token finds the row, the user becomes its holder. */
export function withInviteTokenAs<T>(inviteTokenHash: string, userId: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ inviteTokenHash, userId }, fn);
}

/** Finding an API key by the hash of the key a program presented. */
export function withApiToken<T>(apiTokenHash: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ apiTokenHash }, fn);
}

/** Platform administration. Callers must have verified user.isPlatformAdmin first. */
export function withPlatformAdmin<T>(userId: string, fn: (tx: Tx) => Promise<T>) {
  return withContext({ userId, platformAdmin: true }, fn);
}
