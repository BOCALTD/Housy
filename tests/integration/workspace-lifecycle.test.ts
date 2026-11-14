/**
 * A workspace's top administrator pauses it (public things hidden, team locked out, resumed exactly as it was) or closes it for
 * good (password and CLOSE, payment links and plan stopped). Nobody else can, and a Housy suspension is not lifted by the owner.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { saveListingDraft, setListingStatus, reviewListing } from "../../src/lib/services/listings";
import { suspendCompany } from "../../src/lib/services/governance";
import { requestOtherPayment } from "../../src/lib/services/client-payments";
import { closeWorkspace, pauseWorkspace, resumeWorkspace, workspaceClosure } from "../../src/lib/services/workspace-lifecycle";
import { PASSWORD, addMember, newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());

async function withListings(tag: string) {
  const co = await newCompany(`wl-${tag}`);
  const admin = await newPlatformAdmin();
  const ids: string[] = [];
  for (const n of [1, 2]) {
    const a = await createAsset(co, { name: `House ${tag} ${n}`, assetClass: "RESIDENTIAL", category: "House", companyRelationship: "OWNER" } as never);
    await saveListingDraft(co, a.id, { title: `House ${tag} ${n}`, purpose: "RENT", price: "2,000,000", city: "Yaba", state: "Lagos" } as never);
    await setListingStatus(co, a.id, "PENDING_REVIEW");
    const l = await withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: a.id } }));
    await reviewListing(admin.id, l.id, "approve", "ok");
    ids.push(l.id);
  }
  return { co, admin, ids };
}
const hidden = (co: { companyId: string; userId: string }, id: string) => withTenant(co.companyId, co.userId, (tx) => tx.listing.findUniqueOrThrow({ where: { id }, select: { platformHidden: true } })).then((r) => r.platformHidden);

test("pausing hides what was public and resuming brings back exactly that; only the top administrator can", async () => {
  const { co, ids } = await withListings("p");
  const manager = await addMember(co, "MANAGER", "wlm");
  // One listing was already hidden for another reason: resuming must not show it.
  await withTenant(co.companyId, co.userId, (tx) => tx.listing.update({ where: { id: ids[1] }, data: { platformHidden: true } }));
  await assert.rejects(pauseWorkspace(manager), /top administrator/);
  await pauseWorkspace(co, "Moving office");
  assert.equal((await workspaceClosure(co.companyId))?.kind, "PAUSED");
  assert.equal(await hidden(co, ids[0]), true);
  await assert.rejects(pauseWorkspace(co), /already closed/);
  await assert.rejects(resumeWorkspace(manager), /top administrator/);
  await resumeWorkspace(co);
  assert.equal(await workspaceClosure(co.companyId), null);
  assert.equal(await hidden(co, ids[0]), false, "shown again");
  assert.equal(await hidden(co, ids[1]), true, "what was hidden for another reason stays hidden");
});

test("a Housy suspension overrides a pause and the owner cannot lift it; closing needs the password and CLOSE", async () => {
  const { co, admin, ids } = await withListings("c");
  await pauseWorkspace(co);
  await suspendCompany(admin.id, co.companyId, { reason: "Fake listings reported by several people." } as never);
  assert.equal((await workspaceClosure(co.companyId))?.kind, "PLATFORM");
  await assert.rejects(resumeWorkspace(co), /Only Housy/);

  const other = await newCompany("wl-close");
  const link = await requestOtherPayment(other, { description: "Deposit", amount: "100,000", payerName: "Ola" });
  await assert.rejects(closeWorkspace(other, { reason: "Business stopped", confirm: "close it", password: PASSWORD }), /Type CLOSE/);
  await assert.rejects(closeWorkspace(other, { reason: "Business stopped", confirm: "CLOSE", password: "wrong-password" }), /password/);
  await closeWorkspace(other, { reason: "Business stopped", confirm: "close", password: PASSWORD });
  assert.equal((await workspaceClosure(other.companyId))?.kind, "CLOSED");
  const p = await withTenant(other.companyId, other.userId, (tx) => tx.clientPayment.findUniqueOrThrow({ where: { id: link.payment.id } }));
  assert.equal(p.status, "CANCELLED", "waiting payment links are cancelled");
  await assert.rejects(resumeWorkspace(other), /closed/);
  void ids;
});
