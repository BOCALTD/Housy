"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { createPhysicalFile, issuePhysicalFile, returnPhysicalFile } from "@/lib/services/files";

export async function createFileAction(form: FormData) {
  return act("/app/files", async () => {
    const member = await requireMember("file.manage");
    const file = await createPhysicalFile(member, {
      fileNumber: str(form, "fileNumber"), title: str(form, "title"), location: str(form, "location"),
      departmentId: optStr(form, "departmentId"), assetId: optStr(form, "assetId"),
    });
    return withNotice("/app/files", `File ${file.fileNumber} added to the register.`);
  });
}

export async function issueFileAction(form: FormData) {
  return act("/app/files", async () => {
    const member = await requireMember("file.manage");
    await issuePhysicalFile(member, str(form, "fileId"), {
      holderId: str(form, "holderId"), expectedReturnOn: str(form, "expectedReturnOn"), purpose: str(form, "purpose"),
    });
    return withNotice("/app/files", "File issued.");
  });
}

export async function returnFileAction(form: FormData) {
  return act("/app/files", async () => {
    const member = await requireMember("file.manage");
    await returnPhysicalFile(member, str(form, "fileId"));
    return withNotice("/app/files", "File returned to the registry.");
  });
}
