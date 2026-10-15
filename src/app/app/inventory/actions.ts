"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import {
  acknowledgeSchedule, addScheduleLine, addSchedulePhoto, cancelCount, createHandoverSchedule, createItem, decideAdjustment, decideCount,
  findItemByCode, recordMovement, removeScheduleLine, requestAdjustment, saveCountLines, startCount, submitCount, updateItem, useOnWorkOrder,
} from "@/lib/services/inventory";

const itemPath = (id: string) => `/app/inventory/${encodeURIComponent(id)}`;
const countPath = (id: string) => `/app/inventory/counts/${encodeURIComponent(id)}`;
const handoverPath = (leaseId: string) => `/app/handover-inventory/${encodeURIComponent(leaseId)}`;

function upload(form: FormData, name: string) {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}
async function bytesOf(f: File) {
  return { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export async function lookupCodeAction(form: FormData) {
  return act("/app/inventory", async () => {
    const member = await requireMember("asset.view");
    const code = str(form, "code");
    const found = await findItemByCode(member, code);
    if (!found) throw new Error(`No item has the code "${code}"`);
    return itemPath(found.id);
  });
}

export async function createItemAction(form: FormData) {
  return act("/app/inventory", async () => {
    const member = await requireMember("inventory.manage");
    const item = await createItem(member, {
      name: str(form, "name"), category: str(form, "category"), kind: str(form, "kind") as never, assetId: optStr(form, "assetId"),
      serialNumber: str(form, "serialNumber"), model: str(form, "model"), manufacturer: str(form, "manufacturer"), unit: str(form, "unit"),
      quantity: optStr(form, "quantity"), condition: (optStr(form, "condition") ?? "GOOD") as never, location: str(form, "location"),
      custodianId: optStr(form, "custodianId"), acquiredOn: optStr(form, "acquiredOn"), unitCost: optStr(form, "unitCost"),
      ownership: str(form, "ownership"), warrantyUntil: optStr(form, "warrantyUntil"), reorderLevel: optStr(form, "reorderLevel"),
      code: str(form, "code"), notes: str(form, "notes"),
    });
    return withNotice(itemPath(item.id), `${item.itemNo} added.`);
  });
}

export async function updateItemAction(form: FormData) {
  const id = str(form, "itemId");
  return act(itemPath(id), async () => {
    const member = await requireMember("inventory.manage");
    await updateItem(member, id, {
      name: str(form, "name"), category: str(form, "category"), serialNumber: str(form, "serialNumber"), model: str(form, "model"),
      manufacturer: str(form, "manufacturer"), unit: str(form, "unit"), condition: str(form, "condition") as never, location: str(form, "location"),
      custodianId: optStr(form, "custodianId"), warrantyUntil: optStr(form, "warrantyUntil"), reorderLevel: optStr(form, "reorderLevel"),
      code: str(form, "code"), notes: str(form, "notes"), ownership: str(form, "ownership"),
    });
    return withNotice(itemPath(id), "Saved.");
  });
}

export async function movementAction(form: FormData) {
  const id = str(form, "itemId");
  return act(itemPath(id), async () => {
    const member = await requireMember("inventory.move");
    await recordMovement(member, id, {
      kind: str(form, "kind") as never, quantity: str(form, "quantity") || "1", toLocation: str(form, "toLocation"),
      custodianId: optStr(form, "custodianId"), reference: str(form, "reference"), note: str(form, "note"),
    });
    return withNotice(itemPath(id), "Recorded.");
  });
}

export async function useOnWorkOrderAction(form: FormData) {
  const id = str(form, "itemId");
  return act(itemPath(id), async () => {
    const member = await requireMember("inventory.move");
    await useOnWorkOrder(member, id, str(form, "workOrderId"), { quantity: str(form, "quantity") });
    return withNotice(itemPath(id), "Stock issued to the work order.");
  });
}

export async function requestAdjustmentAction(form: FormData) {
  const id = str(form, "itemId");
  return act(itemPath(id), async () => {
    const member = await requireMember("inventory.move");
    await requestAdjustment(member, id, {
      kind: str(form, "kind") as never, quantity: str(form, "quantity"), direction: (optStr(form, "direction") ?? "DOWN") as never, reason: str(form, "reason"),
    });
    return withNotice(itemPath(id), "Sent for approval. The stock does not change until someone else approves it.");
  });
}

export async function decideAdjustmentAction(form: FormData) {
  const back = optStr(form, "back") ?? "/app/inventory";
  return act(back, async () => {
    const member = await requireMember("inventory.approve");
    const decision = str(form, "decision") === "reject" ? "reject" : "approve";
    await decideAdjustment(member, str(form, "adjustmentId"), decision, str(form, "note"));
    return withNotice(back, decision === "approve" ? "Adjustment approved." : "Adjustment rejected.");
  });
}

export async function startCountAction(form: FormData) {
  return act("/app/inventory/counts", async () => {
    const member = await requireMember("inventory.manage");
    const count = await startCount(member, { title: str(form, "title"), assetId: optStr(form, "assetId") });
    return withNotice(countPath(count.id), `${count.ref} started.`);
  });
}

export async function saveCountAction(form: FormData) {
  const id = str(form, "countId");
  return act(countPath(id), async () => {
    const member = await requireMember("inventory.count");
    const entries: Record<string, { counted: string; note?: string }> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("counted:") && typeof v === "string") entries[k.slice(8)] = { counted: v, note: str(form, `note:${k.slice(8)}`) };
    }
    const saved = await saveCountLines(member, id, entries);
    return withNotice(countPath(id), `${saved} count${saved === 1 ? "" : "s"} saved.`);
  });
}

