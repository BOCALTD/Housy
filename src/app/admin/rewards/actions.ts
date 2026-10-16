"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  approveReward, cancelReward, clearReward, createPayout, failPayout, liftRewardRestriction, rejectReward, resolveRewardDispute,
  restrictRewards, retirePolicy, savePolicy, saveRewardSettings, setBudget, verifyPayout,
} from "@/lib/services/rewards";

const back = "/admin/rewards";
const pay = "/admin/rewards/payouts";
const run = (to: string, notice: string, fn: (adminId: string) => Promise<unknown>) => act(to, async () => { const a = await requirePlatformAdmin(); await fn(a.id); return withNotice(to, notice); });

export const approveAction = async (f: FormData) => run(back, "Reward approved.", (id) => approveReward(id, str(f, "rewardId"), optStr(f, "note") ?? ""));
export const rejectAction = async (f: FormData) => run(back, "Reward rejected.", (id) => rejectReward(id, str(f, "rewardId"), str(f, "reason")));
export const clearAction = async (f: FormData) => run(back, "Reward cleared for approval.", (id) => clearReward(id, str(f, "rewardId"), str(f, "note")));
export const cancelAction = async (f: FormData) => run(back, "Reward cancelled.", (id) => cancelReward(id, str(f, "rewardId"), str(f, "reason")));
export const policyAction = async (f: FormData) => run(back, "Reward saved. The earlier version was retired and keeps applying to rewards already earned.", (id) => savePolicy(id, {
  programme: str(f, "programme") as "REFERRAL", event: str(f, "event") as "REFERRAL_REGISTERED", campaignId: optStr(f, "campaignId") ?? "", name: str(f, "name"), amount: str(f, "amount"), holdDays: str(f, "holdDays"), perPersonLimit: optStr(f, "perPersonLimit") ?? "", terms: optStr(f, "terms") ?? "",
}));
export const retireAction = async (f: FormData) => run(back, "Reward retired.", (id) => retirePolicy(id, str(f, "policyId")));
export const budgetAction = async (f: FormData) => run(back, "Budget saved.", (id) => setBudget(id, str(f, "programme") as "REFERRAL", str(f, "month"), str(f, "limit")));
export const settingsAction = async (f: FormData) => run(back, "Limits saved.", (id) => saveRewardSettings(id, {
  payoutThreshold: str(f, "payoutThreshold"), referralBurstPerDay: str(f, "referralBurstPerDay"), vacancyReportsPerDay: str(f, "vacancyReportsPerDay"), vacancyRejectFlag: str(f, "vacancyRejectFlag"), duplicateRadiusM: str(f, "duplicateRadiusM"), duplicateWindowDays: str(f, "duplicateWindowDays"),
}));
export const restrictAction = async (f: FormData) => run(back, "Rewards paused for that person.", (id) => restrictRewards(id, str(f, "userId"), str(f, "reason")));
export const liftRestrictionAction = async (f: FormData) => run(back, "Rewards restored for that person.", (id) => liftRewardRestriction(id, str(f, "userId")));
export const disputeDecisionAction = async (f: FormData) => run(back, "Dispute decided.", (id) => resolveRewardDispute(id, str(f, "disputeId"), str(f, "decision") === "uphold" ? "uphold" : "deny", str(f, "resolution")));
export const createPayoutAction = async (f: FormData) => run(pay, "Payout created. A different administrator must verify it once the money is sent.", (id) => createPayout(id, str(f, "userId"), optStr(f, "note") ?? ""));
export const verifyPayoutAction = async (f: FormData) => run(pay, "Payment verified. The rewards are marked paid.", (id) => verifyPayout(id, str(f, "payoutId"), str(f, "reference"), optStr(f, "note") ?? ""));
export const failPayoutAction = async (f: FormData) => run(pay, "Payout marked as failed. The rewards are payable again.", (id) => failPayout(id, str(f, "payoutId"), str(f, "reason")));
