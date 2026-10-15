"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  assessPeriod, createServicePeriod, decideExpense, recordCollection, requestExpense, reverseCollection,
} from "@/lib/services/service-charges";

const periodPath = (id: string) => `/app/service-charges/${encodeURIComponent(id)}`;

export async function createServicePeriodAction(form: FormData) {
  return act("/app/service-charges", async () => {
    const member = await requireMember("service.manage");
    const period = await createServicePeriod(member, str(form, "assetId"), {
      name: str(form, "name"), startDate: str(form, "startDate"), endDate: str(form, "endDate"),
      budget: str(form, "budget"), method: str(form, "method") as never,
    });
    return withNotice(periodPath(period.id), "Service charge period created. Share it between the tenants when the budget is final.");
  });
}

export async function assessPeriodAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("service.manage");
    const fixed: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("fixed:") && typeof value === "string") fixed[key.slice("fixed:".length)] = value;
    }
    await assessPeriod(member, id, { dueDate: str(form, "dueDate"), fixed });
    return withNotice(periodPath(id), "The charge has been shared between the tenants.");
  });
}

export async function recordCollectionAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("service.collect");
    await recordCollection(member, str(form, "assessmentId"), {
      amount: str(form, "amount"), paidOn: str(form, "paidOn"), evidence: str(form, "evidence"), method: str(form, "method"),
    });
    return withNotice(periodPath(id), "Payment recorded.");
  });
}

export async function reverseCollectionAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("payment.reverse");
    await reverseCollection(member, str(form, "collectionId"), str(form, "reason"));
    return withNotice(periodPath(id), "Payment reversed.");
  });
}

export async function requestExpenseAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("service.expense");
    await requestExpense(member, id, {
      description: str(form, "description"), supplier: str(form, "supplier"), amount: str(form, "amount"),
      incurredOn: str(form, "incurredOn"), evidence: str(form, "evidence"),
    });
    return withNotice(periodPath(id), "Expense submitted. It is paid from the fund when someone else approves it.");
  });
}

export async function approveExpenseAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("service.approve");
    await decideExpense(member, str(form, "expenseId"), "approve", str(form, "note"));
    return withNotice(periodPath(id), "Expense approved.");
  });
}

export async function rejectExpenseAction(form: FormData) {
  const id = str(form, "periodId");
  return act(periodPath(id), async () => {
    const member = await requireMember("service.expense");
    await decideExpense(member, str(form, "expenseId"), "reject", str(form, "note"));
    return withNotice(periodPath(id), "Expense rejected.");
  });
}