export async function submitCountAction(form: FormData) {
  const id = str(form, "countId");
  return act(countPath(id), async () => {
    const member = await requireMember("inventory.count");
    await submitCount(member, id);
    return withNotice(countPath(id), "Submitted for approval.");
  });
}

export async function decideCountAction(form: FormData) {
  const id = str(form, "countId");
  return act(countPath(id), async () => {
    const member = await requireMember("inventory.approve");
    const decision = str(form, "decision") === "return" ? "return" : "approve";
    const adjusted = await decideCount(member, id, decision, str(form, "note"));
    return withNotice(countPath(id), decision === "approve" ? `Approved. ${adjusted} balance${adjusted === 1 ? "" : "s"} adjusted.` : "Sent back for recounting.");
  });
}

export async function cancelCountAction(form: FormData) {
  const id = str(form, "countId");
  return act(countPath(id), async () => {
    const member = await requireMember("inventory.manage");
    await cancelCount(member, id, str(form, "reason"));
    return withNotice(countPath(id), "Count cancelled.");
  });
}

export async function createScheduleAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(handoverPath(leaseId), async () => {
    const member = await requireMember("handover.record");
    await createHandoverSchedule(member, leaseId, str(form, "kind") === "MOVE_OUT" ? "MOVE_OUT" : "MOVE_IN");
    return withNotice(handoverPath(leaseId), "Schedule started.");
  });
}

export async function addLineAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(handoverPath(leaseId), async () => {
    const member = await requireMember("handover.record");
    const file = upload(form, "photo");
    await addScheduleLine(member, str(form, "scheduleId"), {
      room: str(form, "room"), description: str(form, "description"), quantity: str(form, "quantity") || "1",
      condition: (optStr(form, "condition") ?? "GOOD") as never, notes: str(form, "notes"),
    }, file ? { ...(await bytesOf(file)), caption: str(form, "caption") } : null);
    return withNotice(handoverPath(leaseId), "Item added.");
  });
}

export async function removeLineAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(handoverPath(leaseId), async () => {
    const member = await requireMember("handover.record");
    await removeScheduleLine(member, str(form, "scheduleId"), str(form, "lineId"));
    return withNotice(handoverPath(leaseId), "Item removed.");
  });
}

export async function addLinePhotoAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(handoverPath(leaseId), async () => {
    const member = await requireMember("handover.record");
    const file = upload(form, "photo");
    if (!file) throw new Error("Choose a photograph to upload");
    await addSchedulePhoto(member, str(form, "scheduleId"), str(form, "lineId"), { caption: str(form, "caption") }, await bytesOf(file));
    return withNotice(handoverPath(leaseId), "Photograph added.");
  });
}

export async function acknowledgeAction(form: FormData) {
  const leaseId = str(form, "leaseId");
  return act(handoverPath(leaseId), async () => {
    const member = await requireMember("handover.record");
    await acknowledgeSchedule(member, str(form, "scheduleId"), { acknowledgedBy: str(form, "acknowledgedBy"), acknowledgedOn: str(form, "acknowledgedOn") });
    return withNotice(handoverPath(leaseId), "Acknowledged. The schedule is now locked.");
  });
}
