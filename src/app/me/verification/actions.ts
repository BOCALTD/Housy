"use server";

import { requireUser, getSession } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { requirement } from "@/lib/kyc-rules";
import { submitAgentKyc } from "@/lib/services/kyc";

export async function submitAgentKycAction(form: FormData) {
  return act("/me/verification", async () => {
    const user = await requireUser();
    const session = await getSession();
    const companyId = str(form, "companyId") || session?.companyId || "";
    if (!companyId) throw new Error("Agent checks are for people who work for a registered company");
    const code = str(form, "code");
    const req = requirement(code);
    if (!req || req.kind !== "AGENT") throw new Error("Unknown check");
    if (str(form, "confirm") !== "yes") throw new Error("Tick the box to confirm the information is genuine");
    const input = Object.fromEntries(req.fields.map((f) => [f.key, str(form, f.key)]));
    const file = form.get("doc");
    const doc = file instanceof File && file.size > 0 ? { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null;
    await submitAgentKyc(user.id, companyId, code, input, doc, { autoConsent: str(form, "auto") === "yes" });
    return withNotice("/me/verification", `${req.title} sent. ${str(form, "auto") === "yes" ? "It is being checked automatically; if that cannot confirm it, our team will check it by hand." : "Our team will review it."}`);
  });
}
