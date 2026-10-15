/**
 * Starter records shared by the seed script and the first-run /setup page.
 * Every demonstration record is labelled "[DEMO]" so it is never mistaken for real data
 * (master prompt Section 52).
 */
import { asCompany, asPerson, createInvitation, respondInvitation, shareNote } from "./services/collab";
import { startConversation } from "./services/messaging";
import { prisma, withTenant, withUser } from "./db";
import { registerCompany, inviteMember, acceptInvitation } from "./services/companies";
import { createAsset, addParty } from "./services/assets";
import { createLease, getLease, recordLeasePayment, recordPayment } from "./services/leases";
import { reconcileReceipt, recordDepositReceived, requestAdjustment } from "./services/ledger";
import { proposeRenewal, recordHandover, recordNotice } from "./services/lifecycle";
import { assessPeriod, createServicePeriod, decideExpense, recordCollection, requestExpense } from "./services/service-charges";
import { completeObligation, createObligation } from "./services/obligations";
import { addFinding, decideInspection, installStarterTemplates, saveInspectionRecord, scheduleInspection, submitInspection } from "./services/inspections";
import {
  addMaterial, addWorkOrderPhoto, approveWorkOrder, assignWorkOrder, closeWorkOrder, completeWorkOrder, createContractor, createSchedule,
  reportWorkOrder, setProgress, triageWorkOrder,
} from "./services/maintenance";
import {
  acknowledgeSchedule, addScheduleLine, createHandoverSchedule, createItem, decideAdjustment, decideCount, recordMovement, requestAdjustment as requestStockAdjustment,
  saveCountLines, startCount, submitCount, useOnWorkOrder,
} from "./services/inventory";
import {
  addComparable, addEntry, assignValuation, createInstruction as createValuation, decideReport, saveReportDraft, saveWorksheet, submitReport,
} from "./services/valuation";
import {
  addMilestone, addWorkPackage, createProject, decideBudget, decideCommitment, decideInvoice, decideVariation, recordForecast, recordInvoice, requestCommitment,
  requestVariation, setProgress as setPackageProgress, submitBudget, activateProject, achieveMilestone,
} from "./services/project";
import {
  addProcurement, addQualityCheck, addRisk, appointParty, orderProcurement, recordDelivery, recordProgressUpdate, recordQualityResult, recordSiteInspection,
} from "./services/project-delivery";
import { useOnProject } from "./services/inventory";
import { addWarranty, decideCompletion, fixDefect, raiseDefect, requestCompletion, tickHandoverItem } from "./services/project-handover";
import { createTask } from "./services/tasks";
import { saveListingDraft, setListingStatus, reviewListing, reviewQueue } from "./services/listings";
import { addDepartment, listDepartments, updateRefPrefix, setMemberDepartment } from "./services/settings";
import { registerCorrespondence, actOnCorrespondence } from "./services/correspondence";
import { createPhysicalFile, issuePhysicalFile } from "./services/files";
import { todayInLagos, toDateOnlyString } from "./dates";
import type { Ctx } from "./services/context";
import { addCommissionRule, proposeCommission } from "./services/commission";
import { addDealTask, recordDealPayment } from "./services/deal-file";
import { completeDeal, counterOffer, createDeal, decideAcceptance, moveStage, recordOffer, requestAcceptance, scheduleViewing } from "./services/deal";
import { addClientActivity, addRequirement, createClient, createLead, setLeadStatus } from "./services/crm";
import { follow, registerSeeker, saveAgentProfile, saveCompanyProfile } from "./services/community";
import { assignSubscription } from "./services/subscriptions";

