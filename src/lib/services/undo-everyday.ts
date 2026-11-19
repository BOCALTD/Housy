import { prisma, withTenant, withUser } from "../db";
import { logActivity } from "../audit";
import { recordUndo, undoable, type UndoActor } from "./undo";
import { follow, unfollow } from "./community";
import { markRead } from "./notifications";
import { deleteSearch, setSearchAlerts, unwatchListing, watchListing } from "./alerts";
import { removeProfileImage } from "./profile";
import type { ProfileImageKind } from "../profile-rules";
import { removeCompanyLogo } from "./company-logo";
import { archiveClient } from "./crm";
import { removeScheduleLine } from "./inventory";
import { hideFlatmate } from "./flatmates";
import { setTemplateActive } from "./inspections";
import { setScheduleActive } from "./maintenance";
import { removeListingPhoto } from "./listing-photos";
import { setShared } from "./reactions";
import { assertCan, type Ctx } from "./context";

// Everyday actions with Undo. Each function does the action exactly as before, then records how to put it back; the matching
// handler below reverses it through the same services (or, for removals, puts the removed row back under the same database
// rules). The Undo button shows for a few seconds and works for two minutes.

type FollowKind = "AGENT" | "COMPANY" | "DEVELOPER";
const member = (a: UndoActor): Ctx => {
  if (!a.member) throw new Error("Switch back to the workspace where you did this, then undo it.");
  return a.member;
};

// ---------- Following ----------

export async function followWithUndo(userId: string, kind: FollowKind, targetId: string, on: boolean) {
  if (on) await follow(userId, kind, targetId); else await unfollow(userId, kind, targetId);
  return recordUndo({ userId, kind: "follow", label: on ? "following" : "unfollowing", payload: { kind, targetId, on: !on } });
}
undoable("follow", async (a, p) => {
  const { kind, targetId, on } = p as { kind: FollowKind; targetId: string; on: boolean };
  if (on) await follow(a.userId, kind, targetId); else await unfollow(a.userId, kind, targetId);
});

// ---------- Notifications ----------

/** Mark one notice read, or all; Undo marks the same ones unread again. */
export async function markReadWithUndo(userId: string, id: string | null) {
  const ids = (await withUser(userId, (tx) => tx.notification.findMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, select: { id: true }, take: 500 }))).map((n) => n.id);
  await markRead(userId, id);
  return ids.length ? recordUndo({ userId, kind: "notification.read", label: ids.length === 1 ? "marking read" : `marking ${ids.length} notices read`, payload: { ids } }) : null;
}
undoable("notification.read", async (a, p) => {
  const { ids } = p as { ids: string[] };
  await withUser(a.userId, (tx) => tx.notification.updateMany({ where: { userId: a.userId, id: { in: ids } }, data: { readAt: null } }));
});

// ---------- Saved searches and watched properties ----------

export async function deleteSearchWithUndo(userId: string, id: string) {
  const row = await withUser(userId, (tx) => tx.savedSearch.findFirst({ where: { id, userId } }));
  await deleteSearch(userId, id);
  if (!row) return null;
  return recordUndo({ userId, kind: "search.delete", label: `deleting "${row.name}"`, payload: { ...row, maxKobo: row.maxKobo?.toString() ?? null, createdAt: row.createdAt.toISOString() } });
}
undoable("search.delete", async (a, p) => {
  const r = p as { id: string; name: string; purpose: string; city: string; q: string; maxKobo: string | null; minBeds: number | null; alertsOn: boolean; createdAt: string };
  await withUser(a.userId, (tx) => tx.savedSearch.create({ data: { id: r.id, userId: a.userId, name: r.name, purpose: r.purpose, city: r.city, q: r.q, maxKobo: r.maxKobo ? BigInt(r.maxKobo) : null, minBeds: r.minBeds, alertsOn: r.alertsOn, createdAt: new Date(r.createdAt) } }));
});

