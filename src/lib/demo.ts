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
import { assessPeriod, createServicePeriod, decideExpense, recordCollection, requestExpense } from "./services/service-charges";
import { completeObligation, createObligation } from "./services/obligations";
import { addFinding, decideInspection, installStarterTemplates, saveInspectionRecord, scheduleInspection, submitInspection } from "./services/inspections";
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

  // Service charges: a plaza with two units, the budget shared by floor area, a payment and two expenses.
  const plaza = await createAsset(alpha, {
    name: "[DEMO] Plaza, Opebi Road", assetClass: "COMMERCIAL", category: "Office block",
    city: "Ikeja", state: "Lagos", companyRelationship: "OWNER",
  });
  for (const [unit, name, area] of [["Suite A", "[DEMO] Bright Accountants", "60"], ["Suite B", "[DEMO] Swift Logistics", "140"]] as const) {
    await createLease(alpha, plaza.id, {
      occupantName: name, unit, startDate: `${year - 1}-01-01`, endDate: `${year + 1}-01-01`, rent: "1,200,000", frequency: "YEARLY",
      floorAreaSqm: area,
    });
  }
  const period = await createServicePeriod(alpha, plaza.id, {
    name: `[DEMO] ${year} service charge`, startDate: `${year}-01-01`, endDate: `${year + 1}-01-01`, budget: "6,000,000", method: "FLOOR_AREA",
  });
  await assessPeriod(alpha, period.id, { dueDate: `${year}-03-31` });
  const assessments = await withTenant(alpha.companyId, alpha.userId, (tx) =>
    tx.serviceAssessment.findMany({ where: { periodId: period.id }, orderBy: { amountKobo: "asc" } }));
  await recordCollection(officer, assessments[1].id, { amount: "2,000,000", paidOn: daysFromToday(-3), evidence: "DEMO-SVC-0001", method: "Bank transfer" });
  const diesel = await requestExpense(officer, period.id, {
    description: "[DEMO] Generator diesel", supplier: "[DEMO] Fuel Depot", amount: "400,000", incurredOn: daysFromToday(-2), evidence: "DEMO-INV-0101",
  });
  await decideExpense(alpha, diesel.id, "approve", "Demonstration approval");
  await requestExpense(officer, period.id, {
    description: "[DEMO] Lift servicing", supplier: "[DEMO] Lift Co", amount: "250,000", incurredOn: daysFromToday(-1), evidence: "DEMO-INV-0102",
  });

  // Obligations: one overdue, one due soon that repeats, one needing professional review, one already done.
  await createObligation(alpha, {
    assetId: duplex.id, kind: "LAND_USE_CHARGE", title: `[DEMO] Land use charge ${year}`, authority: "[DEMO] Lands Bureau",
    jurisdiction: "Lagos State", amount: "150,000", dueDate: daysFromToday(-20), notes: "Demonstration only. Enter the real assessed amount.",
  });
  await createObligation(alpha, {
    assetId: plaza.id, kind: "INSURANCE", title: "[DEMO] Building insurance renewal", authority: "[DEMO] Insurer",
    dueDate: daysFromToday(12), recurrenceMonths: "12", amount: "900,000",
  });
  await createObligation(alpha, {
    kind: "WITHHOLDING_TAX", title: "[DEMO] Withholding tax remittance on rent", authority: "[DEMO] Tax authority",
    dueDate: daysFromToday(45), requiresProfessionalReview: true, notes: "Demonstration: confirm the treatment with the tax adviser.",
  });
  const permit = await createObligation(alpha, {
    assetId: shop.id, kind: "PERMIT", title: "[DEMO] Signage permit", authority: "[DEMO] Local authority", dueDate: daysFromToday(-60),
  });
  await completeObligation(officer, permit.id, { completedOn: daysFromToday(-65), evidence: "DEMO-PERMIT-0001" });

  // Inspections: one approved (and repeating), one waiting for approval, one overdue.
  await installStarterTemplates(alpha);
  const templates = await withTenant(alpha.companyId, alpha.userId, (tx) =>
    tx.inspectionTemplate.findMany({ where: { companyId: alpha.companyId }, include: { items: true } }));
  const commercial = templates.find((t) => t.name === "Commercial property inspection")!;
  const residential = templates.find((t) => t.name === "Residential property inspection")!;
  const demoPhoto = { name: "demo.png", type: "image/png", bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64")) };
  const answerAll = async (inspectionId: string, templateItems: number, failIndex: number | null) => {
    const rows = await withTenant(alpha.companyId, alpha.userId, (tx) => tx.inspectionResponse.findMany({ where: { inspectionId }, orderBy: { sortOrder: "asc" } }));
    const responses: Record<string, { result: "PASS" | "FAIL"; note: string }> = {};
    rows.forEach((r, i) => { responses[r.id] = i === failIndex ? { result: "FAIL", note: "Demonstration: water stain on ceiling" } : { result: "PASS", note: "" }; });
    return { responses, count: templateItems };
  };
  const approved = await scheduleInspection(alpha, shop.id, {
    templateId: commercial.id, purpose: "ROUTINE", scheduledFor: daysFromToday(-40), inspectorId: officer.membershipId, recurrenceMonths: "6", location: "Whole shop",
  });
  {
    const { responses } = await answerAll(approved.id, commercial.items.length, 1);
    await saveInspectionRecord(officer, approved.id, {
      conductedOn: daysFromToday(-39), conditionRating: "FAIR", summary: "Demonstration: generally sound, a roof leak over the storeroom.",
      recommendedActions: "Repair roof flashing", estimatedRepair: "180,000", followUpBy: daysFromToday(20), responses,
    });
    await addFinding(officer, approved.id, {
      title: "Roof leak above storeroom", severity: "HIGH", location: "Storeroom", estimatedCost: "180,000", recommendedAction: "Replace flashing and reseal",
    }, { ...demoPhoto, phase: "EVIDENCE", caption: "Water stain" });
    await submitInspection(officer, approved.id);
    await decideInspection(alpha, approved.id, "approve", "");
  }
  const waiting = await scheduleInspection(alpha, duplex.id, {
    templateId: residential.id, purpose: "CONDITION_SURVEY", scheduledFor: daysFromToday(-3), inspectorId: officer.membershipId,
  });
  {
    const { responses } = await answerAll(waiting.id, residential.items.length, null);
    await saveInspectionRecord(officer, waiting.id, { conductedOn: daysFromToday(-2), conditionRating: "GOOD", summary: "Demonstration: in good order.", responses });
    await submitInspection(officer, waiting.id);
  }
  await scheduleInspection(alpha, plaza.id, { templateId: commercial.id, purpose: "ROUTINE", scheduledFor: daysFromToday(-5), inspectorId: officer.membershipId });

  // Approve only the demo listings, never real submissions waiting for review.
  for (const l of await reviewQueue(adminId)) {
    if (l.title.startsWith("[DEMO]")) await reviewListing(adminId, l.id, "approve", "Demo data approved automatically");
  }

  return true;
}
