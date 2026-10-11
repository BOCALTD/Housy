/**
 * Seed the database.
 *  - Always: the first Platform Super Super Admin (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
 *  - Always: Bona Okorie Consulting & Advisory Ltd as a PENDING verification provider. Its approved
 *    profile must be entered and approved by the platform admin before it appears to buyers.
 *  - Only with SEED_DEMO_DATA=true: two demonstration companies, assets and listings. Every demo
 *    record is labelled "[DEMO]" so it is never mistaken for real data (master prompt Section 52).
 */
import { prisma, withTenant } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth-hash";
import { registerCompany, inviteMember, acceptInvitation } from "../src/lib/services/companies";
import { createAsset, addParty } from "../src/lib/services/assets";
import { createLease } from "../src/lib/services/leases";
import { createTask } from "../src/lib/services/tasks";
import { saveListingDraft, setListingStatus, reviewListing, reviewQueue } from "../src/lib/services/listings";
import type { Ctx } from "../src/lib/services/context";

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
  const existingBoca = await prisma.serviceProvider.findFirst({ where: { shortName: "BOCA" } });
  if (!existingBoca) {
    await prisma.serviceProvider.create({
      data: {
        name: "Bona Okorie Consulting & Advisory Ltd",
        shortName: "BOCA",
        profile: "",
        services: "Property verification and due diligence\nRisk assessment\nOwnership, title, encumbrance and records checks",
        status: demo ? "APPROVED" : "PENDING",
        placement: "SPONSORED",
        featured: true,
      },
    });
    console.log(`Verification provider BOCA created (${demo ? "approved for demo" : "pending approval"}).`);
  }

  if (!demo) return;
  const already = await prisma.user.findUnique({ where: { email: "demo.alpha@example.test" } });
  if (already) {
    console.log("Demo data already present. Skipping.");
    return;
  }

  const demoPassword = "demo-password-123";
  const a = await registerCompany({ companyName: "[DEMO] Alpha Estates", name: "Ada Demo", email: "demo.alpha@example.test", password: demoPassword });
  const b = await registerCompany({ companyName: "[DEMO] Beta Property Managers", name: "Bayo Demo", email: "demo.beta@example.test", password: demoPassword });

  const ctxFor = async (userId: string, companyId: string): Promise<Ctx> => {
    const m = await withTenant(companyId, userId, (tx) => tx.membership.findFirstOrThrow({ where: { companyId, userId } }));
    return { userId, companyId, membershipId: m.id, role: m.role };
  };
  const alpha = await ctxFor(a.userId, a.companyId);
  const beta = await ctxFor(b.userId, b.companyId);

  const token = await inviteMember(alpha, { email: "demo.officer@example.test", role: "OFFICER" });
  await acceptInvitation(token, { name: "Ope Demo (Officer)", password: demoPassword });

  const duplex = await createAsset(alpha, {
    name: "[DEMO] 4-bedroom semi-detached duplex", assetClass: "RESIDENTIAL", category: "Duplex",
    address: "Demo Close, Lekki Phase 1", city: "Lekki", state: "Lagos", companyRelationship: "OWNER",
    acquisitionCost: "120,000,000", acquiredOn: "2021-05-14", description: "Demonstration record.",
  });
  await addParty(alpha, duplex.id, { partyName: "[DEMO] Alpha Estates", relationship: "LEGAL_OWNER", evidenceNote: "Demonstration record" });
  await saveListingDraft(alpha, duplex.id, {
    title: "[DEMO] 4-bedroom semi-detached duplex with BQ", purpose: "SALE", price: "185,000,000",
    bedrooms: "4", bathrooms: "5", city: "Lekki", state: "Lagos",
    description: "Demonstration listing. Gated estate, boys' quarters, ample parking.",
  });
  await setListingStatus(alpha, duplex.id, "PENDING_REVIEW");

  const shop = await createAsset(alpha, {
    name: "[DEMO] Ground-floor shop, Allen Avenue", assetClass: "COMMERCIAL", category: "Shop",
    city: "Ikeja", state: "Lagos", companyRelationship: "MANAGER",
  });
  await addParty(alpha, shop.id, { partyName: "[DEMO] Mrs Demo Landlord", relationship: "LEGAL_OWNER", evidenceNote: "Management agreement on file (demo)" });
  const year = new Date().getUTCFullYear();
  await createLease(alpha, shop.id, {
    occupantName: "[DEMO] Corner Pharmacy Ltd", startDate: `${year - 1}-01-01`, endDate: `${year + 1}-01-01`,
    rent: "500,000", frequency: "QUARTERLY", deposit: "250,000",
  });
  await createTask(alpha, shop.id, { kind: "INSPECTION", title: "[DEMO] Quarterly condition inspection", priority: "NORMAL", dueOn: `${year}-01-15` });

  const warehouse = await createAsset(beta, {
    name: "[DEMO] Warehouse, Agbara industrial estate", assetClass: "INDUSTRIAL", category: "Warehouse",
    city: "Agbara", state: "Ogun", companyRelationship: "MANAGER",
  });
  await saveListingDraft(beta, warehouse.id, {
    title: "[DEMO] 2,000 m² warehouse to lease", purpose: "LEASE", price: "45,000,000", city: "Agbara", state: "Ogun",
    description: "Demonstration listing.",
  });
  await setListingStatus(beta, warehouse.id, "PENDING_REVIEW");

  for (const l of await reviewQueue(admin.id)) await reviewListing(admin.id, l.id, "approve", "Demo data approved by seed");

  console.log("Demo data created. Demo users (password demo-password-123):");
  console.log("  demo.alpha@example.test   Company Super Admin, [DEMO] Alpha Estates");
  console.log("  demo.officer@example.test Officer, [DEMO] Alpha Estates");
  console.log("  demo.beta@example.test    Company Super Admin, [DEMO] Beta Property Managers");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
