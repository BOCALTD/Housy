"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { applyIndustryTemplate } from "@/lib/services/industry-setup";
import { templateFor } from "@/lib/industry-templates";

export async function applyTemplateAction(form: FormData) {
  const key = str(form, "template");
  return act(`/app/setup?t=${encodeURIComponent(key)}`, async () => {
    const member = await requireMember("settings.manage");
    const t = templateFor(key);
    if (!t) throw new Error("Choose a kind of business");
    const all = (name: string) => form.getAll(name).map(String);
    const obligations = Object.fromEntries(all("obligation").map((id) => [id, str(form, `due-${id}`)]));
    const commission = Object.fromEntries(all("rule").map((id) => [id, str(form, `rate-${id}`)]));
    const r = await applyIndustryTemplate(member, key, { departments: all("department"), checklists: all("checklist"), obligations, commission, reminders: str(form, "reminders") === "yes" });
    const parts = [r.departments && `${r.departments} departments`, r.checklists && `${r.checklists} inspection checklists`, r.obligations && `${r.obligations} reminders`, r.rules && `${r.rules} commission rules`, r.reminders && "reminder timings"].filter(Boolean);
    return withNotice("/app", parts.length ? `Set up as ${t.name.toLowerCase()}: added ${parts.join(", ")}.` : `Set up as ${t.name.toLowerCase()}. Everything you ticked was already there.`);
  });
}
