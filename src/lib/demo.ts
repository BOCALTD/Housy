/**
 * Starter records shared by the seed script and the first-run /setup page.
 * Every demonstration record is labelled "[DEMO]" so it is never mistaken for real data
 * (master prompt Section 52).
 */
import { prisma, withTenant } from "./db";
import { registerCompany, inviteMember, acceptInvitation } from "./services/companies";
import { createAsset, addParty } from "./services/assets";
import { createLease, getLease, recordLeasePayment, recordPayment } from "./services/leases";
import { reconcileReceipt, recordDepositReceived, requestAdjustment } from "./services/ledger";
import { proposeRenewal, recordHandover, recordNotice } from "./services/lifecycle";
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
  { email: "demo.manager@example.test", role: "Manager, [DEMO] Alpha Estates" },
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
  const managerToken = await inviteMember(alpha, { email: "demo.manager@example.test", role: "MANAGER" });
  const managerJoined = await acceptInvitation(managerToken, { name: "Mary Demo (Manager)", password: DEMO_PASSWORD });
  const manager = await ctxFor(managerJoined.userId, alpha.companyId);

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
  const shopLease = await createLease(alpha, shop.id, {
    occupantName: "[DEMO] Corner Pharmacy Ltd", startDate: `${year - 1}-01-01`, endDate: `${year + 1}-01-01`,
    rent: "500,000", frequency: "QUARTERLY", deposit: "250,000", graceDays: "5", noticeDays: "90",
    permittedUse: "Pharmacy retail", otherTerms: "Demonstration terms. Rent review at renewal.",
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

  // Rent ledger: a payment recorded by the manager and reconciled by the administrator, a late-fee request
  // waiting for approval, and the deposit received.
  const shopCharges = (await getLease(alpha, shopLease.id))!.lease.charges;
  const demoReceipt = await recordLeasePayment(manager, shopLease.id, {
    amount: "1,000,000", paidOn: `${year - 1}-04-03`, evidence: "DEMO-GTB-0001", method: "Bank transfer", payerName: "[DEMO] Corner Pharmacy Ltd",
  });
  await reconcileReceipt(alpha, demoReceipt.id, { statementRef: "Demo statement, April, line 12" });
  await recordPayment(manager, shopCharges[2].id, { amount: "200,000", paidOn: `${year - 1}-07-10`, evidence: "DEMO-CASH-0002", method: "Cash" });
  await requestAdjustment(officer, shopCharges[2].id, {
    kind: "LATE_FEE", amount: "25,000", reason: "Demonstration: late fee under clause 7 of the lease",
  });
  await recordDepositReceived(officer, shopLease.id, { amount: "250,000", receivedOn: `${year - 1}-01-02`, evidence: "DEMO-DEP-0001" });

  // Lifecycle: the move-in on record, a notice, and a renewal waiting for the administrator.
  await recordHandover(officer, shopLease.id, {
    kind: "MOVE_IN", handoverOn: `${year - 1}-01-02`, keysCount: "3", meterReadings: "Electricity 10412, water 0231",
    conditionNotes: "Demonstration: premises handed over clean, shutters and locks working.", acknowledgedBy: "[DEMO] Corner Pharmacy representative",
  });
  await recordNotice(manager, shopLease.id, {
    givenBy: "LANDLORD", givenOn: `${year}-01-05`, effectiveOn: `${year + 1}-01-01`, reason: "Demonstration: notice of rent review at renewal",
  });
  await proposeRenewal(manager, shopLease.id, {
    startDate: `${year + 1}-01-01`, endDate: `${year + 3}-01-01`, rent: "600,000", note: "Demonstration: 20% increase at renewal",
  });

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
