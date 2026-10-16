/**
 * Phase 10b: vacancy reports. Submission and privacy, duplicate detection and ownership, the review workflow, owner authorisation kept
 * apart from publishing, warning signs, appeals, rewards, and aggregate figures, against a real PostgreSQL database through the runtime role.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import {
  advanceStage, appealVacancy, approveVacancy, attestTransaction, authoriseLead, declineLead, getMyVacancy, getVacancyAdmin, linkListing, myVacancies, rejectVacancy, replyToQuestion,
  requestInfo, resolveDuplicate, resolveVacancyAppeal, reviewSignals, saveLead, setReporterPrivacy, submitVacancy, vacancyAnalytics, vacancyPhoto, vacancyQueue, withdrawVacancy, openVacancyAppeals,
  type ReportInput, type UploadedPhoto,
} from "../../src/lib/services/vacancies";
import { approveReward, releaseDue, savePolicy, saveRewardSettings, setBudget } from "../../src/lib/services/rewards";
import { monthKey } from "../../src/lib/reward-rules";
import { newCompany, newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const png = (seed: number): UploadedPhoto => ({ name: `p${seed}.png`, mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed + 1, seed + 2]) });

async function person(label = "rep") {
  const r = await registerSeeker({ name: `${label} Reporter ${uid()}`, email: `${label}-${uid()}@example.test`, password: PASSWORD });
  return r.userId;
}
/** A report in a place that belongs to this test alone, so other tests' reports never count as its duplicates. */
function where(city: string, street = "12 Allen Avenue"): ReportInput {
  return {
    propertyType: "FLAT", purpose: "RENT", bedrooms: "2", address: street, area: "Ikeja", city, state: `State ${city}`,
    description: `A two bedroom flat with a to-let board on the gate, nobody living there (${uid()}).`, observedOn: relativeDate(-2), allowContact: false, showNameToOwner: false, understood: true,
  };
}
async function policies(adminId: string) {
  await savePolicy(adminId, { programme: "VACANCY", event: "VACANCY_VERIFIED", name: "Verified vacancy", amount: "2000", holdDays: "0" } as never);
  await savePolicy(adminId, { programme: "VACANCY", event: "VACANCY_LISTED", name: "Vacancy listed", amount: "5000", holdDays: "0" } as never);
  await setBudget(adminId, "VACANCY", monthKey(new Date()), "1000000");
}
const rewardsFor = (userId: string) => withUser(userId, (tx) => tx.reward.findMany({ where: { userId, programme: "VACANCY" }, orderBy: { createdAt: "asc" } }));
/** Take a report through every stage to the last one. */
async function walk(adminId: string, id: string, o: { lead?: boolean } = {}) {
  for (const step of ["SUBMITTED", "DUPLICATE_CHECK", "INITIAL_REVIEW", "LOCATION_VERIFICATION", "AVAILABILITY_CONFIRMATION", "OWNER_VERIFICATION"]) {
    if (step === "OWNER_VERIFICATION" && o.lead !== false) await saveLead(adminId, id, "Mr Okoro, the caretaker");
    await advanceStage(adminId, id, `Checked ${step}`);
  }
}

