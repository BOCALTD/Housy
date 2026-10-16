/**
 * Phase 13b: saved searches, property and availability alerts that reach only the right people, enquiry and onboarding notices,
 * and the audience rules the administrator controls.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin, withUser } from "../../src/lib/db";
import { follow, registerSeeker, saveAgentProfile, saveCompanyProfile } from "../../src/lib/services/community";
import { createAsset } from "../../src/lib/services/assets";
import { createEnquiry, reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { addMember, newCompany, newPlatformAdmin, PASSWORD } from "./helpers";
import {
  alertNewListing, deleteSearch, isWatching, mySearches, readAlertConfig, saveAlertConfig, saveSearch, setSearchAlerts, unwatchListing, watchListing, MAX_SAVED_SEARCHES,
} from "../../src/lib/services/alerts";
import { applyUnsubscribe, processOutbox, savePrefs, unsubscribeUrl } from "../../src/lib/services/delivery";
import type { EmailDriver, Outgoing } from "../../src/lib/email-drivers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const person = async (label = "u") => {
  const email = `${label}-${uid()}@example.test`;
  const id = (await registerSeeker({ name: `${label} Person ${uid()}`, email, password: PASSWORD })).userId;
  return { id, email };
};
async function agent(label: string) {
  const co = await newCompany(label);
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `${label} Homes ${uid()}`, tagline: "Homes", listed: true });
  await saveAgentProfile(co, { displayName: `${label} Agent ${uid()}`, headline: "Sales", bio: "", listed: true, acceptsMessages: true });
  return co;
}
async function pending(co: Ctx, city: string, over: Record<string, string> = {}) {
  const asset = await createAsset(co, { name: `Home ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await saveListingDraft(co, asset.id, { title: `Flat in ${city} ${uid()}`, purpose: "RENT", price: "2,000,000", bedrooms: "2", city, state: "Lagos", ...over } as never);
  await setListingStatus(co, asset.id, "PENDING_REVIEW");
  const l = await withPlatformAdmin("system", (tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  return { asset, listing: l };
}
const alertsFor = (userId: string, ref: string) => withUser(userId, (tx) => tx.notification.findMany({ where: { userId, kind: "alert.property", link: `/properties/${ref}` } }));
const search = (userId: string, o: Record<string, string>) => saveSearch(userId, { name: `S ${uid()}`, purpose: "", city: "", q: "", maxPrice: "", minBeds: "", ...o } as never);

test("saved searches: need a filter, are limited, private, and can be switched off", async () => {
  const a = await person(), b = await person();
  await assert.rejects(search(a.id, {}), /at least one thing/);
  await assert.rejects(saveSearch(a.id, { name: "", city: "Lekki" } as never), /name/i);
  const s = await search(a.id, { city: "Lekki", purpose: "RENT", maxPrice: "3,000,000", minBeds: "2" });
  assert.equal(s.maxKobo, 300_000_000n);
  assert.equal((await mySearches(b.id)).length, 0, "nobody else sees it");
  await deleteSearch(b.id, s.id);
  assert.equal((await mySearches(a.id)).length, 1, "nobody else can delete it");
  await setSearchAlerts(a.id, s.id, false);
  assert.equal((await mySearches(a.id))[0].alertsOn, false);
  for (let i = 1; i < MAX_SAVED_SEARCHES; i++) await search(a.id, { city: `Area${i}` });
  await assert.rejects(search(a.id, { city: "One more" }), /10 saved searches/);
  await deleteSearch(a.id, s.id);
  await search(a.id, { city: "Room made" });
});

test("a new approved property reaches only the people who asked, once, and never the company's own people", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("al");
  const member = await addMember(co, "AGENT", "inside");
  const city = `Zed${uid()}`;
  const [match, noMatch, fan, local, stranger, off] = [await person("match"), await person("nomatch"), await person("fan"), await person("local"), await person("stranger"), await person("off")];
  await search(match.id, { city, purpose: "RENT", maxPrice: "5,000,000", minBeds: "2" });
  await search(noMatch.id, { city, purpose: "SALE" });                       // wrong purpose
  await search(member.userId, { city });                                      // a colleague: excluded
  const mine = await search(off.id, { city });
  await setSearchAlerts(off.id, mine.id, false);                              // alerts switched off
  await follow(fan.id, "AGENT", co.userId);
  await savePrefs(local.id, { emailActivity: true, emailAlerts: true, emailPromotional: false, digest: "INSTANT", quietStart: "" as never, quietEnd: "" as never, areas: `${city}, elsewhere` });

  const { listing } = await pending(co, city);
  await reviewListing(admin.id, listing.id, "approve", "ok");

  for (const u of [match, fan, local]) assert.equal((await alertsFor(u.id, listing.publicRef)).length, 1, "asked for it, told once");
  for (const u of [noMatch, stranger, off, { id: member.userId }]) assert.equal((await alertsFor(u.id, listing.publicRef)).length, 0, "not relevant, not told");
  assert.match((await alertsFor(match.id, listing.publicRef))[0].body, /saved/);
  assert.match((await alertsFor(fan.id, listing.publicRef))[0].body, /follow/);
  assert.match((await alertsFor(local.id, listing.publicRef))[0].body, /area/);
  let total = 0;
  for (const u of [match, noMatch, fan, local, stranger, off]) total += (await alertsFor(u.id, listing.publicRef)).length;
  assert.equal(total, 3, "not broadcast to everyone");

  // Running it again, or approving again after an edit, does not alert twice.
  assert.equal((await alertNewListing(listing.id)).sent, 0);
  await saveListingDraft(co, listing.assetId, { title: listing.title, purpose: "RENT", price: "2,100,000", bedrooms: "2", city, state: "Lagos" } as never);
  await setListingStatus(co, listing.assetId, "PENDING_REVIEW");
  await reviewListing(admin.id, listing.id, "approve", "ok again");
  assert.equal((await alertsFor(match.id, listing.publicRef)).length, 1);
});

test("the audience rules decide who is included and how many", async () => {
  const admin = await newPlatformAdmin();
  const original = await readAlertConfig();
  try {
    await assert.rejects(saveAlertConfig(admin.id, { maxRecipients: 0, savedSearches: true, followers: true, areas: true }), /1 to 1000/);
    await assert.rejects(saveAlertConfig((await person()).id, { maxRecipients: 5, savedSearches: true, followers: true, areas: true }), /Only the platform administrator/);
    const co = await agent("cfg");
    const city = `Cfg${uid()}`;
    const [s1, s2, s3, fan] = [await person(), await person(), await person(), await person()];
    for (const u of [s1, s2, s3]) await search(u.id, { city });
    await follow(fan.id, "AGENT", co.userId);

    await saveAlertConfig(admin.id, { maxRecipients: 2, savedSearches: true, followers: true, areas: true });
    const one = await pending(co, city);
    await reviewListing(admin.id, one.listing.id, "approve", "");
    const told = async (ref: string) => { const out: string[] = []; for (const u of [s1, s2, s3, fan]) if ((await alertsFor(u.id, ref)).length) out.push(u.id); return out; };
    const got = await told(one.listing.publicRef);
    assert.equal(got.length, 2, "the limit holds");
    assert.ok(!got.includes(fan.id), "saved searches come before followers");

    await saveAlertConfig(admin.id, { maxRecipients: 300, savedSearches: false, followers: true, areas: false });
    const two = await pending(co, city);
    await reviewListing(admin.id, two.listing.id, "approve", "");
    assert.deepEqual(await told(two.listing.publicRef), [fan.id], "only followers when saved searches are switched off");
  } finally {
    await saveAlertConfig(admin.id, original);
  }
});

test("watching a property: told when it is no longer available, and not after you stop", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("wt");
  const city = `Wt${uid()}`;
  const { listing, asset } = await pending(co, city);
  await reviewListing(admin.id, listing.id, "approve", "");
  const [w, other] = [await person("watch"), await person("other")];
  await assert.rejects(watchListing(w.id, "NO-SUCH-REF"), /not available/);
  await watchListing(w.id, listing.publicRef);
  await watchListing(w.id, listing.publicRef);   // twice is fine
  assert.equal(await isWatching(w.id, listing.id), true);
  assert.equal(await isWatching(other.id, listing.id), false);
  await setListingStatus(co, asset.id, "UNAVAILABLE");
  const told = await withUser(w.id, (tx) => tx.notification.findMany({ where: { userId: w.id, kind: "alert.availability" } }));
  assert.equal(told.length, 1);
  assert.match(told[0].title, /No longer available/);
  assert.equal((await withUser(other.id, (tx) => tx.notification.count({ where: { userId: other.id, kind: "alert.availability" } }))), 0);
  // Back on the market after the platform approves it again.
  await setListingStatus(co, asset.id, "PENDING_REVIEW").catch(() => undefined);
  await unwatchListing(w.id, listing.publicRef);
  assert.equal(await isWatching(w.id, listing.id), false);
});

test("an enquiry reaches the people who deal with it; a new profile reaches the platform team", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("enq");
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Enq Homes ${uid()}`, tagline: "", listed: true });
  const adminNotes = () => withUser(admin.id, (tx) => tx.notification.findMany({ where: { userId: admin.id, kind: "onboarding.admin" } }));
  const before = (await adminNotes()).length;
  await saveAgentProfile(co, { displayName: `Enq Agent ${uid()}`, headline: "", bio: "", listed: true, acceptsMessages: true });
  assert.equal((await adminNotes()).length, before + 1, "the platform team hears about a newly listed agent");
  await saveAgentProfile(co, { displayName: `Enq Agent ${uid()}`, headline: "Edited", bio: "", listed: true, acceptsMessages: true });
  assert.equal((await adminNotes()).length, before + 1, "editing it does not announce it again");

  const { listing } = await pending(co, `Enq${uid()}`);
  await reviewListing(admin.id, listing.id, "approve", "");
  await createEnquiry(listing.publicRef, { name: "Tunde Buyer", contact: "08031234567", message: "Is the flat still available?" }, `k-${uid()}`);
  const mine = await withUser(co.userId, (tx) => tx.notification.findMany({ where: { userId: co.userId, kind: "enquiry.new" } }));
  assert.equal(mine.length, 1);
  assert.match(mine[0].body, /Tunde Buyer/);
  const queued = await withPlatformAdmin("system", (tx) => tx.emailOutbox.findMany({ where: { userId: co.userId, template: "enquiry_received" } }));
  assert.equal(queued.length, 1);
});

test("end to end: the alert email names the property and the reason, and the alert switch is respected", async () => {
  const admin = await newPlatformAdmin();
  const co = await agent("e2e");
  const city = `E2e${uid()}`;
  const p = await person("Ngozi");
  await search(p.id, { city });
  const sent: Outgoing[] = [];
  const driver: EmailDriver = { name: "fake", async send(m) { sent.push(m); return { ok: true, id: `id${sent.length}` }; } };

  const one = await pending(co, city);
  await reviewListing(admin.id, one.listing.id, "approve", "");
  await processOutbox({ driver });
  const mail = sent.find((m) => m.to === p.email && /New match/.test(m.subject))!;
  assert.ok(mail, "the alert email was sent");
  assert.ok(mail.text.includes(one.listing.title));
  assert.match(mail.text, /Why you are seeing this: It matches a search you saved/);
  assert.ok(mail.text.includes(`/properties/${one.listing.publicRef}`));
  assert.ok(mail.headers?.["List-Unsubscribe"]);

  // One click on the unsubscribe link in that email stops alert emails, but the notice still appears in the app.
  assert.equal(await applyUnsubscribe(new URL(unsubscribeUrl(p.id, "ALERTS")).searchParams.get("t")!), "ALERTS");
  const two = await pending(co, city);
  await reviewListing(admin.id, two.listing.id, "approve", "");
  const before = sent.filter((m) => m.to === p.email).length;
  await processOutbox({ driver });
  assert.equal(sent.filter((m) => m.to === p.email).length, before, "no second email");
  assert.equal((await alertsFor(p.id, two.listing.publicRef)).length, 1, "still told inside the app");
});
