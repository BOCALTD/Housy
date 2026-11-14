"use server";

import { getMember } from "@/lib/auth";
import { act, withNotice } from "@/lib/forms";
import { resumeWorkspace } from "@/lib/services/workspace-lifecycle";

export async function resumeWorkspaceAction() {
  return act("/suspended", async () => {
    // getMember works while the workspace is closed (requireMember would send them back here).
    const m = await getMember();
    if (!m) return "/app/switch";
    await resumeWorkspace(m);
    return withNotice("/app", "Welcome back. The workspace is open again.");
  });
}
