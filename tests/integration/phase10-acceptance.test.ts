/**
 * Phase 10 acceptance: a person can refer an eligible participant or report a vacancy, follow its status, and receive a reward
 * only when the configured qualifying conditions have been satisfied.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { registerSeeker } from "../../src/lib/services/community";
import { captureReferral, createCampaign, getOrCreateCode, myReferrals } from "../../src/lib/services/referrals";
import { approveReward, createPayout, myRewards, releaseDue, reconcile, savePolicy, saveRewardSettings, setBudget, verifyPayout } from "../../src/lib/services/rewards";
import { advanceStage, approveVacancy, getMyVacancy, saveLead, submitVacancy } from "../../src/lib/services/vacancies";
import { monthKey } from "../../src/lib/reward-rules";
import { newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);

test("a referral and a vacancy report each pay only when their conditions are met, through to a verified payment", async () => {
  const [a, b] = [await newPlatformAdmin(), await newPlatformAdmin()];
  await saveRewardSettings(a.id, { payoutThreshold: "0", referralBurstPerDay: "10", vacancyReportsPerDay: "5", vacancyRejectFlag: "3", duplicateRadiusM: "50", duplicateWindowDays: "365" });
  await setBudget(a.id, "REFERRAL", monthKey(new Date()), "1000000");
  await setBudget(a.id, "VACANCY", monthKey(new Date()), "1000000");
  await withPlatformAdmin(a.id, (tx) => tx.referralCampaign.updateMany({ data: { active: false } }));
  const c = await createCampaign(a.id, { name: `Accept ${uid()}`, audience: "SEEKER", event: "REFERRAL_REGISTERED", startsOn: relativeDate(-1), attributionDays: "30", qualifyWithinDays: "60" } as never);
  await savePolicy(a.id, { programme: "REFERRAL", event: "REFERRAL_REGISTERED", campaignId: c.id, name: "Friend", amount: "1000", holdDays: "0" } as never);
  await savePolicy(a.id, { programme: "VACANCY", event: "VACANCY_VERIFIED", name: "Vacancy", amount: "2000", holdDays: "0" } as never);

  const person = (await registerSeeker({ name: `Ada ${uid()} Earner`, email: `ada-${uid()}@example.test`, password: PASSWORD })).userId;
  await prisma.user.update({ where: { id: person }, data: { createdAt: new Date(Date.now() - 5 * 864e5) } });

  // Referral: no reward without a sign-up through the link.
  const code = (await getOrCreateCode(person)).code;
  assert.equal((await myRewards(person)).items.length, 0);
  const friendEmail = `friend-${uid()}@example.test`;
  const friend = await registerSeeker({ name: "Bola Friend", email: friendEmail, password: PASSWORD });
  await captureReferral({ id: friend.userId, name: "Bola Friend", email: friendEmail }, "SEEKER", { code, at: Date.now() });
  assert.equal((await myReferrals(person)).counts.QUALIFIED, 1);

  // Vacancy: no reward until it is verified.
  const v = await submitVacancy(person, { propertyType: "FLAT", purpose: "RENT", address: "5 Acceptance Road", area: "Yaba", city: `Acc${uid()}`, state: "Lagos", description: "An empty two bedroom flat with a to-let board on the gate.", observedOn: relativeDate(-1), understood: true } as never, []);
  assert.equal((await myRewards(person)).items.filter((r) => r.programme === "VACANCY").length, 0);
  for (let i = 0; i < 6; i++) { if (i === 5) await saveLead(a.id, v.id, "The caretaker"); await advanceStage(a.id, v.id); }
  await approveVacancy(a.id, v.id);
  assert.equal((await getMyVacancy(person, v.id))!.outcome, "APPROVED");

  // Both rewards wait for a person, then for the safety period, then for a payment verified by a second administrator.
  const rewards = (await myRewards(person)).items;
  assert.equal(rewards.length, 2);
  assert.ok(rewards.every((r) => r.status === "ELIGIBLE"));
  for (const r of rewards) await approveReward(b.id, r.id);
  await releaseDue(new Date(Date.now() + 1000));
  const p = await createPayout(a.id, person);
  assert.equal(p.amountKobo, 300000n);
  await assert.rejects(verifyPayout(a.id, p.id, "NIP-1234"), /different administrator/);
  await verifyPayout(b.id, p.id, "NIP-ACCEPT-1");
  const done = await myRewards(person);
  assert.ok(done.items.every((r) => r.status === "PAID"));
  assert.equal(done.by.PAID.kobo, 300000n);
  assert.equal((await reconcile(a.id)).findings.filter((f) => f.code === "PAID_WITHOUT_PAYMENT").length, 0);
  assert.equal((await withUser(friend.userId, (tx) => tx.reward.findMany())).length, 0, "the friend sees no one's rewards");
});
