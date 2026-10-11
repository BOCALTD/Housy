/**
 * Starter records shared by the seed script and the first-run /setup page.
 * Every demonstration record is labelled "[DEMO]" so it is never mistaken for real data
 * (master prompt Section 52).
 */
import { prisma, withTenant } from "./db";
import { registerCompany, inviteMember, acceptInvitation } from "./services/companies";
import { createAsset, addParty } from "./services/assets";
import { createLease } from "./services/leases";
import { createTask } from "./services/tasks";
import { saveListingDraft, setListingStatus, reviewListing, reviewQueue } from "./services/listings";
import { addDepartment, listDepartments, updateRefPrefix, setMemberDepartment } from "./services/settings";
import { registerCorrespondence, actOnCorrespondence } from "./services/correspondence";
import { createPhysicalFile, issuePhysicalFile } from "./services/files";
import { todayInLagos, toDateOnlyString } from "./dates";
import type { Ctx } from "./services/context";

export const DEMO_PASSWORD = "demo-password-123";
export const DEMO_USERS = [
  { email: "demo.alpha@example.test", role: "Company Super Admin, [DEMO] Alpha Estates" },
  { email: "demo.officer@example.test", role: "Officer, [DEMO] Alpha Estates" },
  { email: "demo.beta@example.test", role: "Company Super Admin, [DEMO] Beta Property Managers" },
];

/**
 * Create Bona Okorie Consulting & Advisory Ltd as a verification provider if it does not exist.
 * It stays PENDING, with no profile, until a platform admin enters its approved details,
 * unless `approvedForDemo` is set.
 */
export async function ensureBocaProvider(approvedForDemo: boolean) {
  const existing = await prisma.serviceProvider.findFirst({ where: { shortName: "BOCA" } });
  if (existing) return existing;
  return prisma.serviceProvider.create({
    data: {
      name: "Bona Okorie Consulting & Advisory Ltd",
      shortName: "BOCA",
      profile: "",
      services: "Property verification and due diligence\nRisk assessment\nOwnership, title, encumbrance and records checks",
      status: approvedForDemo ? "APPROVED" : "PENDING",
      placement: "SPONSORED",
      featured: true,
    },
  });
}

/** Create two labelled demo companies with assets, a lease, a task and published listings. */
export async function createDemoData(adminId: string): Promise<boolean> {
  const already = await prisma.user.findUnique({ where: { email: "demo.alpha@example.test" } });
  if (already) return false;
  const a = await registerCompany({ companyName: "[DEMO] Alpha Estates", name: "Ada Demo", email: "demo.alpha@example.test", password: DEMO_PASSWORD });
  const b = await registerCompany({ companyName: "[DEMO] Beta Property Managers", name: "Bayo Demo", email: "demo.beta@example.test", password: DEMO_PASSWORD });

  const ctxFor = async (userId: string, companyId: string): Promise<Ctx> => {
    const m = await withTenant(companyId, userId, (tx) => tx.membership.findFirstOrThrow({ where: { companyId, userId } }));
    return { userId, companyId, membershipId: m.id, role: m.role };
  };
  const alpha = await ctxFor(a.userId, a.companyId);
  const beta = await ctxFor(b.userId, b.companyId);

  const token = await inviteMember(alpha, { email: "demo.officer@example.test", role: "OFFICER" });
  await acceptInvitation(token, { name: "Ope Demo (Officer)", password: DEMO_PASSWORD });

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

  // Correspondence and files.
  const officerUser = await prisma.user.findUniqueOrThrow({ where: { email: "demo.officer@example.test" } });
  const officer = await ctxFor(officerUser.id, alpha.companyId);
  await updateRefPrefix(alpha, "ALP");
  await addDepartment(alpha, { name: "[DEMO] Legal", code: "LEG" });
  await addDepartment(alpha, { name: "[DEMO] Property management", code: "PM" });
  const legal = (await listDepartments(alpha)).find((d) => d.code === "LEG")!;
  await setMemberDepartment(alpha, officer.membershipId, legal.id);
  const today = todayInLagos();
  const daysFromToday = (n: number) => toDateOnlyString(new Date(today.getTime() + n * 864e5));
  const notice = await registerCorrespondence(alpha, {
    direction: "INCOMING", subject: "[DEMO] Notice of Land Use Charge reassessment", senderName: "[DEMO] Lands Bureau",
    recipientName: "[DEMO] Alpha Estates", dateReceived: daysFromToday(-10), responseDeadline: daysFromToday(-2),
    category: "Government and regulatory", departmentId: legal.id, assetId: duplex.id, assigneeId: officer.membershipId,
    description: "Demonstration record. The deadline has passed, so it shows as overdue.",
  });
  await actOnCorrespondence(officer, notice.id, "start_review", { expectedStatus: "ASSIGNED" });
  await registerCorrespondence(alpha, {
    direction: "INCOMING", subject: "[DEMO] Request for lease renewal", senderName: "[DEMO] Corner Pharmacy Ltd",
    recipientName: "[DEMO] Alpha Estates", dateReceived: daysFromToday(-1), responseDeadline: daysFromToday(10), category: "Tenant",
    assetId: shop.id, description: "Demonstration record, waiting to be assigned.",
  });
  const deeds = await createPhysicalFile(alpha, { fileNumber: "F-0001", title: "[DEMO] Duplex title deeds", location: "Cabinet A", assetId: duplex.id, departmentId: legal.id });
  await issuePhysicalFile(alpha, deeds.id, { holderId: officer.membershipId, expectedReturnOn: daysFromToday(7), purpose: "Demo: valuation" });
  await createPhysicalFile(alpha, { fileNumber: "F-0002", title: "[DEMO] Allen Avenue shop lease file", location: "Cabinet A", assetId: shop.id });

  // Approve only the demo listings, never real submissions waiting for review.
  for (const l of await reviewQueue(adminId)) {
    if (l.title.startsWith("[DEMO]")) await reviewListing(adminId, l.id, "approve", "Demo data approved automatically");
  }

  return true;
}