test("a report needs the reporter's informed confirmation, a recent sighting and valid photographs, and starts with nothing shared", async () => {
  const u = await person();
  const city = `C${uid()}`;
  await assert.rejects(submitVacancy(u, { ...where(city), understood: false }, []), /confirm you have read/);
  await assert.rejects(submitVacancy(u, { ...where(city), observedOn: relativeDate(3) }, []), /future/);
  await assert.rejects(submitVacancy(u, { ...where(city), observedOn: relativeDate(-90) }, []), /60 days/);
  await assert.rejects(submitVacancy(u, { ...where(city), description: "too short" }, []), /at least a sentence/);
  await assert.rejects(submitVacancy(u, { ...where(city), latitude: "6.5" }, []), /both the latitude/);
  await assert.rejects(submitVacancy(u, where(city), [png(1), png(2), png(3), png(4)]), /up to 3/);
  await assert.rejects(submitVacancy(u, where(city), [{ name: "x.pdf", mimeType: "application/pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]) }]), /images/);
  await assert.rejects(submitVacancy(u, where(city), [{ name: "x.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3, 4, 5]) }]), /do not match/);
  const r = await submitVacancy(u, where(city), [png(10)]);
  assert.equal(r.allowContact, false);
  assert.equal(r.showNameToOwner, false);
  assert.equal(r.stage, "SUBMITTED");
  assert.equal(r.outcome, "OPEN");
  const mine = await getMyVacancy(u, r.id);
  assert.equal(mine?.files.length, 1);
  assert.equal(mine?.ownerSees, "A member of the community");
  assert.match(mine!.status, /received/i);
  assert.equal((await myVacancies(u)).items.length, 1);
});

test("nobody but the reporter and the review team can read a report, its photographs or its history", async () => {
  const [u, other] = [await person(), await person("nosy")];
  const admin = await newPlatformAdmin();
  const r = await submitVacancy(u, where(`C${uid()}`), [png(20)]);
  assert.equal(await getMyVacancy(other, r.id), null);
  assert.equal((await myVacancies(other)).items.length, 0);
  assert.equal((await withUser(other, (tx) => tx.vacancyReport.findMany())).length, 0, "the database refuses too");
  assert.equal((await withUser(other, (tx) => tx.vacancyFile.findMany())).length, 0);
  const file = (await getMyVacancy(u, r.id))!.files[0];
  assert.ok(await vacancyPhoto(u, file.id), "the reporter sees their photograph");
  assert.ok(await vacancyPhoto(admin.id, file.id), "the review team sees it");
  assert.equal(await vacancyPhoto(other, file.id), null, "a stranger does not");
  const co = await newCompany("owner");
  assert.equal((await withUser(co.userId, (tx) => tx.vacancyReport.findMany())).length, 0, "an owner or company cannot browse reports");
  await assert.rejects(getVacancyAdmin(u, r.id), /Only the platform administrator/);
  await assert.rejects(vacancyQueue(u), /Only the platform administrator/);
  await assert.rejects(withUser(u, (tx) => tx.vacancyReport.update({ where: { id: r.id }, data: { outcome: "APPROVED", stage: "REWARD_REVIEW", closedAt: new Date() } })), "a reporter cannot approve their own report");
});

test("the reporter decides whether to be contacted and whether the owner may be told their name", async () => {
  const u = await person();
  const admin = await newPlatformAdmin();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  let view = (await getVacancyAdmin(admin.id, r.id))!;
  assert.equal(view.reporter.email, null, "no email is shown without permission");
  assert.equal(view.ownerSees, "A member of the community");
  await setReporterPrivacy(u, r.id, { allowContact: true, showNameToOwner: true });
  view = (await getVacancyAdmin(admin.id, r.id))!;
  assert.ok(view.reporter.email?.includes("@"), "shown once the reporter allows it");
  assert.match(view.ownerSees, /Reporter/);
  await setReporterPrivacy(u, r.id, { allowContact: false, showNameToOwner: false });
  assert.equal((await getVacancyAdmin(admin.id, r.id))!.reporter.email, null, "and hidden again when they change their mind");
  const other = await person();
  await assert.rejects(setReporterPrivacy(other, r.id, { allowContact: true, showNameToOwner: true }), /not found/i);
});

test("the same person cannot report the same place twice; two people reporting it are linked, and the earliest is the default owner", async () => {
  const [a, b] = [await person(), await person()];
  const admin = await newPlatformAdmin();
  const city = `C${uid()}`;
  const first = await submitVacancy(a, where(city, "12 Allen Avenue"), []);
  await assert.rejects(submitVacancy(a, where(city, "No. 12, Allen Ave."), []), /already reported this place/);
  const second = await submitVacancy(b, where(city, "12 Allen Ave"), []);
  assert.equal(second.duplicateOfId, first.id);
  assert.equal(second.clusterId, first.clusterId);
  const view = (await getVacancyAdmin(admin.id, second.id))!;
  assert.equal(view.cluster.length, 1);
  // A third report by coordinates alone, written differently, joins the same cluster.
  const near = await submitVacancy(await person(), { ...where(city, "Opposite the old bank"), latitude: "6.6018", longitude: "3.3515" }, []);
  const near2 = await submitVacancy(await person(), { ...where(city, "Beside the filling station"), latitude: "6.60185", longitude: "3.35152" }, []);
  assert.equal(near2.duplicateOfId, near.id);
  assert.notEqual(near.clusterId, first.clusterId, "a different place is not pulled in");
  // A different kind of property at the same spot is not a duplicate.
  const shop = await submitVacancy(await person(), { ...where(city, "Beside the filling station 2"), propertyType: "SHOP", latitude: "6.60185", longitude: "3.35152" }, []);
  assert.equal(shop.duplicateOfId, null);
  // The reporter can report again after withdrawing.
  await withdrawVacancy(a, first.id);
  const again = await submitVacancy(a, where(city, "12 Allen Avenue"), []);
  assert.ok(again.duplicateOfId, "now a duplicate of the other reporter's open report");
});

test("a duplicate must be decided before it moves on; merging, clearing and overriding are each recorded", async () => {
  const admin = await newPlatformAdmin();
  await policies(admin.id);
  const city = `C${uid()}`;
  const [a, b, c] = [await person(), await person(), await person()];
  const first = await submitVacancy(a, where(city), []);
  const second = await submitVacancy(b, where(city), []);
  const third = await submitVacancy(c, where(city), []);
  await advanceStage(admin.id, second.id);
  await assert.rejects(advanceStage(admin.id, second.id), /duplicate/i, "undecided duplicate stops at the duplicate check");
  await assert.rejects(resolveDuplicate(admin.id, first.id, "merge", "nothing to decide"), /no duplicate/);
  await assert.rejects(resolveDuplicate(admin.id, second.id, "merge", "no"), /reason|least 5/i);
  await resolveDuplicate(admin.id, second.id, "merge", "Same house, reported later");
  const merged = (await getMyVacancy(b, second.id))!;
  assert.equal(merged.outcome, "MERGED");
  assert.match(merged.status, /earlier/);
  assert.equal((await rewardsFor(b)).length, 0);
  // Not a duplicate: it becomes its own report.
  await resolveDuplicate(admin.id, third.id, "not_duplicate", "Next door, different house number");
  const t = (await getVacancyAdmin(admin.id, third.id))!;
  assert.equal(t.duplicateOfId, null);
  assert.equal(t.clusterId, third.id);
  // Override: a later, better report takes the place of an earlier open one.
  const city2 = `C${uid()}`;
  const early = await submitVacancy(await person(), where(city2), []);
  const lateReporter = await person();
  const late = await submitVacancy(lateReporter, where(city2), []);
  await resolveDuplicate(admin.id, late.id, "prefer_this", "The later report has the verifiable photographs and the owner's name");
  assert.equal((await getVacancyAdmin(admin.id, early.id))!.outcome, "MERGED");
  assert.equal((await getVacancyAdmin(admin.id, late.id))!.duplicateOfId, null);
  const logs = await withPlatformAdmin(admin.id, (tx) => tx.activityLog.findMany({ where: { action: "vacancy.ownership_override", entityId: late.id } }));
  assert.equal(logs.length, 1, "an override leaves an audit entry");
});

test("only one report per property earns the verification reward, and a report is approved only at the last stage", async () => {
  const admin = await newPlatformAdmin();
  await policies(admin.id);
  const city = `C${uid()}`;
  const [a, b] = [await person(), await person()];
  const first = await submitVacancy(a, where(city), []);
  const second = await submitVacancy(b, where(city), []);
  await resolveDuplicate(admin.id, second.id, "not_duplicate", "Different flat in the same block");
  // Not_duplicate gives it its own cluster; to test the guard use two reports in one cluster by overriding instead.
  await assert.rejects(approveVacancy(admin.id, first.id), /last stage/);
  await walk(admin.id, first.id);
  const r = await approveVacancy(admin.id, first.id, "Verified on site");
  assert.equal(r.status, "ELIGIBLE");
  assert.equal(r.amountKobo, 200000n);
  assert.equal((await rewardsFor(a)).length, 1);
  await assert.rejects(approveVacancy(admin.id, first.id), /open report/, "approving twice");
  assert.equal((await getMyVacancy(a, first.id))!.outcome, "APPROVED");
  // A cluster that already has an approved report refuses a second approval.
  const city2 = `C${uid()}`;
  const x = await submitVacancy(await person(), where(city2), []);
  const y = await submitVacancy(await person(), where(city2), []);
  await withPlatformAdmin(admin.id, (tx) => tx.vacancyReport.update({ where: { id: y.id }, data: { duplicateOfId: null } }));
  await walk(admin.id, x.id); await approveVacancy(admin.id, x.id);
  await walk(admin.id, y.id);
  await assert.rejects(approveVacancy(admin.id, y.id), /already verified from report/);
});

test("the workflow only moves forward, one stage at a time, and each stage's own condition is checked", async () => {
  const admin = await newPlatformAdmin();
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  const stage = async () => (await getVacancyAdmin(admin.id, r.id))!.stage;
  assert.equal(await stage(), "SUBMITTED");
  await advanceStage(admin.id, r.id);
  await advanceStage(admin.id, r.id);
  await advanceStage(admin.id, r.id);
  await advanceStage(admin.id, r.id);
  assert.equal(await stage(), "AVAILABILITY_CONFIRMATION");
  await advanceStage(admin.id, r.id);
  assert.equal(await stage(), "OWNER_VERIFICATION");
  await assert.rejects(advanceStage(admin.id, r.id), /who you contacted/);
  await saveLead(admin.id, r.id, "Mrs Adeyemi, the landlady");
  await declineLead(admin.id, r.id, "She says it is not for rent");
  await assert.rejects(advanceStage(admin.id, r.id), /declined/);
  await saveLead(admin.id, r.id, "Mr Adeyemi, her son");
  await advanceStage(admin.id, r.id);
  assert.equal(await stage(), "REWARD_REVIEW");
  await assert.rejects(advanceStage(admin.id, r.id), /last stage/);
  // The reporter sees where it stands in plain words.
  assert.match((await getMyVacancy(u, r.id))!.status, /reviewing the reward/);
  const note = await withUser(u, (tx) => tx.notification.findMany({ where: { userId: u } }));
  assert.ok(note.some((n) => n.title.includes("moved on")));
});

test("a report that is not verified earns nothing, can be sent back with a question, and can be withdrawn", async () => {
  const admin = await newPlatformAdmin();
  await policies(admin.id);
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  await assert.rejects(requestInfo(admin.id, r.id, "?"), /clear question/);
  await requestInfo(admin.id, r.id, "Which side of the road is the gate?");
  const waiting = (await getMyVacancy(u, r.id))!;
  assert.equal(waiting.outcome, "NEEDS_INFO");
  assert.match(waiting.status, /Which side of the road/);
  await assert.rejects(advanceStage(admin.id, r.id), /closed or waiting/);
  await assert.rejects(replyToQuestion(await person(), r.id, "I am not the reporter"), /not found/i);
  await replyToQuestion(u, r.id, "The left side, with the green gate");
  assert.equal((await getMyVacancy(u, r.id))!.outcome, "OPEN");
  await assert.rejects(replyToQuestion(u, r.id, "again"), /not waiting/);
  await rejectVacancy(admin.id, r.id, "We could not find the green gate");
  assert.equal((await rewardsFor(u)).length, 0, "a rejected report earns nothing");
  await assert.rejects(approveVacancy(admin.id, r.id), /open report/);
  await assert.rejects(withdrawVacancy(u, r.id), /still being reviewed/);
  const r2 = await submitVacancy(u, where(`C${uid()}`), []);
  await withdrawVacancy(u, r2.id);
  assert.equal((await getMyVacancy(u, r2.id))!.outcome, "WITHDRAWN");
});

test("verifying a report publishes nothing; owner permission is recorded separately, and only a live listing earns the second reward", async () => {
  const admin = await newPlatformAdmin();
  const approver = await newPlatformAdmin();
  await policies(admin.id);
  const u = await person();
  const listingsBefore = await withPlatformAdmin(admin.id, (tx) => tx.listing.count());
  const r = await submitVacancy(u, where(`C${uid()}`), [png(30)]);
  await walk(admin.id, r.id);
  await approveVacancy(admin.id, r.id);
  assert.equal(await withPlatformAdmin(admin.id, (tx) => tx.listing.count()), listingsBefore, "no listing was made or published");
  await assert.rejects(linkListing(admin.id, r.id, "ANY-REF"), /permission/);
  await assert.rejects(authoriseLead(admin.id, r.id, "x"), /least 5|permission/i);
  await authoriseLead(admin.id, r.id, "Owner agreed by phone on 15 October, confirmed by email");
  await assert.rejects(authoriseLead(admin.id, r.id, "Owner agreed again by phone"), /already recorded/);
  assert.equal((await rewardsFor(u)).length, 1, "permission alone pays nothing more");

  // The company that was given permission lists the property in the usual way.
  const co = await newCompany("lister");
  const asset = await createAsset(co, { name: "Allen flat", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: "Allen flat in Ikeja", purpose: "RENT", price: "2,000,000", bedrooms: "2", city: "Ikeja", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const listing = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await linkListing(admin.id, r.id, listing.publicRef);
  assert.equal((await rewardsFor(u)).length, 1, "a listing waiting for review does not pay");
  await reviewListing(admin.id, listing.id, "approve", "ok");
  const rs = await rewardsFor(u);
  assert.equal(rs.length, 2);
  assert.equal(rs[1].event, "VACANCY_LISTED");
  assert.equal(rs[1].status, "ELIGIBLE");
  assert.equal(rs[1].amountKobo, 500000n);
  // The listing is cancelled before the reward is released: it is cancelled too.
  await approveReward(approver.id, rs[1].id);
  await withPlatformAdmin(admin.id, (tx) => tx.listing.update({ where: { id: listing.id }, data: { status: "UNAVAILABLE" } }));
  await releaseDue(new Date(Date.now() + 1000));
  const after = (await rewardsFor(u))[1];
  assert.equal(after.status, "CANCELLED");
  assert.match(after.reason, /no longer published/);
});

test("when the owner withdraws permission the pending listing reward is cancelled", async () => {
  const admin = await newPlatformAdmin();
  const approver = await newPlatformAdmin();
  await policies(admin.id);
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  await walk(admin.id, r.id);
  await approveVacancy(admin.id, r.id);
  await authoriseLead(admin.id, r.id, "Agreed in writing by the owner");
  const co = await newCompany("lister2");
  const asset = await createAsset(co, { name: "Second flat", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: "Second flat in Ikeja", purpose: "RENT", price: "1,500,000", bedrooms: "2", city: "Ikeja", state: "Lagos" } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const listing = await withPlatformAdmin(admin.id, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  await reviewListing(admin.id, listing.id, "approve", "ok");
  await linkListing(admin.id, r.id, listing.publicRef);
  const listed = (await rewardsFor(u)).find((x) => x.event === "VACANCY_LISTED")!;
  assert.equal(listed.status, "ELIGIBLE");
  await approveReward(approver.id, listed.id);
  await declineLead(admin.id, r.id, "The owner has changed their mind");
  assert.equal((await rewardsFor(u)).find((x) => x.event === "VACANCY_LISTED")!.status, "CANCELLED");
});

test("a transaction reward is recorded only when a person confirms it, and with no reward set up it is not eligible", async () => {
  const admin = await newPlatformAdmin();
  await policies(admin.id);
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  await assert.rejects(attestTransaction(admin.id, r.id, "It was let last week"), /approved report/);
  await walk(admin.id, r.id);
  await approveVacancy(admin.id, r.id);
  const t = await attestTransaction(admin.id, r.id, "Tenancy agreement seen");
  assert.equal(t.status, "NOT_ELIGIBLE");
  assert.match(t.reason, /No reward is set up/);
  const again = await attestTransaction(admin.id, r.id, "Seen again");
  assert.equal(again.id, t.id, "one claim per event");
});

test("copied photographs, repeated text, rapid-fire reports, repeat rejections and positions outside Nigeria go to a person, who decides", async () => {
  const admin = await newPlatformAdmin();
  await policies(admin.id);
  await saveRewardSettings(admin.id, { payoutThreshold: "5000", referralBurstPerDay: "10", vacancyReportsPerDay: "3", vacancyRejectFlag: "2", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  const [a, b] = [await person(), await person()];
  const original = await submitVacancy(a, where(`C${uid()}`), [png(40)]);
  assert.equal(original.flagged, false);
  // Someone else uploads the same photograph for a different place.
  const copy = await submitVacancy(b, where(`C${uid()}`), [png(40)]);
  assert.match(copy.signals, /SAME_PHOTO/);
  assert.equal(copy.flagged, true);
  const view = (await getVacancyAdmin(admin.id, copy.id))!;
  assert.ok(view.reusedIn.includes(original.ref));
  assert.ok(view.signalText.some((t) => /photograph/.test(t)));
  // Held until a person looks: it will not advance or be approved.
  await advanceStage(admin.id, copy.id); await advanceStage(admin.id, copy.id);
  await assert.rejects(advanceStage(admin.id, copy.id), /warning signs/);
  await assert.rejects(reviewSignals(admin.id, copy.id, "clear", "ok"), /least 5|Write what/i);
  await reviewSignals(admin.id, copy.id, "clear", "Both people photographed the same shared gate, with the owner's agreement");
  await advanceStage(admin.id, copy.id);
  await assert.rejects(reviewSignals(admin.id, copy.id, "clear", "again please"), /no warning signs/);
  // Same words.
  const text = `Identical description of an empty flat with a green gate ${uid()}`;
  await submitVacancy(a, { ...where(`C${uid()}`), description: text }, []);
  const same = await submitVacancy(b, { ...where(`C${uid()}`), description: text }, []);
  assert.match(same.signals, /SAME_TEXT/);
  // Outside Nigeria.
  const abroad = await submitVacancy(await person(), { ...where(`C${uid()}`), latitude: "51.5", longitude: "-0.12" }, []);
  assert.match(abroad.signals, /OUTSIDE_COVERAGE/);
  const confirmed = await reviewSignals(admin.id, abroad.id, "confirm", "The position is in London and the street does not exist");
  void confirmed;
  assert.equal((await getVacancyAdmin(admin.id, abroad.id))!.outcome, "REJECTED");
  // A burst of reports in a day (limit set to 3), and repeat rejections.
  const spammer = await person();
  const made: string[] = [];
  for (let i = 0; i < 3; i++) made.push((await submitVacancy(spammer, where(`C${uid()}`), [])).id);
  const fourth = await submitVacancy(spammer, where(`C${uid()}`), []);
  assert.match(fourth.signals, /REPORT_BURST/);
  await rejectVacancy(admin.id, made[0], "No such property"); await rejectVacancy(admin.id, made[1], "No such property");
  const fifth = await submitVacancy(spammer, where(`C${uid()}`), []);
  assert.match(fifth.signals, /REPEAT_REJECTIONS/);
  assert.equal((await vacancyQueue(admin.id, { flagged: true })).flagged >= 3, true);
  await saveRewardSettings(admin.id, { payoutThreshold: "5000", referralBurstPerDay: "10", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
});

test("a rejected report can be appealed once, an administrator decides, and an upheld appeal reopens the review", async () => {
  const admin = await newPlatformAdmin();
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  await assert.rejects(appealVacancy(u, r.id, "I was right about this flat"), /not accepted/);
  await rejectVacancy(admin.id, r.id, "We could not find it");
  const stranger = await person();
  await assert.rejects(appealVacancy(stranger, r.id, "Not my report but I will try"), /not found/i);
  await assert.rejects(appealVacancy(u, r.id, "short"), /sentence/);
  const d = await appealVacancy(u, r.id, "The gate is round the back, on the side street");
  await assert.rejects(appealVacancy(u, r.id, "Trying a second time over"), /already been appealed/);
  assert.equal((await openVacancyAppeals(admin.id)).some((x) => x.id === d.id), true);
  await resolveVacancyAppeal(admin.id, d.id, "uphold", "The side-street entrance explains it");
  await assert.rejects(resolveVacancyAppeal(admin.id, d.id, "deny", "again please"), /already decided/);
  const reopened = (await getMyVacancy(u, r.id))!;
  assert.equal(reopened.outcome, "OPEN");
  assert.equal(reopened.stage, "INITIAL_REVIEW");
  assert.equal(reopened.dispute?.status, "UPHELD");
  // A denied appeal stands.
  const r2 = await submitVacancy(u, where(`C${uid()}`), []);
  await rejectVacancy(admin.id, r2.id, "Photographs are of a different building");
  const d2 = await appealVacancy(u, r2.id, "They are the same building from another side");
  await resolveVacancyAppeal(admin.id, d2.id, "deny", "The buildings are different");
  const kept = (await getMyVacancy(u, r2.id))!;
  assert.equal(kept.outcome, "REJECTED");
  assert.equal(kept.dispute?.status, "DENIED");
});

test("aggregate figures never single out a reporter: areas with fewer than three reports are not broken out", async () => {
  const admin = await newPlatformAdmin();
  const city = `Agg${uid()}`;
  for (let i = 0; i < 2; i++) await submitVacancy(await person(), { ...where(city, `${i + 1} Quiet Close`), area: "Quietville" }, []);
  let a = await vacancyAnalytics(admin.id);
  assert.equal(a.areas.some((x) => x.city === city), false, "two reports are not shown");
  assert.ok(a.small >= 2);
  await submitVacancy(await person(), { ...where(city, "9 Quiet Close"), area: "Quietville" }, []);
  a = await vacancyAnalytics(admin.id);
  const row = a.areas.find((x) => x.city === city);
  assert.equal(row?.count, "3");
  const text = JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(text.includes("Reporter"), false, "no reporter names in the analytics");
  assert.equal(text.includes("@example.test"), false);
});

test("a rejected report cannot be approved by editing the database as a reporter, and the history cannot be rewritten", async () => {
  const admin = await newPlatformAdmin();
  const u = await person();
  const r = await submitVacancy(u, where(`C${uid()}`), []);
  await assert.rejects(withUser(u, (tx) => tx.vacancyEvent.create({ data: { reportId: r.id, actorName: "Me", note: "forged" } })));
  await rejectVacancy(admin.id, r.id, "Not real");
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.vacancyEvent.updateMany({ data: { note: "rewritten" } })));
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.vacancyReport.update({ where: { id: r.id }, data: { outcome: "APPROVED", stage: "SUBMITTED" } })), "the database refuses an approval before the last stage");
});
