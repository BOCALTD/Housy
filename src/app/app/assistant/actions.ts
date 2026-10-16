"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { decideSuggestion, suggestForUnsorted, summariseCorrespondence, suggestDocumentCategory } from "@/lib/services/ai-assist";

export async function sortDocumentsAction() {
  return act("/app/assistant", async () => {
    const m = await requireMember("ai.use");
    const r = await suggestForUnsorted(m);
    return withNotice("/app/assistant", r.looked === 0 ? "Every document already has a category." : `Looked at ${r.looked} unsorted documents and made ${r.made} suggestions for you to review.`);
  });
}

export async function suggestOneAction(form: FormData) {
  const back = str(form, "back") || "/app/assistant";
  return act(back.startsWith("/app/") ? back : "/app/assistant", async () => {
    const m = await requireMember("ai.use");
    const r = await suggestDocumentCategory(m, str(form, "documentId"));
    return withNotice("/app/assistant", r.suggestion ? "A category was suggested. Review it below." : `No change suggested. ${r.reason}`);
  });
}

export async function summariseAction(form: FormData) {
  const id = str(form, "correspondenceId");
  return act(`/app/correspondence/${encodeURIComponent(id)}`, async () => {
    const m = await requireMember("ai.use");
    await summariseCorrespondence(m, id);
    return withNotice("/app/assistant", "A summary was prepared. Review it before relying on it.");
  });
}

export async function decideAction(form: FormData) {
  return act("/app/assistant", async () => {
    const m = await requireMember("ai.review");
    await decideSuggestion(m, str(form, "id"), str(form, "decision") === "accept" ? "accept" : "reject", str(form, "note"));
    return withNotice("/app/assistant", str(form, "decision") === "accept" ? "Accepted." : "Set aside.");
  });
}
