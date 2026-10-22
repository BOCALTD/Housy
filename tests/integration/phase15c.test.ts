/**
 * Phase 15c: maps and location. The public sees published properties at an area about 1 km wide, never an exact position;
 * a company sees its own assets; individual vacancy sightings are for the platform administrator, and managers see counts
 * only for areas with enough sightings that none can be traced to one address.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { createAsset, setAssetPosition } from "../../src/lib/services/assets";
import { reviewListing, saveListingDraft, setListingStatus } from "../../src/lib/services/listings";
import { portfolioMapPoints, publicMapPoints, vacancyAreas, vacancyPins } from "../../src/lib/services/maps";
import { submitVacancy, withdrawVacancy, type ReportInput } from "../../src/lib/services/vacancies";
import { registerSeeker } from "../../src/lib/services/community";
import { addMember, newCompany, newPlatformAdmin, relativeDate, PASSWORD } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);

async function listed(admin: { id: string }, co: Ctx, o: { city: string; state?: string; purpose?: "RENT" | "SALE"; price?: string; publish?: boolean; at?: [string, string] }) {
  const asset = await createAsset(co, { name: `Home ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city: o.city, state: o.state ?? "Lagos" });
  if (o.at) await setAssetPosition(co, asset.id, { lat: o.at[0], lng: o.at[1] });
  await saveListingDraft(co, asset.id, { title: `Flat ${uid()}`, purpose: o.purpose ?? "RENT", price: o.price ?? "2,000,000", bedrooms: "2", city: o.city, state: o.state ?? "Lagos" } as never);
  const l = await sys((tx) => tx.listing.findFirstOrThrow({ where: { assetId: asset.id } }));
  if (o.publish !== false) { await setListingStatus(co, asset.id, "PENDING_REVIEW"); await reviewListing(admin.id, l.id, "approve", ""); }
  return { asset, listing: await sys((tx) => tx.listing.findUniqueOrThrow({ where: { id: l.id } })) };
}

const person = async () => (await registerSeeker({ name: `Rep ${uid()}`, email: `rep-${uid()}@example.test`, password: PASSWORD })).userId;
const report = (city: string, state: string, street: string): ReportInput => ({
  propertyType: "FLAT", purpose: "RENT", bedrooms: "2", address: street, area: city, city, state,
  description: `A two bedroom flat with a to-let board on the gate, nobody living there (${uid()}).`, observedOn: relativeDate(-2), allowContact: false, showNameToOwner: false, understood: true,
});

test("the public map shows published properties at an area, never an exact position, and leaves out drafts", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("pubmap");
  const exact = await listed(admin, co, { city: "Lekki", at: ["6.469812", "3.585234"] });
  const byCity = await listed(admin, co, { city: "Ikoyi" });
  const draft = await listed(admin, co, { city: "Lekki", publish: false });
  const nowhere = await listed(admin, co, { city: "Nowhereville", state: "Nowhere" }).catch(() => null);
  const r = await publicMapPoints({});
  const find = (ref: string) => r.points.find((p) => p.id === ref);
  const p1 = find(exact.listing.publicRef)!;
  assert.equal(p1.lat, 6.47); assert.equal(p1.lng, 3.59, "the position is blurred to about a kilometre");
  assert.equal(JSON.stringify(r).includes("6.469812"), false); assert.equal(JSON.stringify(r).includes("3.585234"), false);
  const p2 = find(byCity.listing.publicRef)!;
  assert.ok(Math.abs(p2.lat - 6.4549) < 0.01, "placed at the centre of the area it names");
  assert.equal(find(draft.listing.publicRef), undefined, "a draft is not on the map");
  assert.match(p1.href!, /^\/properties\/PROP-/); assert.equal(JSON.stringify(r).includes(co.companyId), false);
  if (nowhere) assert.ok(r.unplaced >= 1, "a property in an area the map does not know is counted, not drawn");
  const sale = await publicMapPoints({ purpose: "SALE" });
  assert.equal(sale.points.some((p) => p.id === exact.listing.publicRef), false);
  const cheap = await publicMapPoints({ maxPrice: "100,000" });
  assert.equal(cheap.points.some((p) => p.id === exact.listing.publicRef), false);
  assert.equal((await publicMapPoints({ city: "Ikoyi" })).points.some((p) => p.id === byCity.listing.publicRef), true);
  assert.equal((await publicMapPoints({ city: "Ikoyi" })).points.some((p) => p.id === exact.listing.publicRef), false);
});

test("a company's map holds its own assets only, with the exact position it set", async () => {
  const a = await newCompany("mapA"), b = await newCompany("mapB");
  const viewer = await addMember(a, "VIEWER", "v");
  const mine = await createAsset(a, { name: "Tower", assetClass: "COMMERCIAL", category: "Office", companyRelationship: "OWNER", city: "Abuja", state: "FCT" });
  await setAssetPosition(a, mine.id, { lat: "9.0765", lng: "7.3986" });
  const unplaced = await createAsset(a, { name: "Mystery", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER", city: "Nowhereville", state: "Nowhere" });
  const theirs = await createAsset(b, { name: "Theirs", assetClass: "LAND", category: "Plot", companyRelationship: "OWNER", city: "Kano", state: "Kano" });
  const r = await portfolioMapPoints(a);
  assert.deepEqual(r.points.map((p) => p.id), [mine.id]);
  assert.equal(r.points[0].lat, 9.0765); assert.equal(r.points[0].approximate, false);
  assert.equal(r.unplaced, 1); void unplaced;
  assert.equal((await portfolioMapPoints(b)).points[0].id, theirs.id);
  assert.equal((await portfolioMapPoints(viewer)).points.length, 1, "a viewer may see the company's map");
  assert.equal((await portfolioMapPoints(a, { status: "DISPOSED" })).points.length, 0);
});

test("vacancy sightings: individual pins for the administrator only; managers see counts for areas with enough sightings", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("vac");
  const manager = await addMember(co, "MANAGER", "mgr"), officer = await addMember(co, "OFFICER", "off");
  const reporter = await person(), second = await person();
  const ids: string[] = [];
  for (const [i, street] of ["1 Alpha Street", "2 Beta Street", "3 Gamma Street", "4 Delta Street"].entries()) ids.push((await submitVacancy(i % 2 ? second : reporter, report("Ilorin", "Kwara", street), [])).id);
  await withdrawVacancy(reporter, ids[0]);
  await submitVacancy(reporter, report("Jos", "Plateau", "9 Zeta Street"), []);
  await submitVacancy(second, report("Jos", "Plateau", "10 Eta Street"), []);
  const v = await vacancyAreas(manager);
  const ilorin = v.areas.find((a) => a.area === "Ilorin")!;
  assert.equal(ilorin.count, 3, "a withdrawn sighting is not counted");
  assert.equal(v.areas.some((a) => a.area === "Jos"), false, "two sightings are too few to show");
  assert.ok(v.hiddenReports >= 2);
  const text = JSON.stringify(v);
  for (const s of ["Alpha Street", "Beta Street", "Gamma Street", "Zeta Street", "two bedroom flat"]) assert.equal(text.includes(s), false, `${s} is not in the answer`);
  assert.equal(v.points.find((p) => p.id.startsWith("Ilorin"))!.weight, 3);
  await assert.rejects(vacancyAreas(officer), /permission/);
  await assert.rejects(vacancyAreas(await addMember(co, "AGENT", "agt")), /permission/);
  // the administrator sees individual sightings
  const pins = await vacancyPins(admin.id);
  assert.ok(pins.points.length >= 5);
  assert.ok(pins.points.every((p) => p.href?.startsWith("/admin/vacancies/")));
  await assert.rejects(vacancyPins(co.userId), /administrator/);
  await assert.rejects(vacancyPins(reporter), /administrator/);
});
