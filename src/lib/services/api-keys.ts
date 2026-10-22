import { z } from "zod";
import { withApiToken, withTenant } from "../db";
import { logActivity } from "../audit";
import { newToken } from "../tokens";
import { API_KEY_MAX_DAYS, API_KEY_MAX_PER_COMPANY, API_SCOPES, formatApiKey, hashApiKey, keyUsable, parseApiKey, parseScopes, type ApiScope } from "../api-rules";
import { assertCan, type Ctx } from "./context";

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the key a name so you can recognise it later").max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose what the key may do"),
  days: z.coerce.number().int().min(1, "Choose how long the key lasts").max(API_KEY_MAX_DAYS, `A key can last at most ${API_KEY_MAX_DAYS} days`),
});

/** Make a key. The key itself is returned once and never stored: only its hash is kept. */
export async function createApiKey(ctx: Ctx, input: z.input<typeof createSchema>): Promise<{ id: string; key: string }> {
  assertCan(ctx, "api.manage");
  const data = createSchema.parse(input);
  const prefix = newToken(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const key = formatApiKey(prefix, newToken(32).replace(/[^A-Za-z0-9_-]/g, "a"));
  return withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const live = await tx.apiKey.count({ where: { companyId: ctx.companyId, revokedAt: null } });
    if (live >= API_KEY_MAX_PER_COMPANY) throw new Error(`A company can have up to ${API_KEY_MAX_PER_COMPANY} active keys. Revoke one you no longer use.`);
    const row = await tx.apiKey.create({
      data: { companyId: ctx.companyId, createdById: ctx.userId, name: data.name, prefix, tokenHash: hashApiKey(key), scopes: data.scopes.join(","), expiresAt: new Date(Date.now() + data.days * 864e5) },
      select: { id: true },
    });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "api_key", entityId: row.id, action: "api_key.created", detail: { name: data.name, scopes: data.scopes, days: data.days } });
    return { id: row.id, key };
  });
}

export async function listApiKeys(ctx: Ctx) {
  assertCan(ctx, "api.manage");
  return withTenant(ctx.companyId, ctx.userId, (tx) =>
    tx.apiKey.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true } }));
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  assertCan(ctx, "api.manage");
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const done = await tx.apiKey.updateMany({ where: { id, companyId: ctx.companyId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (done.count === 0) throw new Error("Key not found");
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "api_key", entityId: id, action: "api_key.revoked", detail: {} });
  });
}

export type ApiCaller = { keyId: string; companyId: string; createdById: string; scopes: ApiScope[] };

/** Who is calling? Null for a key that is unknown, malformed, revoked or expired (the caller is never told which). */
export async function authenticateApiKey(raw: string | null): Promise<ApiCaller | null> {
  if (!raw || !parseApiKey(raw)) return null;
  const hash = hashApiKey(raw);
  const row = await withApiToken(hash, (tx) => tx.apiKey.findFirst({ where: { tokenHash: hash } }));
  if (!row || keyUsable(row) !== "ok") return null;
  // Record use at most about once a minute, so a busy program does not write on every request.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await withTenant(row.companyId, row.createdById, (tx) => tx.apiKey.updateMany({ where: { id: row.id, companyId: row.companyId }, data: { lastUsedAt: new Date() } })).catch(() => undefined);
  }
  return { keyId: row.id, companyId: row.companyId, createdById: row.createdById, scopes: parseScopes(row.scopes) };
}
