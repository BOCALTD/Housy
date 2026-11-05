/**
 * Phase 18b: artisans. An artisan registers with a company; the company approves and offers them; when a deal with a client who
 * has a Housy account completes, the client is offered the company's artisans and can ask for one; the company arranges it.
 * Clients never see an artisan's phone; nobody without an offer can ask.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, withTenant, withUser } from "../../src/lib/db";
import { registerSeeker, saveCompanyProfile } from "../../src/lib/services/community";
import { applyAsArtisan, artisanDesk, decideApplication, myArtisanCorner, myArtisanApplications, offerArtisansAfterDeal, requestArtisan, updateArtisanRequest, dismissArtisanOffer } from "../../src/lib/services/artisans";
import { newCompany } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => randomUUID().slice(0, 6);

test("artisan registers, company approves, client gets offered after a deal and asks", async () => {
  const co = await newCompany("artisans");
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Artisan Homes ${uid()}`, tagline: "", listed: true });
  const art = await registerSeeker({ name: "Tunde Wire", email: `tunde${uid()}@example.test`, password: "a long enough password" });
  await assert.rejects(applyAsArtisan(art.userId, { companyId: co.companyId, name: "Tunde Wire", phone: "0803 222 3333", trades: [], areas: "Lekki", years: "6", bio: "" }), /at least one trade/);
  await applyAsArtisan(art.userId, { companyId: co.companyId, name: "Tunde Wire", phone: "0803 222 3333", trades: ["electrician", "solar"], areas: "Lekki, Ajah", years: "6", bio: "Wiring and inverters." });
  await assert.rejects(applyAsArtisan(art.userId, { companyId: co.companyId, name: "Tunde Wire", phone: "0803 222 3333", trades: ["electrician"], areas: "Lekki", years: "", bio: "" }), /already applied/);
  const desk = await artisanDesk(co);
  const app = desk.applications.find((a) => a.userId === art.userId)!;
  assert.ok(app);
  const contractorId = await decideApplication(co, app.id, true, "Welcome");
  assert.ok(contractorId);
  assert.equal((await myArtisanApplications(art.userId))[0].status, "APPROVED");

  // A client with a Housy account closes a deal.
  const email = `client${uid()}@example.test`;
  const client = await registerSeeker({ name: "Ngozi Client", email, password: "a long enough password" });
  const c = await withTenant(co.companyId, co.userId, (tx) => tx.client.create({ data: { companyId: co.companyId, ref: `CL-${uid()}`, name: "Ngozi Client", email, emailNorm: email, ownerId: co.membershipId, createdById: co.userId } }));
  const dealId = randomUUID();
  const offerId = await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: dealId, clientId: c.id, title: "2-bed flat in Lekki" }));
  assert.ok(offerId);
  const corner = await myArtisanCorner(client.userId);
  assert.equal(corner.offers.length, 1);
  assert.equal(corner.offers[0].artisans.length, 1);
  assert.equal((corner.offers[0].artisans[0] as Record<string, unknown>).phone, undefined, "no phone for clients");
  const n = await withUser(client.userId, (tx) => tx.notification.findFirst({ where: { userId: client.userId, kind: "artisan.offer" } }));
  assert.ok(n, "client was told");

  const stranger = await registerSeeker({ name: "Not A Client", email: `s${uid()}@example.test`, password: "a long enough password" });
  await assert.rejects(requestArtisan(stranger.userId, { offerId: offerId!, trade: "plumber", note: "Leaking pipe", address: "", preferredOn: "" }), /after a deal/);
  await assert.rejects(requestArtisan(client.userId, { offerId: offerId!, trade: "astronaut", note: "Leaking pipe", address: "", preferredOn: "" }), /trade/);
  const r = await requestArtisan(client.userId, { offerId: offerId!, trade: "electrician", contractorId: contractorId!, note: "Fix the kitchen sockets", address: "Flat 4", preferredOn: "2026-12-01" });
  assert.equal(r.status, "OPEN");
  assert.equal((await artisanDesk(co)).requests.some((x) => x.id === r.id), true);
  await updateArtisanRequest(co, r.id, "ARRANGED", "Tunde will call on Friday", contractorId);
  const after1 = await myArtisanCorner(client.userId);
  assert.equal(after1.requests[0].status, "ARRANGED");
  assert.equal(after1.requests[0].companyNote, "Tunde will call on Friday");
  await dismissArtisanOffer(client.userId, offerId!);
  assert.equal((await myArtisanCorner(client.userId)).offers.length, 0);
});

test("a client without a Housy account is simply not offered", async () => {
  const co = await newCompany("artisans2");
  const c = await withTenant(co.companyId, co.userId, (tx) => tx.client.create({ data: { companyId: co.companyId, ref: `CL-${uid()}`, name: "Offline Person", email: `nobody${uid()}@example.test`, emailNorm: "", ownerId: co.membershipId, createdById: co.userId } }));
  assert.equal(await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: randomUUID(), clientId: c.id, title: "Shop" })), null);
});

test("flatmate ID check: submit, admin verifies, verified-only matching", async () => {
  const { submitFlatmateCheck, myFlatmateCheck, flatmateCheckQueue, decideFlatmateCheck, flatmateCheckImage, saveFlatmateProfile, myMatches } = await import("../../src/lib/services/flatmates");
  const { newPlatformAdmin } = await import("./helpers");
  const admin = await newPlatformAdmin();
  const city = `Engine City ${uid()}`;
  const answers = { smoking: "NON_SMOKER", smokeOk: "NO_SMOKE", schedule: "REGULAR", personality: "INTROVERT", cleanliness: "TIDY", guests: "SOMETIMES", noise: "QUIET", drinking: "SOCIAL", pets: "LIKE_PETS", workFromHome: "SOMETIMES", cooking: "SOMETIMES", inclusive: "FINE" };
  const prof = (name: string, intent: string, extra: Record<string, unknown> = {}) => ({ displayName: name, intent, country: "NG", city, areas: "", budgetMin: "50000", budgetMax: "150000", moveInFrom: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), stayMonths: "", ageBand: "25-34", agePref: "ANY" as const, gender: "UNSAID", genderPref: "ANY", showGender: false, answers, must: [], occupation: "", about: "", roomListingRef: "", adult: true, ...extra });
  const a = await registerSeeker({ name: "Amaka Verified", email: `a${uid()}@example.test`, password: "a long enough password" });
  const b = await registerSeeker({ name: "Bayo Unverified", email: `b${uid()}@example.test`, password: "a long enough password" });
  await saveFlatmateProfile(a.userId, prof("Amaka", "NEED_ROOM", { spaces: ["FLAT_2", "MINI_FLAT"], amenities: ["POWER"], verifiedOnly: true }) as never);
  await saveFlatmateProfile(b.userId, prof("Bayo", "HAVE_ROOM", { spaces: ["FLAT_2"], amenities: ["POWER", "WATER"] }) as never);
  await assert.rejects(saveFlatmateProfile(b.userId, prof("Bayo", "HAVE_ROOM", { spaces: ["OTHER"] }) as never), /something else/);
  // Amaka only wants verified people and is not verified herself: nobody either way.
  assert.equal((await myMatches(a.userId)).rows.length, 0);
  assert.equal((await myMatches(b.userId)).rows.length, 0, "a verified-only person is hidden from the unverified");
  const JPG = { type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]) };
  await assert.rejects(submitFlatmateCheck(a.userId, "NIN", { type: "image/png", bytes: JPG.bytes }, JPG), /not the picture type/);
  for (const u of [a.userId, b.userId]) await submitFlatmateCheck(u, "NIN", JPG, JPG);
  assert.equal((await myFlatmateCheck(a.userId))?.status, "PENDING");
  const queue = await flatmateCheckQueue(admin.id);
  assert.ok(queue.some((q) => q.userId === a.userId));
  assert.ok(await flatmateCheckImage(admin.id, a.userId, "selfie"));
  await assert.rejects(decideFlatmateCheck(admin.id, b.userId, false, ""), /say why/i);
  for (const u of [a.userId, b.userId]) await decideFlatmateCheck(admin.id, u, true, "");
  const m = await myMatches(a.userId);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].profile.verified, true);
  assert.equal(m.meVerified, true);
  assert.ok(m.rows[0].bars.length > 0 && m.rows[0].bars.every((x) => x.value >= 0 && x.value <= 100));
  assert.ok(m.rows[0].profile.spaces.includes("2-bedroom flat"));
  assert.equal((await myMatches(a.userId, { space: "DUPLEX" })).rows.length, 0, "space filter");
  assert.equal(m.stats.verified, 1);
});

test("artisans are ranked for the client, verified, and rated after the job", async () => {
  const { submitFlatmateCheck, decideFlatmateCheck } = await import("../../src/lib/services/flatmates");
  const { rateArtisanJob } = await import("../../src/lib/services/artisans");
  const { newPlatformAdmin } = await import("./helpers");
  const admin = await newPlatformAdmin();
  const co = await newCompany("artisans-rank");
  await saveCompanyProfile(co, { kind: "COMPANY", displayName: `Rank Homes ${uid()}`, tagline: "", listed: true });
  const join = async (name: string, trades: string[], areas: string) => {
    const u = await registerSeeker({ name, email: `${name.split(" ")[0].toLowerCase()}${uid()}@example.test`, password: "a long enough password" });
    await applyAsArtisan(u.userId, { companyId: co.companyId, name, phone: "0803 444 5555", trades, areas, years: "4", bio: "" });
    const app = (await artisanDesk(co)).applications.find((a) => a.userId === u.userId)!;
    return { userId: u.userId, id: (await decideApplication(co, app.id, true, ""))! };
  };
  const painter = await join("Pat Painter", ["painter"], "Lekki");
  const sparky = await join("Seyi Sparks", ["electrician"], "Ikeja");
  // Seyi passes the Housy ID check.
  const JPG = { type: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]) };
  await submitFlatmateCheck(sparky.userId, "NIN", JPG, JPG);
  await decideFlatmateCheck(admin.id, sparky.userId, true, "");
  assert.equal((await artisanDesk(co)).stats.get(sparky.id)?.verified, true);

  const email = `rank${uid()}@example.test`;
  const client = await registerSeeker({ name: "Rank Client", email, password: "a long enough password" });
  const c = await withTenant(co.companyId, co.userId, (tx) => tx.client.create({ data: { companyId: co.companyId, ref: `CL-${uid()}`, name: "Rank Client", email, emailNorm: email, ownerId: co.membershipId, createdById: co.userId } }));
  const offerId = (await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: randomUUID(), clientId: c.id, title: "Flat" })))!;

  const forSparks = await myArtisanCorner(client.userId, { trade: "electrician" });
  const ranked = forSparks.offers[0].artisans;
  assert.equal(ranked[0].id, sparky.id, "the electrician comes first when an electrician is needed");
  assert.equal(ranked[0].verified, true);
  assert.ok(ranked[0].reasons.includes("ID verified"));
  assert.equal(ranked[1].tradeMatch, false);
  assert.equal((ranked[0] as Record<string, unknown>).userId, undefined, "no account ids go to clients");

  const r = await requestArtisan(client.userId, { offerId, trade: "electrician", contractorId: sparky.id, note: "Sockets", address: "", preferredOn: "" });
  await assert.rejects(rateArtisanJob(client.userId, { requestId: r.id, stars: 5 }), /once the company has arranged/);
  await updateArtisanRequest(co, r.id, "DONE", "Done on Friday", sparky.id);
  const stranger = await registerSeeker({ name: "Not Them", email: `nt${uid()}@example.test`, password: "a long enough password" });
  await assert.rejects(rateArtisanJob(stranger.userId, { requestId: r.id, stars: 1 }), /not found/);
  await assert.rejects(rateArtisanJob(client.userId, { requestId: r.id, stars: 9 }), /1 to 5/);
  await rateArtisanJob(client.userId, { requestId: r.id, stars: 4, body: "Tidy and on time" });
  await assert.rejects(rateArtisanJob(client.userId, { requestId: r.id, stars: 5 }), /already rated/);

  const after = await myArtisanCorner(client.userId, { trade: "electrician" });
  const s1 = after.offers[0].artisans.find((a) => a.id === sparky.id)!;
  assert.equal(s1.stars, 4);
  assert.equal(s1.reviews, 1);
  assert.equal(s1.jobsDone, 1);
  assert.equal(after.requests[0].myStars, 4);
  assert.equal(after.requests[0].canRate, false);
  const desk = await artisanDesk(co);
  assert.equal(desk.reviews[0].body, "Tidy and on time");
  assert.equal(desk.stats.get(painter.id)?.reviews, 0);
  // The company can read but never change a rating.
  await assert.rejects(withTenant(co.companyId, co.userId, (tx) => tx.artisanReview.updateMany({ where: { requestId: r.id }, data: { stars: 5 } }).then((x) => { if (x.count === 0) throw new Error("blocked"); })), /blocked/);
});

test("a client with no matching email is found by phone, in any country, only when the names agree", async () => {
  const { normalisePhone } = await import("../../src/lib/crm-rules");
  const co = await newCompany("artisans-phone");
  const n = String(Math.floor(1000000 + Math.random() * 8999999));
  // Signed up in Ghana as +233 24 …; the agent typed the local form 024 … with Ghana chosen.
  const gh = await registerSeeker({ name: "Kwame Mensah", email: `kwame${uid()}@example.test`, password: "a long enough password", phone: `+23324${n}` });
  const mk = (name: string, phone: string, country: string) => withTenant(co.companyId, co.userId, (tx) => tx.client.create({ data: { companyId: co.companyId, ref: `CL-${uid()}`, name, email: "", emailNorm: "", phone, phoneNorm: normalisePhone(phone, country), ownerId: co.membershipId, createdById: co.userId } }));
  const c1 = await mk("Mr Kwame A. Mensah", `024 ${n.slice(0, 3)} ${n.slice(3)}`, "GH");
  const offer = await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: randomUUID(), clientId: c1.id, title: "Flat in Accra" }));
  assert.ok(offer, "found by phone across the two ways of writing it");
  const note = await withUser(gh.userId, (tx) => tx.notification.findFirst({ where: { userId: gh.userId, kind: "artisan.offer" } }));
  assert.ok(note && !note.body.includes("Flat in Accra"), "a phone match does not name the property");

  // Same number, a different name: not offered.
  const c2 = await mk("Ama Owusu", `+233 24 ${n}`, "NG");
  assert.equal(await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: randomUUID(), clientId: c2.id, title: "Shop" })), null);

  // Two accounts share a number: nobody is guessed.
  const m = String(Math.floor(1000000 + Math.random() * 8999999));
  await registerSeeker({ name: "Chidi Eze", email: `c1${uid()}@example.test`, password: "a long enough password", phone: `0803${m}` });
  await registerSeeker({ name: "Chidi Eze", email: `c2${uid()}@example.test`, password: "a long enough password", phone: `+234803${m}` });
  const c3 = await mk("Chidi Eze", `0803${m}`, "NG");
  assert.equal(await withTenant(co.companyId, co.userId, (tx) => offerArtisansAfterDeal(tx, co.companyId, { id: randomUUID(), clientId: c3.id, title: "Duplex" })), null);
});