export async function searchAlertsWithUndo(userId: string, id: string, on: boolean) {
  await setSearchAlerts(userId, id, on);
  return recordUndo({ userId, kind: "search.alerts", label: on ? "turning alerts on" : "turning alerts off", payload: { id, on: !on } });
}
undoable("search.alerts", async (a, p) => { const { id, on } = p as { id: string; on: boolean }; await setSearchAlerts(a.userId, id, on); });

export async function unwatchWithUndo(userId: string, ref: string) {
  await unwatchListing(userId, ref);
  return recordUndo({ userId, kind: "watch", label: "stopping watching", payload: { ref } });
}
undoable("watch", async (a, p) => { await watchListing(a.userId, (p as { ref: string }).ref); });

// ---------- Shares ----------

export async function unshareListingWithUndo(userId: string, listingId: string) {
  await setShared(userId, "LISTING", listingId, false);
  return recordUndo({ userId, kind: "share", label: "taking back a share", payload: { kind: "LISTING", id: listingId } });
}
undoable("share", async (a, p) => { const { kind, id } = p as { kind: "LISTING" | "BANNER"; id: string }; await setShared(a.userId, kind, id, true); });

// ---------- Pictures ----------

export async function removeProfileImageWithUndo(userId: string, kind: ProfileImageKind) {
  const m = await prisma.userMedia.findUnique({ where: { userId }, select: kind === "avatar" ? { avatar: true, avatarType: true } : { cover: true, coverType: true } });
  const bytes = (m as { avatar?: Uint8Array | null; cover?: Uint8Array | null } | null)?.[kind === "avatar" ? "avatar" : "cover"];
  const type = (m as { avatarType?: string | null; coverType?: string | null } | null)?.[kind === "avatar" ? "avatarType" : "coverType"];
  await removeProfileImage(userId, kind);
  if (!bytes || !type) return null;
  return recordUndo({ userId, kind: "profile.image", label: kind === "avatar" ? "removing your profile photo" : "removing your cover photo", payload: { kind, type, b64: Buffer.from(bytes).toString("base64") } });
}
undoable("profile.image", async (a, p) => {
  const { kind, type, b64 } = p as { kind: ProfileImageKind; type: string; b64: string };
  const bytes = Buffer.from(b64, "base64");
  const data = kind === "avatar" ? { avatar: bytes, avatarType: type } : { cover: bytes, coverType: type };
  await prisma.userMedia.upsert({ where: { userId: a.userId }, create: { userId: a.userId, ...data, updatedAt: new Date() }, update: { ...data, updatedAt: new Date() } });
});

export async function removeLogoWithUndo(ctx: Ctx) {
  const before = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { logoMime: true, logoBytes: true, logoWatermark: true } }));
  await removeCompanyLogo(ctx);
  if (!before.logoBytes || !before.logoMime) return null;
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "company.logo", label: "removing the logo", payload: { mime: before.logoMime, b64: Buffer.from(before.logoBytes).toString("base64"), watermark: before.logoWatermark } });
}
undoable("company.logo", async (a, p) => {
  const ctx = member(a);
  assertCan(ctx, "settings.manage");
  const { mime, b64, watermark } = p as { mime: string; b64: string; watermark: boolean };
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { logoMime: mime, logoBytes: Buffer.from(b64, "base64"), logoWatermark: watermark } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "company", entityId: ctx.companyId, action: "company.logo_restored", detail: {} });
  });
});

/**
 * Remove a listing photograph. Undo puts the same picture back in the same place. As with any change to the pictures, a published
 * property goes back to review (removing it did that already).
 */
