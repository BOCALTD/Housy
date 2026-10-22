"use server";

import { requireMember } from "@/lib/auth";
import { act, optStr, str, withNotice } from "@/lib/forms";
import { addParty, createAsset, setAssetPosition, updateAssetStatus, uploadDocument } from "@/lib/services/assets";
import { createLease, recordPayment } from "@/lib/services/leases";
import { createTask, updateTaskStatus } from "@/lib/services/tasks";
import { saveListingDraft, setListingStatus } from "@/lib/services/listings";
import { addListingPhoto, makeCoverPhoto, removeListingPhoto } from "@/lib/services/listing-photos";

const assetPath = (id: string) => `/app/assets/${encodeURIComponent(id)}`;

export async function createAssetAction(form: FormData) {
  return act("/app/assets/new", async () => {
    const member = await requireMember("asset.create");
    const asset = await createAsset(member, {
      name: str(form, "name"), assetClass: str(form, "assetClass") as never, category: str(form, "category"),
      description: str(form, "description"), address: str(form, "address"), city: str(form, "city"),
      state: str(form, "state"), status: (optStr(form, "status") ?? "ACTIVE") as never,
      companyRelationship: str(form, "companyRelationship") as never,
      acquisitionCost: optStr(form, "acquisitionCost"), acquiredOn: optStr(form, "acquiredOn"),
    });
    return withNotice(assetPath(asset.id), `Asset ${asset.ref} registered.`);
  });
}

export async function updateStatusAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("asset.update");
    await updateAssetStatus(member, id, str(form, "status"), str(form, "reason"));
    return withNotice(assetPath(id), "Status updated.");
  });
}

export async function addPartyAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("party.manage");
    await addParty(member, id, {
      partyName: str(form, "partyName"), relationship: str(form, "relationship") as never,
      effectiveFrom: optStr(form, "effectiveFrom"), evidenceNote: str(form, "evidenceNote"),
    });
    return withNotice(assetPath(id), "Relationship recorded.");
  });
}

export async function uploadDocumentAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("document.upload");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload");
    await uploadDocument(
      member, id,
      { title: str(form, "title"), category: str(form, "category") as never, expiresOn: optStr(form, "expiresOn") },
      { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
    return withNotice(assetPath(id), "Document uploaded.");
  });
}

export async function createLeaseAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("lease.manage");
    const lease = await createLease(member, id, {
      occupantName: str(form, "occupantName"), occupantContact: str(form, "occupantContact"), unit: str(form, "unit"),
      startDate: str(form, "startDate"), endDate: str(form, "endDate"), rent: str(form, "rent"),
      frequency: str(form, "frequency") as never, intervalMonths: optStr(form, "intervalMonths"), floorAreaSqm: optStr(form, "floorAreaSqm"),
      deposit: optStr(form, "deposit"), graceDays: optStr(form, "graceDays"), noticeDays: optStr(form, "noticeDays"),
      permittedUse: str(form, "permittedUse"), otherTerms: str(form, "otherTerms"),
    });
    return withNotice(assetPath(id), `Lease ${lease.ref} created with its rent schedule.`);
  });
}

export async function recordPaymentAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("payment.record");
    await recordPayment(member, str(form, "chargeId"), {
      amount: str(form, "amount"), paidOn: str(form, "paidOn"), evidence: str(form, "evidence"),
    });
    return withNotice(assetPath(id), "Payment recorded.");
  });
}

export async function createTaskAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("task.create");
    await createTask(member, id, {
      kind: str(form, "kind") as never, title: str(form, "title"), description: str(form, "description"),
      priority: (optStr(form, "priority") ?? "NORMAL") as never, assigneeId: optStr(form, "assigneeId"),
      dueOn: optStr(form, "dueOn"),
    });
    return withNotice(assetPath(id), "Task created.");
  });
}

export async function updateTaskAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember();
    await updateTaskStatus(member, str(form, "taskId"), str(form, "status"), str(form, "outcome"));
    return withNotice(assetPath(id), "Task updated.");
  });
}

export async function saveListingAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("listing.manage");
    await saveListingDraft(member, id, {
      title: str(form, "title"), purpose: str(form, "purpose") as never, price: str(form, "price"),
      bedrooms: optStr(form, "bedrooms"), bathrooms: optStr(form, "bathrooms"),
      description: str(form, "description"), city: str(form, "city"), state: str(form, "state"),
      propertyType: str(form, "propertyType"), pricePeriod: str(form, "pricePeriod"), negotiable: str(form, "negotiable"),
      deposit: optStr(form, "deposit"), serviceCharge: optStr(form, "serviceCharge"), feesNote: str(form, "feesNote"),
      toilets: optStr(form, "toilets"), floors: optStr(form, "floors"), buildingSqm: optStr(form, "buildingSqm"), landSqm: optStr(form, "landSqm"),
      plotDimensions: str(form, "plotDimensions"), furnishing: str(form, "furnishing"), condition: str(form, "condition"),
      constructionStatus: str(form, "constructionStatus"), serviced: str(form, "serviced"), amenities: form.getAll("amenity").map(String),
      titleDocument: str(form, "titleDocument"), availableFrom: str(form, "availableFrom"), minLeaseMonths: optStr(form, "minLeaseMonths"),
      estateName: str(form, "estateName"), videoUrl: str(form, "videoUrl"),
    });
    return withNotice(assetPath(id), "Listing saved as a draft. Submit it for review to publish it.");
  });
}

export async function listingStatusAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("listing.manage");
    const to = str(form, "to");
    if (to !== "PENDING_REVIEW" && to !== "UNAVAILABLE" && to !== "DRAFT") throw new Error("Unknown listing action");
    await setListingStatus(member, id, to);
    const msg = to === "PENDING_REVIEW" ? "Listing submitted for platform review." : to === "UNAVAILABLE" ? "Listing marked unavailable." : "Listing returned to draft.";
    return withNotice(assetPath(id), msg);
  });
}

export async function setPositionAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("asset.update");
    const clear = form.get("clear") === "1";
    await setAssetPosition(member, id, clear ? null : { lat: str(form, "lat"), lng: str(form, "lng") });
    return withNotice(assetPath(id), clear ? "Map position cleared." : "Map position saved.");
  });
}

export async function addListingPhotoAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("listing.manage");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a picture to upload");
    await addListingPhoto(member, id, { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, str(form, "caption"), str(form, "kind") === "FLOOR_PLAN" ? "FLOOR_PLAN" : "PHOTO");
    return withNotice(assetPath(id), "Photograph added. If the listing was live, it is back in review until it is approved again.");
  });
}

export async function removeListingPhotoAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("listing.manage");
    await removeListingPhoto(member, id, str(form, "photoId"));
    return withNotice(assetPath(id), "Photograph removed.");
  });
}

export async function makeCoverPhotoAction(form: FormData) {
  const id = str(form, "assetId");
  return act(assetPath(id), async () => {
    const member = await requireMember("listing.manage");
    await makeCoverPhoto(member, id, str(form, "photoId"));
    return withNotice(assetPath(id), "Cover photograph changed.");
  });
}
