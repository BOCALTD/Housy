"use server";

import { requireMember } from "@/lib/auth";
import { act, str, withNotice } from "@/lib/forms";
import { IMPORT_KINDS, MAX_IMPORT_BYTES, type ImportKindName } from "@/lib/import-rules";
import { commitImport, discardImport, previewImport } from "@/lib/services/imports";

export async function previewImportAction(form: FormData) {
  return act("/app/import", async () => {
    const member = await requireMember("import.manage");
    const kind = str(form, "kind") as ImportKindName;
    if (!(IMPORT_KINDS as readonly string[]).includes(kind)) throw new Error("Choose what you are importing");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file to upload");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is larger than 2 MB. Split it into smaller files.");
    const { id } = await previewImport(member, kind, file.name, await file.text());
    return withNotice(`/app/import/${id}`, "Check the preview below. Nothing has been created yet.");
  });
}

export async function commitImportAction(form: FormData) {
  const id = str(form, "batchId");
  return act(`/app/import/${encodeURIComponent(id)}`, async () => {
    const member = await requireMember("import.manage");
    if (str(form, "confirm") !== "yes") throw new Error("Tick the box to confirm");
    const r = await commitImport(member, id);
    return withNotice(`/app/import/${encodeURIComponent(id)}`, `Imported ${r.imported} line${r.imported === 1 ? "" : "s"}${r.failed ? `. ${r.failed} could not be created; see below` : ""}.`);
  });
}

export async function discardImportAction(form: FormData) {
  return act("/app/import", async () => {
    const member = await requireMember("import.manage");
    await discardImport(member, str(form, "batchId"));
    return withNotice("/app/import", "Import discarded. Nothing was created.");
  });
}
