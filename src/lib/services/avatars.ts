import { prisma } from "../db";

/** Profile photo addresses for a set of people (those with one and not on a break), by user id. */
export async function avatarsFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean).slice(0, 200);
  if (!ids.length) return new Map();
  const rows = await prisma.userMedia.findMany({ where: { userId: { in: ids }, avatarType: { not: null }, user: { breakStartedAt: null } }, select: { userId: true, updatedAt: true } });
  return new Map(rows.map((r) => [r.userId, `/u/${r.userId}/avatar?v=${r.updatedAt.getTime()}`]));
}
