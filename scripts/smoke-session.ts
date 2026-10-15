/**
 * Used by scripts/smoke.sh. Signs in as the demo Company Super Admin by creating a session row,
 * then prints the session token on the first line, followed by every signed-in page worth opening
 * (one path per line). The smoke test opens each with that cookie and fails on any error page.
 * Add new pages here as modules are built, so CI renders them against real data.
 */
import { prisma, withTenant, withUser } from "../src/lib/db";
import { hashToken, newToken } from "../src/lib/tokens";

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "demo.alpha@example.test" } });
  // Memberships are protected by row-level security; read them through the user's own context.
  const membership = await withUser(user.id, (tx) => tx.membership.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" } }));
  const companyId = membership.companyId;
  const token = newToken();
  await prisma.session.create({
    data: { userId: user.id, companyId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  });

  const paths = new Set<string>([
    "/app", "/app/assets", "/app/assets/new", "/app/correspondence", "/app/correspondence/new",
    "/app/files", "/app/settings", "/app/team",
  ]);
  await withTenant(companyId, user.id, async (tx) => {
    for (const a of await tx.asset.findMany({ select: { id: true } })) paths.add(`/app/assets/${a.id}`);
    for (const c of await tx.correspondence.findMany({ select: { id: true } })) paths.add(`/app/correspondence/${c.id}`);
  });

  console.log(token);
  for (const p of paths) console.log(p);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
