/**
 * Phase 17r: assistance gaps (master prompt §37). Listing checks for the reviewer (a photo another company uses, money asked
 * before an inspection, a new company), and leads that have gone quiet. All are prompts; nothing is decided for anyone.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "../../src/lib/db";
import { createAsset } from "../../src/lib/services/assets";
import { reviewListing, reviewQueue, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { addListingPhoto } from "../../src/lib/services/listing-photos";
import { listingRiskFlags } from "../../src/lib/services/listing-risk";
import { addClientActivity, createClient, createLead, quietLeads } from "../../src/lib/services/crm";
import { addMember, newCompany, newPlatformAdmin, relativeDate } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());
// A tiny valid PNG, made different per run so other tests' photos never match.
const png = () => { const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64"); return new Uint8Array(Buffer.concat([b, Buffer.from(randomUUID())])); };

async function draft(co: Ctx, title: string, description: string, photo: Uint8Array) {
  const a = await createAsset(co, { name: `${title} ${randomUUID().slice(0, 4)}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city: "Riskton", state: "Lagos" } as never);
  await saveListingDraft(co, a.id, { title, description, purpose: "RENT", pricePeriod: "YEAR", price: "3,000,000", bedrooms: "2", city: "Riskton", state: "Lagos", propertyType: "FLAT" } as never);
  await addListingPhoto(co, a.id, { type: "image/png", bytes: photo }, "Front");
  await setListingStatus(co, a.id, "PENDING_REVIEW");
  return withTenant(co.companyId, co.userId, (tx) => tx.listing.findFirstOrThrow({ where: { assetId: a.id } }));
}

test("the reviewer is shown reused photos, money asked up front and new companies", async () => {
  const admin = await newPlatformAdmin();
  const a = await newCompany("riska"), b = await newCompany("riskb");
  const photo = png();
  const original = await draft(a, "Two-bedroom flat in Riskton", "A bright flat close to the market, with parking for two cars and a borehole.", photo);
  await reviewListing(admin.id, original.id, "approve", "ok");
  const copy = await draft(b, "Cheap two-bedroom flat", "Pay before inspection to secure it. WhatsApp 0803 123 4567 for details.", photo);
  const clean = await draft(b, "Quiet two-bedroom flat", "A quiet flat on a short street.", png());

  const queue = (await reviewQueue(admin.id)).filter((l) => [copy.id, clean.id].includes(l.id));
  const flags = await listingRiskFlags(admin.id, queue);
  const codes = (id: string) => flags.get(id)!.map((f) => f.code);
  assert.ok(codes(copy.id).includes("PHOTO_REUSED"), "the same photo is on another company's listing");
  assert.ok(codes(copy.id).includes("MONEY_FIRST"));
  assert.ok(codes(copy.id).includes("CONTACT"));
  assert.ok(codes(copy.id).includes("NEW_COMPANY"));
  assert.equal(flags.get(copy.id)![0].level, "high", "the most serious come first");
  assert.ok(!codes(clean.id).includes("PHOTO_REUSED") && !codes(clean.id).includes("MONEY_FIRST"));

  const hash = await withTenant(b.companyId, b.userId, (tx) => tx.listingPhoto.findFirstOrThrow({ where: { listingId: copy.id } }));
  assert.match(hash.contentHash ?? "", /^[0-9a-f]{64}$/, "the database fingerprints every photo");
  assert.equal((await withTenant(b.companyId, b.userId, (tx) => tx.listing.findUniqueOrThrow({ where: { id: copy.id } }))).status, "PENDING_REVIEW", "flags change nothing");
});

test("open leads with no contact for a while are suggested until a follow-up is planned", async () => {
  const co = await newCompany("quiet");
  const agent = await addMember(co, "AGENT", "qag");
  const client = await createClient(agent, { name: `Quiet Client ${randomUUID().slice(0, 4)}`, phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}` } as never);
  const lead = await createLead(agent, client.id, { title: "Two-bedroom flat in Yaba" } as never);
  const fresh = await createLead(agent, client.id, { title: "Shop in Ikeja" } as never);
  await withTenant(co.companyId, co.userId, (tx) => tx.lead.update({ where: { id: lead.id }, data: { createdAt: new Date(Date.now() - 5 * 864e5) } }));

  let q = await quietLeads(agent);
  assert.deepEqual(q.map((x) => x.lead.id), [lead.id], "only the five-day-old lead; the new one is not due yet");
  assert.equal(q[0].level, "high");
  assert.match(q[0].reason, /Not contacted yet, 5 days/);

  await addClientActivity(agent, client.id, { kind: "FOLLOW_UP", subject: "Call about Yaba", leadId: lead.id, dueOn: relativeDate(2) } as never);
  q = await quietLeads(agent);
  assert.equal(q.length, 0, "a planned follow-up removes the suggestion");
  assert.ok(fresh.id);

  const other = await addMember(co, "AGENT", "qag2");
  assert.equal((await quietLeads(other)).length, 0, "another agent does not see this agent's leads");
});
