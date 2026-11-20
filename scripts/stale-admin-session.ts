// A platform administrator session that has not confirmed the password recently, for the real-browser check of the
// "confirm it's you" step. Prints the session token.
import { prisma } from "../src/lib/db";
import { hashToken, newToken } from "../src/lib/tokens";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const admin = email ? await prisma.user.findUniqueOrThrow({ where: { email } }) : await prisma.user.findFirstOrThrow({ where: { isPlatformAdmin: true } });
  const token = newToken();
  await prisma.session.create({ data: { userId: admin.id, companyId: null, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), reauthAt: null } });
  console.log(token);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