export async function removeListingPhotoWithUndo(ctx: Ctx, assetId: string, photoId: string) {
  const row = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.listingPhoto.findFirst({ where: { id: photoId, companyId: ctx.companyId } }));
  await removeListingPhoto(ctx, assetId, photoId);
  if (!row) return null;
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "listing.photo", label: "removing a photograph", payload: { assetId, id: row.id, listingId: row.listingId, kind: row.kind, mimeType: row.mimeType, caption: row.caption, position: row.position, b64: Buffer.from(row.bytes).toString("base64") } });
}
undoable("listing.photo", async (a, p) => {
  const ctx = member(a);
  assertCan(ctx, "listing.manage");
  const r = p as { id: string; listingId: string; kind: "PHOTO" | "FLOOR_PLAN"; mimeType: string; caption: string; position: number; b64: string };
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const count = await tx.listingPhoto.count({ where: { listingId: r.listingId } });
    if (count >= 20) throw new Error("This listing already has 20 photographs. Remove one first.");
    await tx.listingPhoto.updateMany({ where: { listingId: r.listingId, position: { gte: r.position } }, data: { position: { increment: 1 } } });
    await tx.listingPhoto.create({ data: { id: r.id, companyId: ctx.companyId, listingId: r.listingId, kind: r.kind, mimeType: r.mimeType, bytes: Buffer.from(r.b64, "base64"), caption: r.caption, position: r.position } });
    await logActivity(tx, { companyId: ctx.companyId, actorId: ctx.userId, entityType: "listing", entityId: r.listingId, action: "listing.photo_restored", detail: {} });
  });
});

// ---------- Workspace records ----------

export async function archiveClientWithUndo(ctx: Ctx, id: string, restore: boolean) {
  await archiveClient(ctx, id, restore);
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "client.archive", label: restore ? "restoring the client" : "archiving the client", payload: { id, restore: !restore } });
}
undoable("client.archive", async (a, p) => { const { id, restore } = p as { id: string; restore: boolean }; await archiveClient(member(a), id, restore); });

export async function removeHandoverLineWithUndo(ctx: Ctx, scheduleId: string, lineId: string) {
  const line = await withTenant(ctx.companyId, ctx.userId, (tx) => tx.handoverScheduleLine.findFirst({ where: { id: lineId, scheduleId, companyId: ctx.companyId } }));
  await removeScheduleLine(ctx, scheduleId, lineId);
  if (!line) return null;
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "handover.line", label: `removing "${line.description}"`, payload: { ...line } });
}
undoable("handover.line", async (a, p) => {
  const ctx = member(a);
  assertCan(ctx, "handover.record");
  const l = p as { id: string; scheduleId: string; room: string; description: string; quantity: number; condition: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "CRITICAL"; notes: string; sortOrder: number; itemId: string | null };
  await withTenant(ctx.companyId, ctx.userId, async (tx) => {
    const s = await tx.handoverSchedule.findFirst({ where: { id: l.scheduleId, companyId: ctx.companyId }, select: { status: true } });
    if (s?.status !== "DRAFT") throw new Error("The schedule has been acknowledged since, so it can no longer change.");
    await tx.handoverScheduleLine.create({ data: { id: l.id, companyId: ctx.companyId, scheduleId: l.scheduleId, room: l.room, description: l.description, quantity: l.quantity, condition: l.condition, notes: l.notes, sortOrder: l.sortOrder, itemId: l.itemId } });
  });
});

export async function templateActiveWithUndo(ctx: Ctx, id: string, active: boolean) {
  await setTemplateActive(ctx, id, active);
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "inspection.template", label: active ? "switching the template on" : "switching the template off", payload: { id, active: !active } });
}
undoable("inspection.template", async (a, p) => { const { id, active } = p as { id: string; active: boolean }; await setTemplateActive(member(a), id, active); });

export async function maintenanceScheduleWithUndo(ctx: Ctx, id: string, active: boolean) {
  await setScheduleActive(ctx, id, active);
  return recordUndo({ userId: ctx.userId, companyId: ctx.companyId, kind: "maintenance.schedule", label: active ? "switching the recurring job on" : "switching the recurring job off", payload: { id, active: !active } });
}
undoable("maintenance.schedule", async (a, p) => { const { id, active } = p as { id: string; active: boolean }; await setScheduleActive(member(a), id, active); });

// ---------- Flatmates ----------

export async function hideFlatmateWithUndo(userId: string, other: string) {
  await hideFlatmate(userId, other);
  return recordUndo({ userId, kind: "flatmate.hide", label: "hiding that person", payload: { other } });
}
undoable("flatmate.hide", async (a, p) => {
  const { other } = p as { other: string };
  await withUser(a.userId, (tx) => tx.flatmateHide.deleteMany({ where: { userId: a.userId, hiddenUserId: other } }));
});
