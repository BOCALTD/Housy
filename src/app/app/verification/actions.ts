"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { requirement } from "@/lib/kyc-rules";
import { submitCompanyKyc } from "@/lib/services/kyc";

export async function submitCompanyKycAction(form: FormData) {
  return act("/app/verification", async () => {
    const member = await requireMember("kyc.manage");
    const code = str(form, "code");
    const req = requirement(code);
    if (!req || req.kind !== "COMPANY") throw new Error("Unknown check");
    if (str(form, "confirm") !== "yes") throw new Error("Tick the box to confirm the information is genuine");
    const input = Object.fromEntries(req.fields.map((f) => [f.key, str(form, f.key)]));
    const file = form.get("doc");
    const doc = file instanceof File && file.size > 0 ? { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null;
    await submitCompanyKyc(member, code, input, doc);
    return withNotice("/app/verification", `${req.title} sent for review.`);
  });
}
