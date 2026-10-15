/**
 * Phase 8 acceptance. A company follows a lead through the whole authorised transaction and retrieves its communications,
 * viewings, documents and financial records; a buyer asks an approved provider to verify a property and no personal data
 * reaches the provider before explicit consent.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset, getAsset } from "../../src/lib/services/assets";
import { registerCorrespondence } from "../../src/lib/services/correspondence";
import { addClientActivity, createClient, createLead, setLeadStatus, updateQualification } from "../../src/lib/services/crm";
import { completeDeal, counterOffer, createDeal, decideAcceptance, moveStage, recordOffer, requestAcceptance, scheduleViewing, getDeal } from "../../src/lib/services/deal";
import { addDealDocument, addDealTask, getDealFile, linkCorrespondence, recordDealPayment } from "../../src/lib/services/deal-file";
import { addCommissionRule, decideCommission, getDealCommission, payCommissionSplit, proposeCommission } from "../../src/lib/services/commission";
import { companyReport, salesDashboard } from "../../src/lib/services/sales";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { recordRecommendationEvent, saveProvider, submitLead, verificationMetrics } from "../../src/lib/services/verification";
import { addMember, newCompany, newPlatformAdmin, PDF_BYTES, relativeDate } from "./helpers";

after(() => prisma.$disconnect());

test("a lead is followed through the authorised workflow, and its whole file can be retrieved", async () => {
  const admin = await newCompany("accept");
  const manager = await addMember(admin, "MANAGER", "mgr");
  const approver = await addMember(admin, "MANAGER", "apr");
  const agent = await addMember(admin, "AGENT", "ag");
  const stranger = await addMember(admin, "AGENT", "stranger");
  const asset = await createAsset(admin, { name: "Acceptance terrace", assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" });

  const client = await createClient(agent, { name: "Ngozi Accept Buyer", phone: "08035550101", email: "ngozi@example.test" } as never);
  const lead = await createLead(agent, client.id, { title: "Wants a terrace house", ownerId: agent.membershipId } as never);
  await assert.rejects(setLeadStatus(agent, lead.id, "QUALIFIED"), /budget/i);
  await updateQualification(agent, lead.id, { title: "Wants a terrace house", budgetMax: "90,000,000", timeline: "WITHIN_3_MONTHS", financing: "CASH", decisionMaker: true } as never);
  await setLeadStatus(agent, lead.id, "QUALIFIED");

  const deal = await createDeal(agent, { clientId: client.id, leadId: lead.id, assetId: asset.id, type: "SALE", asking: "85,000,000", expectedCloseOn: relativeDate(30) } as never);
  await scheduleViewing(agent, deal.id, { date: relativeDate(3), time: "11:00", minutes: "45", meetingPoint: "Main gate" } as never);
  await addClientActivity(agent, client.id, { kind: "CALL", subject: "Agreed a viewing", body: "Client is keen", dealId: deal.id });

  const first = await recordOffer(agent, deal.id, { side: "CLIENT", amount: "78,000,000" } as never);
  const counter = await counterOffer(agent, first.id, { amount: "82,000,000" } as never);
  const final = await counterOffer(agent, counter.id, { amount: "80,000,000" } as never);
  await requestAcceptance(agent, final.id);
  await assert.rejects(decideAcceptance(agent, final.id, "approve", ""), /./);
  await decideAcceptance(manager, final.id, "approve", "Price agreed");
  assert.ok(counter.id);

  await addDealDocument(agent, deal.id, "OFFER_LETTER", "Signed offer letter", { name: "offer.pdf", type: "application/pdf", bytes: PDF_BYTES });
  await recordDealPayment(agent, deal.id, { kind: "BOOKING_DEPOSIT", amount: "8,000,000", paidOn: relativeDate(-1), reference: "TRF-DEP" });
  await recordDealPayment(agent, deal.id, { kind: "BALANCE", amount: "72,000,000", paidOn: relativeDate(0), reference: "TRF-BAL" });
  const letter = await registerCorrespondence(admin, { direction: "INCOMING", subject: "Solicitor's completion letter", senderName: "Okoro & Co", recipientName: "Company", dateReceived: relativeDate(-1) } as never);
  await linkCorrespondence(agent, deal.id, letter.id);
  await addDealTask(agent, deal.id, { title: "Collect the keys", assigneeId: manager.membershipId, dueOn: relativeDate(5) });

  await moveStage(agent, deal.id, "LEGAL");
  await assert.rejects(completeDeal(agent, deal.id, "Done"), /./, "the owner cannot complete their own deal");
  await completeDeal(approver, deal.id, "Keys handed over");

  const rule = await addCommissionRule(manager, { name: "Sales 5%", applies: "SALE", method: "PERCENT", rate: "5" });
  await proposeCommission(agent, deal.id, { ruleId: rule.id, splits: [{ membershipId: agent.membershipId, role: "SELLING_AGENT", share: "100" }] });
  await assert.rejects(decideCommission(agent, deal.id, "approve"), /permission/i);
  await decideCommission(approver, deal.id, "approve", "In line with policy");
  const split = (await getDealCommission(admin, deal.id)).commission!.splits[0];
  assert.equal(split.amountKobo, 400_000_000n);
  await payCommissionSplit(manager, split.id, { paidOn: relativeDate(0), reference: "COMM-1" });

  // The whole file comes back in one retrieval.
  const f = (await getDealFile(agent, deal.id))!;
  assert.equal(f.deal.stage, "COMPLETED");
  assert.equal(f.deal.status, "COMPLETED");
  assert.equal(f.lead?.id, lead.id);
  assert.equal(f.client.id, client.id);
  assert.equal(f.viewings.length, 1);
  assert.equal(f.documents.length, 1);
  assert.equal(f.payments.length, 2);
  assert.equal(f.totals.net, 8_000_000_000n);
  assert.deepEqual(f.correspondence.map((c) => c.id), [letter.id]);
  assert.equal(f.tasks.length, 1);
  assert.ok(f.activities.some((a) => a.subject === "Agreed a viewing"));
  const detail = await getDeal(agent, deal.id);
  assert.ok(detail!.offers.length >= 3, "the negotiation history is kept");
  const c = await getDealCommission(agent, deal.id);
  assert.equal(c.commission?.status, "PAID");

  // The company sees it in its reports; a colleague with no part in it does not see the deal at all.
  const report = await companyReport(manager, { from: new Date(Date.UTC(2020, 0, 1)), to: new Date(Date.now() + 2 * 864e5) });
  assert.equal(report.completedTotals.count, 1);
  assert.equal(report.leads.converted, 1);
  const dash = await salesDashboard(agent);
  assert.equal(dash.me.completedDeals, 1);
  await assert.rejects(getDealFile(stranger, deal.id), /not found/i);
  await assert.rejects(companyReport(agent, { from: new Date(Date.UTC(2020, 0, 1)), to: new Date() }), /permission/i);
  assert.equal((await getAsset(admin, asset.id))!.asset.tasks.length, 0, "deal tasks stay off the asset");
});

test("a buyer asks an approved provider to verify a property, and nothing personal is stored or shared before consent", async () => {
  const company = await newCompany("verify8");
  const platform = await newPlatformAdmin();
  const asset = await createAsset(company, { name: "Verify plot", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER" });
  await saveListingDraft(company, asset.id, { title: "Plot in Epe", purpose: "SALE", price: "12,000,000", city: "Epe", state: "Lagos" });
  await setListingStatus(company, asset.id, "PENDING_REVIEW");
  const listing = (await getAsset(company, asset.id))!.asset.listing!;
  await reviewListing(platform.id, listing.id, "approve", "");

  const pending = await saveProvider(null, { name: "Pending Checks Ltd", shortName: "PCL", status: "PENDING", placement: "EDITORIAL", featured: false });
  const approved = await saveProvider(null, { name: "Approved Checks Ltd", shortName: "ACL", services: "Title search", status: "APPROVED", placement: "AFFILIATED", featured: false });
  const key = `v8-${Date.now()}`;
  const base = { listingRef: listing.publicRef, name: "Tunde Buyer", contactMethod: "phone" as const, contactValue: "08039998877" };

  // Not approved: no request can be made.
  await assert.rejects(submitLead({ ...base, providerId: pending.id, consent: "yes" }, null, `${key}-p`), /not available/);

  const before = await verificationMetrics();
  await recordRecommendationEvent({ providerId: approved.id, listingRef: listing.publicRef, userId: null, visitorKey: key, trigger: "enquiry", event: "IMPRESSION" });
  const shown = await prisma.recommendationEvent.findMany({ where: { visitorKey: key } });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].preselected, true, "Yes is preselected on display");
  const afterShown = await verificationMetrics();
  assert.equal(afterShown.confirmedInterest, before.confirmedInterest, "the default is not interest");
  assert.equal(await prisma.providerLead.count({ where: { providerId: approved.id } }), 0, "nothing personal exists yet");

  // Without consent nothing is stored.
  await assert.rejects(submitLead({ ...base, providerId: approved.id, consent: "no" as never }, null, `${key}-a`), /agree/);
  await assert.rejects(submitLead({ ...base, providerId: approved.id } as never, null, `${key}-b`), /agree/);
  assert.equal(await prisma.providerLead.count({ where: { providerId: approved.id } }), 0);

  // Explicit consent creates the request, recording which consent text was agreed to.
  await recordRecommendationEvent({ providerId: approved.id, listingRef: listing.publicRef, userId: null, visitorKey: key, trigger: "enquiry", event: "CONFIRMED_INTEREST" });
  const { ref } = await submitLead({ ...base, providerId: approved.id, consent: "yes" }, null, `${key}-c`);
  const lead = await prisma.providerLead.findUniqueOrThrow({ where: { ref } });
  assert.ok(lead.consentGivenAt);
  assert.ok(lead.consentTextVersion.length > 0);
  const interest = await prisma.recommendationEvent.findMany({ where: { visitorKey: key, event: "CONFIRMED_INTEREST" } });
  assert.equal(interest[0].preselected, false);
  assert.equal((await verificationMetrics()).confirmedInterest, before.confirmedInterest + 1);
});
