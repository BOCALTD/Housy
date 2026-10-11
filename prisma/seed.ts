/**
 * Seed the database from the command line (local development and CI).
 *  - Always: the first Platform Super Super Admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
 *  - Always: BOCA as a verification provider (pending until approved, or approved for demo).
 *  - Only with SEED_DEMO_DATA=true: labelled demonstration companies, assets and listings.
 * On a hosted deployment, use the /setup page instead.
 */
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-hash";
import { createDemoData, ensureBocaProvider, DEMO_PASSWORD, DEMO_USERS } from "../src/lib/demo";

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email || password.length < 10) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (10+ characters)");

  const admin = await prisma.user.upsert({
    where: { email },
    update: { isPlatformAdmin: true },
    create: { email, name: "Platform Admin", passwordHash: await hashPassword(password), isPlatformAdmin: true },
  });
  console.log(`Platform admin: ${admin.email}`);

  const demo = process.env.SEED_DEMO_DATA === "true";
  await ensureBocaProvider(demo);
  if (!demo) return;
  if (!(await createDemoData(admin.id))) {
    console.log("Demo data already present. Skipping.");
    return;
  }
  console.log(`Demo data created. Demo users (password ${DEMO_PASSWORD}):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email}  ${u.role}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