export const DEMO_PASSWORD = "demo-password-123";
export const DEMO_USERS = [
  { email: "demo.alpha@example.test", role: "Company Super Admin, [DEMO] Alpha Estates" },
  { email: "demo.manager@example.test", role: "Manager, [DEMO] Alpha Estates" },
  { email: "demo.officer@example.test", role: "Officer, [DEMO] Alpha Estates" },
  { email: "demo.beta@example.test", role: "Company Super Admin, [DEMO] Beta Property Managers" },
  { email: "demo.seeker@example.test", role: "Property seeker (no company)" },
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

  // Maintenance: a work order raised from the inspection finding, an emergency, a closed job and a recurring job.
  const sparky = await createContractor(alpha, { name: "[DEMO] Sparky Roofing & Electrical", trade: "Roofing, electrical", phone: "0800 000 0000", email: "", notes: "Demonstration contractor" });
  const roofFinding = await withTenant(alpha.companyId, alpha.userId, (tx) => tx.inspectionFinding.findFirstOrThrow({ where: { inspectionId: approved.id } }));
  const roofWo = await reportWorkOrder(officer, shop.id, {
    title: "Roof leak above storeroom", description: "Water stain after rain.", priority: "HIGH", riskLevel: "HIGH", findingId: roofFinding.id,
    targetDate: daysFromToday(10), estimatedCost: "180,000",
  });
  await triageWorkOrder(alpha, roofWo.id, { priority: "HIGH", riskLevel: "HIGH", targetDate: daysFromToday(10), estimatedCost: "180,000", note: "" });
  await approveWorkOrder(manager, roofWo.id, { approvedCost: "200,000" });
  await assignWorkOrder(alpha, roofWo.id, { assigneeId: officer.membershipId, contractorId: sparky.id });
  await setProgress(officer, roofWo.id, "IN_PROGRESS", "");
  await addWorkOrderPhoto(officer, roofWo.id, { phase: "BEFORE", caption: "Leak before repair" }, demoPhoto);
  await addMaterial(officer, roofWo.id, { description: "Roofing flashing", quantity: "6", unit: "pcs", unitCost: "12,500" });

  const pipe = await reportWorkOrder(officer, duplex.id, { title: "Burst pipe in kitchen", description: "Water running into the floor.", priority: "EMERGENCY", riskLevel: "CRITICAL", safetyRisk: true });
  await assignWorkOrder(alpha, pipe.id, { assigneeId: officer.membershipId, contractorId: sparky.id });

  const gate = await reportWorkOrder(manager, shop.id, { title: "Replace broken gate lock", description: "", priority: "NORMAL", riskLevel: "LOW", estimatedCost: "25,000" });
  await triageWorkOrder(alpha, gate.id, { priority: "NORMAL", riskLevel: "LOW", estimatedCost: "25,000", note: "" });
  await approveWorkOrder(alpha, gate.id, { approvedCost: "30,000" });
  await assignWorkOrder(alpha, gate.id, { assigneeId: officer.membershipId });
  await setProgress(officer, gate.id, "IN_PROGRESS", "");
  await addWorkOrderPhoto(officer, gate.id, { phase: "AFTER", caption: "New lock fitted" }, demoPhoto);
  await completeWorkOrder(officer, gate.id, { completedOn: daysFromToday(-1), notes: "Lock replaced and keys issued.", actualCost: "27,500" });
  await closeWorkOrder(manager, gate.id, "Checked on site");

  await createSchedule(alpha, shop.id, {
    title: "Generator service", description: "Quarterly service", priority: "NORMAL", intervalMonths: "3", nextDueOn: daysFromToday(20), leadDays: "30",
    contractorId: sparky.id, estimatedCost: "45,000",
  });

  // Inventory: stock with movements, a pending write-off, a submitted count and an acknowledged handover schedule.
  const generator = await createItem(alpha, { name: "[DEMO] Standby generator 20kVA", category: "Equipment", kind: "FIXED_ASSET", assetId: shop.id, quantity: "1", unit: "pcs", location: "Generator house", serialNumber: "DEMO-GEN-0001", manufacturer: "Demo Power", unitCost: "4,500,000", condition: "FAIR" });
  const cement = await createItem(alpha, { name: "[DEMO] Cement (50kg bags)", category: "Materials", kind: "CONSUMABLE", assetId: shop.id, quantity: "40", unit: "bags", location: "Store room", unitCost: "9,500", reorderLevel: "10" });
  const paint = await createItem(alpha, { name: "[DEMO] Emulsion paint (20L)", category: "Materials", kind: "CONSUMABLE", assetId: duplex.id, quantity: "6", unit: "tins", location: "Store room", unitCost: "28,000", reorderLevel: "8" });
  await recordMovement(officer, cement.id, { kind: "ISSUE", quantity: "5", reference: "DEMO-REQ-001", note: "Boundary wall repair" });
  await recordMovement(officer, generator.id, { kind: "TRANSFER", toLocation: "Workshop", note: "Sent for service" });
  await useOnWorkOrder(officer, cement.id, roofWo.id, { quantity: "2" });
  await requestStockAdjustment(officer, paint.id, { kind: "DAMAGE", quantity: "1", reason: "Tin damaged in the store room" });
  const wrongCount = await requestStockAdjustment(officer, cement.id, { kind: "ADJUSTMENT", quantity: "2", direction: "DOWN", reason: "Recount found two bags short" });
  await decideAdjustment(manager, wrongCount.id, "approve", "");
  const stocktake = await startCount(alpha, { title: "[DEMO] Shop store room count", assetId: shop.id });
  {
    const lines = await withTenant(alpha.companyId, alpha.userId, (tx) => tx.inventoryCountLine.findMany({ where: { countId: stocktake.id }, include: { item: { select: { itemNo: true } } } }));
    await saveCountLines(officer, stocktake.id, Object.fromEntries(lines.map((l) => [l.id, { counted: String(l.item.itemNo === cement.itemNo ? l.expectedQty - 1 : l.expectedQty), note: l.item.itemNo === cement.itemNo ? "One torn bag" : "" }])));
    await submitCount(officer, stocktake.id);
  }
  const moveIn = await createHandoverSchedule(officer, shopLease.id, "MOVE_IN");
  await addScheduleLine(officer, moveIn.id, { room: "Main shop floor", description: "Ceiling fans", quantity: "3", condition: "GOOD" }, { ...demoPhoto, caption: "Fans" });
  await addScheduleLine(officer, moveIn.id, { room: "Main shop floor", description: "Display shelving units", quantity: "6", condition: "FAIR", notes: "Two shelves chipped" });
  await addScheduleLine(officer, moveIn.id, { room: "Storeroom", description: "Roller shutter", quantity: "1", condition: "GOOD" });
  await acknowledgeSchedule(officer, moveIn.id, { acknowledgedBy: "[DEMO] Tenant Representative", acknowledgedOn: daysFromToday(-30) });

  // Valuation: one approved going-concern valuation with evidence, and one still in progress.
  const valuation = await createValuation(alpha, {
    assetId: shop.id, clientName: "[DEMO] Lender Plc", clientReference: "DEMO-LOAN-001", purpose: "MORTGAGE_SECURITY", basis: "MARKET_VALUE", premise: "GOING_CONCERN",
    assetDescription: "[DEMO] Two-storey commercial building of about 180 square metres with a trading shop on the ground floor.",
    scope: "Valuation for loan security. Internal and external inspection.", valuationDate: daysFromToday(-10), inspectionDate: daysFromToday(-12), dueDate: daysFromToday(5),
    assignedToId: officer.membershipId, professionalName: "[DEMO] Valuer", professionalBody: "[DEMO] Professional Body", registrationNo: "DEMO-0000",
  } as never);
  await addEntry(officer, valuation.id, "PREMISE", "Valued as a going concern: the shop continues to trade from the premises.");
  await addEntry(officer, valuation.id, "ASSUMPTION", "Title is good and marketable and free of undisclosed encumbrances.");
  await addEntry(officer, valuation.id, "LIMITATION", "No structural survey was carried out. Areas were measured on site, not from drawings.");
  for (const c of [
    { address: "[DEMO] 14 Market Road", price: "50,000,000", area: "200", adjustment: "10", adjustmentNote: "Inferior position", weight: "100", source: "[DEMO] Agent letter" },
    { address: "[DEMO] 3 Station Street", price: "60,000,000", area: "250", adjustment: "0", adjustmentNote: "", weight: "100", source: "[DEMO] Deed of assignment" },
    { address: "[DEMO] 22 Canal Road", price: "42,000,000", area: "170", adjustment: "-5", adjustmentNote: "Superior finish", weight: "50", source: "[DEMO] Auction record" },
  ]) {
    await addComparable(officer, valuation.id, { kind: "SALE", evidenceDate: daysFromToday(-90), ...c });
  }
  await saveWorksheet(officer, valuation.id, "SALES_COMPARISON", { subjectArea: "180" }, "Primary method");
  await saveWorksheet(officer, valuation.id, "INCOME_CAPITALISATION", { grossRent: "6,000,000", vacancy: "10", operatingCosts: "600,000", capRate: "10" }, "Cross-check");
  await saveReportDraft(officer, valuation.id, {
    summary: "[DEMO] The property is a commercial building in a good trading position.", conclusion: "[DEMO] The market value on a going-concern basis is stated below.",
    concludedValue: "47,000,000", reconciliationNote: "Weighted towards the sales comparison, with the income method as a cross-check.",
  });
  await submitReport(officer, valuation.id);
  await decideReport(manager, valuation.id, "approve", "Evidence checked.", false);
  const pendingValuation = await createValuation(alpha, {
    assetId: duplex.id, clientName: "[DEMO] Private Client", purpose: "SALE", basis: "MARKET_VALUE", premise: "STANDARD", dueDate: daysFromToday(14),
    professionalName: "[DEMO] Valuer", professionalBody: "[DEMO] Professional Body", registrationNo: "DEMO-0000",
  } as never);
  await addComparable(officer, pendingValuation.id, { kind: "SALE", address: "[DEMO] 9 Garden Close", evidenceDate: daysFromToday(-60), price: "80,000,000", area: "300", source: "[DEMO] Agent letter" });
  await assignValuation(alpha, pendingValuation.id, officer.membershipId);

  // Projects: one active renovation with an approved budget, spending, a variation and progress; one still being planned.
  const reno = await createProject(alpha, {
    assetId: shop.id, title: "[DEMO] Shopfront renovation", kind: "RENOVATION", description: "[DEMO] New shopfront, roof repairs and repainting.", managerId: manager.membershipId,
    plannedStart: daysFromToday(-30), plannedEnd: daysFromToday(60), contingency: "1,000,000",
  });
  const wpRoof = (await addWorkPackage(officer, reno.id, { title: "Roof repairs", plannedStart: daysFromToday(-30), plannedEnd: daysFromToday(10), budget: "4,000,000", responsibleId: officer.membershipId })).workPackage;
  const wpFront = (await addWorkPackage(officer, reno.id, { title: "New shopfront", plannedStart: daysFromToday(-10), plannedEnd: daysFromToday(45), budget: "6,000,000", responsibleId: officer.membershipId })).workPackage;
  const wpPaint = (await addWorkPackage(officer, reno.id, { title: "Repainting", plannedStart: daysFromToday(30), plannedEnd: daysFromToday(60), budget: "2,000,000" })).workPackage;
  await addMilestone(officer, reno.id, { title: "Roof watertight", dueOn: daysFromToday(10), workPackageId: wpRoof.id });
  await addMilestone(officer, reno.id, { title: "Shopfront installed", dueOn: daysFromToday(45), workPackageId: wpFront.id });
  await submitBudget(officer, reno.id);
  await decideBudget(manager, reno.id, "approve", "Budget agreed.");
  await activateProject(alpha, reno.id);
  const roofCommitment = await requestCommitment(officer, reno.id, { supplierName: "[DEMO] Roofing Contractors", description: "Roof repairs", amount: "3,800,000", workPackageId: wpRoof.id });
  await decideCommitment(manager, roofCommitment.id, "approve", "");
  const frontCommitment = await requestCommitment(officer, reno.id, { supplierName: "[DEMO] Glazing Ltd", description: "Aluminium shopfront", amount: "5,500,000", workPackageId: wpFront.id });
  await decideCommitment(manager, frontCommitment.id, "approve", "");
  const inv1 = await recordInvoice(officer, roofCommitment.id, { invoiceNo: "DEMO-INV-001", invoiceDate: daysFromToday(-5), amount: "1,900,000" });
  await decideInvoice(manager, inv1.id, "approve", "Work seen on site.");
  await recordInvoice(officer, frontCommitment.id, { invoiceNo: "DEMO-INV-002", invoiceDate: daysFromToday(-2), amount: "2,000,000" });
  await requestCommitment(officer, reno.id, { supplierName: "[DEMO] Paint Supplies", description: "Paint and rollers", amount: "900,000", workPackageId: wpPaint.id });
  const extra = await requestVariation(officer, reno.id, { target: "COMMITMENT", commitmentId: roofCommitment.id, title: "Extra rotten timber found", reason: "Further timber replaced after the roof was opened.", amount: "250,000", timeImpactDays: "3" });
  await decideVariation(manager, extra.id, "approve", "Agreed.");
  await setPackageProgress(officer, wpRoof.id, "IN_PROGRESS", "70");
  await setPackageProgress(officer, wpFront.id, "IN_PROGRESS", "25");
  await recordForecast(officer, wpFront.id, "3,900,000", "Quote for remaining glazing");
  await achieveMilestone(officer, (await withTenant(alpha.companyId, alpha.userId, (tx) => tx.milestone.findFirstOrThrow({ where: { projectId: reno.id, title: "Roof watertight" } }))).id).catch(() => undefined);
  await appointParty(officer, reno.id, { role: "CONTRACTOR", name: "[DEMO] Roofing Contractors", scope: "Roof repairs" });
  await appointParty(officer, reno.id, { role: "CONSULTANT", name: "[DEMO] Structural Engineer", scope: "Inspect roof timbers" });
  const cementReq = await addProcurement(officer, reno.id, { description: "Cement for the shopfront base", quantity: "30", unit: "bags", requiredBy: daysFromToday(-3), workPackageId: wpFront.id });
  await orderProcurement(manager, cementReq.id, { supplierName: "[DEMO] Building Supplies", commitmentId: frontCommitment.id });
  await recordDelivery(officer, cementReq.id, { quantity: "20", inventoryItemId: cement.id });
  await addProcurement(officer, reno.id, { description: "Aluminium frames", quantity: "12", unit: "pcs", requiredBy: daysFromToday(14), workPackageId: wpFront.id });
  await useOnProject(officer, cement.id, reno.id, { quantity: "5", workPackageId: wpFront.id });
  await addRisk(officer, reno.id, { title: "Rain delays the roof work", likelihood: "4", impact: "4", ownerId: manager.membershipId, mitigation: "Cover the opened roof each evening", category: "Weather", reviewOn: daysFromToday(7) });
  await addRisk(officer, reno.id, { title: "Imported glass arrives late", likelihood: "2", impact: "3", category: "Supply" });
  await recordSiteInspection(officer, reno.id, { inspectedOn: daysFromToday(-4), summary: "Roof timbers replaced on the north side. Work tidy.", outcome: "SATISFACTORY", workPackageId: wpRoof.id });
  await recordSiteInspection(officer, reno.id, { inspectedOn: daysFromToday(-1), summary: "Shopfront frame is out of level on the left.", actions: "Contractor to re-fix the frame", outcome: "ACTIONS_REQUIRED", workPackageId: wpFront.id });
  await recordProgressUpdate(officer, reno.id, { summary: "Roof work is going well. Shopfront has started.", issues: "Frames are on order", nextSteps: "Finish the roof" });
  const roofCheck = await addQualityCheck(officer, wpRoof.id, { title: "Roof is watertight", standard: "Water test" });
  await recordQualityResult(manager, roofCheck.id, "PASSED", "Hose test, no leaks");
  await addQualityCheck(officer, wpFront.id, { title: "Frame is level and plumb" });
  // A finished project: completed with a second person's approval, one defect fixed and waiting for verification, and a warranty on the asset.
  const gateJob = await createProject(alpha, { assetId: duplex.id, title: "[DEMO] Duplex gate repair", kind: "REPAIR_PROGRAMME", plannedStart: daysFromToday(-40), plannedEnd: daysFromToday(-5), managerId: manager.membershipId });
  const wpGateJob = (await addWorkPackage(officer, gateJob.id, { title: "Gate and fence", plannedStart: daysFromToday(-40), plannedEnd: daysFromToday(-5), budget: "800,000" })).workPackage;
  await submitBudget(officer, gateJob.id);
  await decideBudget(manager, gateJob.id, "approve", "Agreed.");
  await activateProject(alpha, gateJob.id);
  await setPackageProgress(officer, wpGateJob.id, "DONE", "100");
  await requestCompletion(officer, gateJob.id, { note: "Gate fitted and painted.", defectsMonths: "12" });
  await decideCompletion(manager, gateJob.id, "approve", "Inspected and accepted.");
  const gateDefect = await raiseDefect(officer, gateJob.id, { title: "Gate drags on the ground", severity: "MEDIUM", description: "Hinges need adjusting." });
  await fixDefect(officer, gateDefect.id, "Hinges adjusted.");
  await raiseDefect(officer, gateJob.id, { title: "Paint chipped near the lock", severity: "LOW" });
  await addWarranty(officer, gateJob.id, { title: "Gate and ironwork", provider: "[DEMO] Ironworks Ltd", startsOn: daysFromToday(-5), endsOn: daysFromToday(360), coverage: "Defective workmanship" });
  const gateItems = await withTenant(alpha.companyId, alpha.userId, (tx) => tx.handoverItem.findMany({ where: { projectId: gateJob.id }, orderBy: { sortOrder: "asc" }, take: 3 }));
  for (const it of gateItems) await tickHandoverItem(officer, it.id, true, "");
  await raiseDefect(officer, reno.id, { title: "Paint run on the shopfront fascia", severity: "LOW" });
  await createProject(alpha, {
    assetId: duplex.id, title: "[DEMO] Duplex kitchen refit", kind: "FIT_OUT", plannedStart: daysFromToday(30), plannedEnd: daysFromToday(75), managerId: manager.membershipId,
  });

  // Approve only the demo listings, never real submissions waiting for review.
  for (const l of await reviewQueue(adminId)) {
    if (l.title.startsWith("[DEMO]")) await reviewListing(adminId, l.id, "approve", "Demo data approved automatically");
  }

  // Clients, leads, a follow-up and a requirement, so the sales pages have something real to show.
  const buyer = await createClient(alpha, { name: "[DEMO] Chinedu Okafor", email: "demo.chinedu@example.test", phone: "0803 555 0101", city: "Lagos", marketingConsent: true });
  const buyerLead = await createLead(alpha, buyer.id, { title: "[DEMO] Three-bedroom duplex in Lekki", budgetMax: "120,000,000", timeline: "WITHIN_3_MONTHS", financing: "CASH", decisionMaker: true });
  await setLeadStatus(alpha, buyerLead.id, "QUALIFIED");
  await addClientActivity(alpha, buyer.id, { kind: "CALL", subject: "[DEMO] Intro call", body: "Wants to view in two weeks.", leadId: buyerLead.id });
  await addClientActivity(alpha, buyer.id, { kind: "FOLLOW_UP", subject: "[DEMO] Send shortlist", dueOn: daysFromToday(2), leadId: buyerLead.id });
  await addRequirement(alpha, buyer.id, { purpose: "SALE", assetClass: "RESIDENTIAL", city: "Lagos", state: "Lagos", bedroomsMin: "3", budgetMax: "150,000,000", leadId: buyerLead.id });
  const buyerDeal = await createDeal(alpha, { clientId: buyer.id, leadId: buyerLead.id, assetId: duplex.id, type: "SALE", asking: "110,000,000", title: "[DEMO] Sale of the duplex to Chinedu Okafor" });
  await scheduleViewing(alpha, buyerDeal.id, { date: daysFromToday(3), time: "10:00", minutes: "45", meetingPoint: "Main gate" });
  const firstOffer = await recordOffer(alpha, buyerDeal.id, { side: "CLIENT", amount: "95,000,000", note: "[DEMO] Opening offer" });
  await counterOffer(alpha, firstOffer.id, { amount: "105,000,000", note: "[DEMO] Owner's counter" });
  await recordDealPayment(alpha, buyerDeal.id, { kind: "BOOKING_DEPOSIT", amount: "5,000,000", paidOn: daysFromToday(-1), method: "Bank transfer", reference: "[DEMO] TRF-0001" });
  await addDealTask(alpha, buyerDeal.id, { title: "[DEMO] Ask the owner for the title documents", dueOn: daysFromToday(4) });
  // A finished sale with its commission waiting for a second person's approval.
  const terrace = await createAsset(alpha, { name: "[DEMO] Ikeja terrace house", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });
  const soldTo = await createClient(alpha, { name: "[DEMO] Ngozi Eze", phone: "0805 555 0103", city: "Lagos" });
  const soldDeal = await createDeal(alpha, { clientId: soldTo.id, assetId: terrace.id, type: "SALE", asking: "60,000,000", title: "[DEMO] Sale of the Ikeja terrace house" });
  const soldOffer = await recordOffer(alpha, soldDeal.id, { side: "CLIENT", amount: "57,000,000" });
  await requestAcceptance(alpha, soldOffer.id);
  await decideAcceptance(manager, soldOffer.id, "approve", "Price confirmed with the owner.");
  await moveStage(alpha, soldDeal.id, "LEGAL");
  await completeDeal(manager, soldDeal.id, "Keys and title handed over.");
  const demoRule = await addCommissionRule(alpha, { name: "[DEMO] Standard sales commission", applies: "SALE", method: "PERCENT", rate: "5" });
  await proposeCommission(alpha, soldDeal.id, { ruleId: demoRule.id, splits: [{ membershipId: alpha.membershipId, role: "SELLING_AGENT", share: "100" }] });
  const tenant = await createClient(manager, { name: "[DEMO] Amina Bello", phone: "0802 555 0102", city: "Abuja", confidential: true });
  await createLead(manager, tenant.id, { title: "[DEMO] Two-bedroom flat to rent in Abuja", budgetMax: "4,000,000" });

  // Public profiles, a seeker with a plan who follows them, so the directory and account pages have something real to show.
  await saveAgentProfile(alpha, { displayName: "[DEMO] Ada Demo", headline: "[DEMO] Lekki and Ikoyi sales", bio: "Demonstration profile.", listed: true, acceptsMessages: true });
  await saveCompanyProfile(alpha, { kind: "COMPANY", displayName: "[DEMO] Alpha Estates", tagline: "[DEMO] Sales and property management", about: "Demonstration profile.", listed: true });
  await saveCompanyProfile(beta, { kind: "DEVELOPER", displayName: "[DEMO] Beta Developments", tagline: "[DEMO] Residential estates", about: "Demonstration profile.", listed: true });
  const seeker = await registerSeeker({ name: "[DEMO] Seyi Seeker", email: "demo.seeker@example.test", password: DEMO_PASSWORD });
  const premium = await withUser("demo-seed", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "premium-seeker" } }));
  const inAYear = toDateOnlyString(new Date(Date.now() + 365 * 864e5));
  await assignSubscription(adminId, { planId: premium.id, periodEnd: inAYear, email: "demo.seeker@example.test", note: "[DEMO] Demonstration subscription" });
  const proCompany = await withUser("demo-seed", (tx) => tx.subscriptionPlan.findUniqueOrThrow({ where: { code: "company-professional" } }));
  await assignSubscription(adminId, { planId: proCompany.id, periodEnd: inAYear, companyId: alpha.companyId, note: "[DEMO] Demonstration subscription" });
  await assignSubscription(adminId, { planId: proCompany.id, periodEnd: inAYear, companyId: beta.companyId, note: "[DEMO] Demonstration subscription" });
  await follow(seeker.userId, "AGENT", alpha.userId);
  await follow(seeker.userId, "DEVELOPER", beta.companyId);

  // Collaboration: two companies already working together, and a seeker's invitation waiting for an agent to answer.
  const pair = await createInvitation(asCompany(alpha), { kind: "COMPANY_COMPANY", purpose: "CO_BROKERAGE", title: "[DEMO] Co-brokerage on the Lekki terraces", scope: "Demonstration collaboration.", companyId: beta.companyId }, true);
  await respondInvitation(asCompany(beta), pair.id, "accept", "[DEMO] Happy to work together");
  await shareNote(asCompany(alpha), pair.id, { title: "[DEMO] Viewing times", body: "Weekdays after 4pm." });
  await createInvitation(asPerson(seeker.userId), { kind: "SEEKER_AGENT", purpose: "SEARCH_ASSISTANCE", title: "[DEMO] Help me find a flat in Lekki", scope: "Two bedrooms.", agentUserId: alpha.userId }, true);

  await startConversation(asPerson(seeker.userId), { toUserId: alpha.userId, subject: "[DEMO] A two-bedroom flat", body: "[DEMO] Hello, I am looking for a two-bedroom flat in Lekki. Is the terrace still available?" });

  return true;
}
