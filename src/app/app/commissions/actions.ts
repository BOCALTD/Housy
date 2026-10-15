"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { addCommissionRule, cancelCommission, decideCommission, payCommissionSplit, proposeCommission, setCommissionRuleActive } from "@/lib/services/commission";

const file = (id: string) => `/app/deals/${encodeURIComponent(id)}/file`;

export async function addRuleAction(form: FormData) {
  return act("/app/commissions", async () => {
    await addCommissionRule(await requireMember("crm.configure"), { name: str(form, "name"), applies: (optStr(form, "applies") ?? "ALL") as never, method: str(form, "method") as never, rate: optStr(form, "rate"), fixed: optStr(form, "fixed") });
    return withNotice("/app/commissions", "Rule added.");
  });
}

export async function ruleActiveAction(form: FormData) {
  return act("/app/commissions", async () => {
    await setCommissionRuleActive(await requireMember("crm.configure"), str(form, "ruleId"), optStr(form, "active") === "yes");
    return withNotice("/app/commissions", "Saved.");
  });
}

export async function proposeAction(form: FormData) {
  const id = str(form, "dealId");
  return act(file(id), async () => {
    const splits: { membershipId: string; role: never; share: string }[] = [];
    for (let i = 1; i <= 4; i++) {
      const m = optStr(form, `person${i}`);
      if (!m) continue;
      splits.push({ membershipId: m, role: (optStr(form, `role${i}`) ?? "OTHER") as never, share: str(form, `share${i}`) });
    }
    await proposeCommission(await requireMember("crm.manage"), id, { ruleId: str(form, "ruleId"), splits });
    return withNotice(file(id), "Commission sent for approval.");
  });
}

export async function decideAction(form: FormData) {
  const id = str(form, "dealId");
  return act(file(id), async () => {
    await decideCommission(await requireMember("crm.approve"), id, optStr(form, "decision") === "approve" ? "approve" : "reject", str(form, "note"));
    return withNotice(file(id), "Decision recorded.");
  });
}

export async function cancelAction(form: FormData) {
  const id = str(form, "dealId");
  return act(file(id), async () => {
    await cancelCommission(await requireMember("crm.manage"), id, str(form, "reason"));
    return withNotice(file(id), "Commission cancelled.");
  });
}

export async function payAction(form: FormData) {
  const id = str(form, "dealId");
  return act(file(id), async () => {
    await payCommissionSplit(await requireMember("crm.approve"), str(form, "splitId"), { paidOn: str(form, "paidOn"), reference: str(form, "reference") });
    return withNotice(file(id), "Payment recorded.");
  });
}
