"use server";

import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import {
  addEvidence, answerOffer, assignStaff, completeInspection, moveProviderCase, providerCaseContext, reviewerDecision, saveReportDraft,
  scheduleInspection, submitForInternalReview,
} from "@/lib/services/verification-cases";
import type { VpCtx } from "@/lib/services/verification-network";

const casePage = (ref: string) => `/provider/cases/${encodeURIComponent(ref)}`;
function run(form: FormData, fn: (ctx: VpCtx, ref: string) => Promise<unknown>, done: string, after?: (ctx: VpCtx) => string) {
  const ref = str(form, "ref");
  return act(casePage(ref), async () => {
    const user = await requireUser();
    const ctx = await providerCaseContext(user.id, ref);
    if (!ctx) notFound();
    await fn(ctx, ref);
    return withNotice(after ? after(ctx) : casePage(ref), done);
  });
}

export async function answerOfferAction(form: FormData) {
  const accept = str(form, "decision") === "accept";
  const conflict = str(form, "decision") === "conflict";
  return run(form, (ctx, ref) => answerOffer(ctx, ref, accept, str(form, "reason"), conflict), accept ? "Case accepted. Choose the officer and reviewer, then start on the documents." : "Declined. Housy has been told and will offer the case elsewhere.", accept ? undefined : (ctx) => `/provider/${encodeURIComponent(ctx.code)}/cases`);
}
export async function assignStaffAction(form: FormData) {
  return run(form, (ctx, ref) => assignStaff(ctx, ref, str(form, "officerId") || null, str(form, "reviewerId") || null), "Officer and reviewer saved.");
}
export async function moveCaseAction(form: FormData) {
  return run(form, (ctx, ref) => moveProviderCase(ctx, ref, str(form, "to"), str(form, "note")), "Case updated.");
}
export async function evidenceAction(form: FormData) {
  return run(form, async (ctx, ref) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to add.");
    await addEvidence(ctx, ref, { kind: str(form, "kind") as never, basis: str(form, "basis"), title: str(form, "title"), caption: str(form, "caption"), lat: str(form, "lat") || undefined, lng: str(form, "lng") || undefined, takenAt: str(form, "takenAt") || undefined }, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, "Evidence added to the case file.");
}
export async function scheduleInspectionAction(form: FormData) {
  return run(form, (ctx, ref) => scheduleInspection(ctx, ref, str(form, "when"), str(form, "officerId") || null, str(form, "notes")), "Site visit booked.");
}
export async function completeInspectionAction(form: FormData) {
  return run(form, (ctx, ref) => completeInspection(ctx, ref, str(form, "inspectionId"), str(form, "notes")), "Site visit recorded.");
}
export async function saveReportAction(form: FormData) {
  const findings = Array.from({ length: 40 }, (_, i) => ({ basis: str(form, `f.${i}.basis`), text: str(form, `f.${i}.text`) })).filter((f) => f.text);
  const content = {
    scope: str(form, "scope"), documentsExamined: str(form, "documentsExamined"), sourcesConsulted: str(form, "sourcesConsulted"), registrySearch: str(form, "registrySearch"),
    siteInspection: str(form, "siteInspection"), findings: findings as never, risks: str(form, "risks"), limitations: str(form, "limitations"), outstanding: str(form, "outstanding"),
    observations: str(form, "observations"), recommendations: str(form, "recommendations"), conclusion: str(form, "conclusion"), outcome: str(form, "outcome") as never,
  };
  const submit = str(form, "then") === "submit";
  return run(form, async (ctx, ref) => { await saveReportDraft(ctx, ref, content); if (submit) await submitForInternalReview(ctx, ref); }, submit ? "Saved and sent to the reviewer." : "Report draft saved.");
}
export async function reviewAction(form: FormData) {
  const approve = str(form, "decision") === "approve";
  return run(form, (ctx, ref) => reviewerDecision(ctx, ref, approve, str(form, "note")), approve ? "Approved and submitted to Housy for its review." : "Sent back to the officer with your corrections.");
}
