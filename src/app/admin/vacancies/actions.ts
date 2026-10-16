"use server";

import { requirePlatformAdmin } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  advanceStage, approveVacancy, attestTransaction, authoriseLead, declineLead, linkListing, rejectVacancy, requestInfo, resolveDuplicate, resolveVacancyAppeal, reviewSignals, saveLead,
} from "@/lib/services/vacancies";

const run = (id: string, notice: string, fn: (adminId: string) => Promise<unknown>) => {
  const to = id ? `/admin/vacancies/${id}` : "/admin/vacancies";
  return act(to, async () => { const a = await requirePlatformAdmin(); await fn(a.id); return withNotice(to, notice); });
};
export const advanceAction = async (f: FormData) => run(str(f, "id"), "Moved to the next stage.", (a) => advanceStage(a, str(f, "id"), optStr(f, "note") ?? ""));
export const askAction = async (f: FormData) => run(str(f, "id"), "Question sent to the reporter.", (a) => requestInfo(a, str(f, "id"), str(f, "question")));
export const rejectAction = async (f: FormData) => run(str(f, "id"), "Report rejected.", (a) => rejectVacancy(a, str(f, "id"), str(f, "reason")));
export const approveAction = async (f: FormData) => run(str(f, "id"), "Report verified. A reward was opened for the reporter.", (a) => approveVacancy(a, str(f, "id"), optStr(f, "note") ?? ""));
export const signalsAction = async (f: FormData) => run(str(f, "id"), "Decision recorded.", (a) => reviewSignals(a, str(f, "id"), str(f, "decision") === "confirm" ? "confirm" : "clear", str(f, "note")));
export const duplicateAction = async (f: FormData) => run(str(f, "id"), "Duplicate decided.", (a) => resolveDuplicate(a, str(f, "id"), (["merge", "prefer_this"].includes(str(f, "decision")) ? str(f, "decision") : "not_duplicate") as "merge", str(f, "note")));
export const leadAction = async (f: FormData) => run(str(f, "id"), "Contact recorded.", (a) => saveLead(a, str(f, "id"), str(f, "contactName")));
export const authoriseAction = async (f: FormData) => run(str(f, "id"), "Permission recorded.", (a) => authoriseLead(a, str(f, "id"), str(f, "note")));
export const declineAction = async (f: FormData) => run(str(f, "id"), "Decline recorded.", (a) => declineLead(a, str(f, "id"), str(f, "reason")));
export const linkAction = async (f: FormData) => run(str(f, "id"), "Listing linked.", (a) => linkListing(a, str(f, "id"), str(f, "listing")));
export const transactionAction = async (f: FormData) => run(str(f, "id"), "Transaction recorded.", (a) => attestTransaction(a, str(f, "id"), str(f, "note")));
export const appealDecisionAction = async (f: FormData) => run("", "Appeal decided.", (a) => resolveVacancyAppeal(a, str(f, "disputeId"), str(f, "decision") === "uphold" ? "uphold" : "deny", str(f, "resolution")));
