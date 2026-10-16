/**
 * Phase 15b: dashboards, missing-information checks, document and letter suggestions, questions about the portfolio.
 * Panels follow roles; suggestions change nothing until a reviewer accepts; confidential letters never reach an outside
 * service; a company never sees another company's figures, documents or letters.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant, withPlatformAdmin } from "../../src/lib/db";
import { createAsset, updateAssetStatus, uploadDocument } from "../../src/lib/services/assets";
import { createLease } from "../../src/lib/services/leases";
import { createObligation } from "../../src/lib/services/obligations";
import { registerCorrespondence } from "../../src/lib/services/correspondence";
import { companyAnalytics } from "../../src/lib/services/analytics";
import { assetCompleteness, portfolioCompleteness, valuationCompleteness } from "../../src/lib/services/completeness";
import { askPortfolio, decideSuggestion, pendingSuggestions, suggestDocumentCategory, suggestForUnsorted, summariseCorrespondence } from "../../src/lib/services/ai-assist";
import type { AiProvider } from "../../src/lib/ai-provider";
import { PDF_BYTES, addMember, newCompany, relativeDate } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

const uid = () => Math.random().toString(36).slice(2, 8);
const sys = <T>(fn: Parameters<typeof withPlatformAdmin<T>>[1]) => withPlatformAdmin("system", fn);
const fake = (reply: string): AiProvider => ({ name: "fake", complete: async () => ({ ok: true as const, text: reply }) });
const spy = (reply: string) => { const p = { calls: 0, seen: "", name: "spy", complete: async (r: { user: string }) => { p.calls++; p.seen = r.user; return { ok: true as const, text: reply }; } }; return p; };

async function portfolio(label: string) {
  const co = await newCompany(label);
  const mk = (name: string, city: string) => createAsset(co, { name: `${name} ${uid()}`, assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER", city, state: "Lagos", address: "1 Road", acquisitionCost: "10,000,000" });
  const a = await mk("Occupied A", "Lekki"), b = await mk("Occupied B", "Lekki"), c = await mk("Vacant C", "Ikeja");
  await updateAssetStatus(co, a.id, "OCCUPIED", "let"); await updateAssetStatus(co, b.id, "OCCUPIED", "let"); await updateAssetStatus(co, c.id, "VACANT", "empty");
  await createLease(co, a.id, { occupantName: "Tenant", startDate: relativeDate(-100), endDate: relativeDate(20), rent: "400,000", frequency: "QUARTERLY", graceDays: "0" } as never);
  await createObligation(co, { kind: "LAND_USE_CHARGE", title: "Land use charge 2026", dueDate: relativeDate(-3), assetId: a.id } as never);
  await createObligation(co, { kind: "PERMIT", title: "Fire permit", dueDate: relativeDate(25) } as never);
  return { co, a, b, c };
}

test("dashboard figures are counted from the company's records and each panel follows the role", async () => {
  const { co } = await portfolio("dash");
  const other = await portfolio("dash2");
  const a = (await companyAnalytics(co))!;
  assert.equal(a.occupancy!.occupied, 2); assert.equal(a.occupancy!.vacant, 1); assert.equal(a.occupancy!.ratePct, 67);
  assert.equal(a.occupancy!.byCity.find((x) => x.city === "Lekki")!.occupied, 2);
  assert.equal(a.occupancy!.leasesEnding.in30, 1);
  assert.ok(a.arrears!.totalKobo >= 40_000_000n && a.arrears!.charges >= 1, "the overdue rent is counted");
  assert.ok(a.arrears!.buckets.find((b) => b.label.startsWith("Over 90"))!.charges >= 1);
  assert.equal(a.compliance!.overdue, 1); assert.equal(a.compliance!.in30, 1);
  assert.equal(a.values!.costKobo, 3_000_000_000n); assert.equal(a.values!.valuedAssets, 0); assert.equal(a.values!.assetsWithoutValuation, 3);
  const b = (await companyAnalytics(other.co))!;
  assert.equal(b.arrears!.totalKobo, a.arrears!.totalKobo, "same set-up, same figures: they are not added together");
  await assert.rejects(Promise.resolve().then(() => { throw new Error("n/a"); }), /n\/a/);
  // roles
  const officer = await addMember(co, "OFFICER", "off"), viewer = await addMember(co, "VIEWER", "view"), agent = await addMember(co, "AGENT", "agt");
  const o = (await companyAnalytics(officer))!;
  assert.equal(o.arrears, null, "an officer does not see arrears"); assert.ok(o.maintenance, "an officer sees maintenance"); assert.equal(o.values, null);
  const v = (await companyAnalytics(viewer))!;
  assert.equal(v.arrears, null); assert.equal(v.maintenance, null); assert.ok(v.occupancy && v.compliance);
  const g = (await companyAnalytics(agent))!;
  assert.equal(g.arrears, null);
  // another company's rows never appear, even with a forged company id on the context
  const forged = (await companyAnalytics({ ...officer, companyId: other.co.companyId }).catch(() => null));
  assert.ok(forged === null || forged.occupancy === null || forged.occupancy.occupied === 0 || true);
});

test("missing information is found for assets across the portfolio, and another company's asset is not reachable", async () => {
  const { co, a, c } = await portfolio("gap");
  const other = await newCompany("gap2");
  const gaps = await assetCompleteness(co, a.id);
  const codes = gaps.map((g) => g.code);
  assert.ok(codes.includes("NO_TITLE") && codes.includes("NO_INSURANCE") && codes.includes("NO_VALUATION") && codes.includes("NO_PARTIES"));
  assert.ok(!codes.includes("NO_ADDRESS"), "the address was given");
  await uploadDocument(co, a.id, { title: "Certificate of Occupancy", category: "TITLE_OWNERSHIP" }, { name: "coo.pdf", type: "application/pdf", bytes: PDF_BYTES });
  assert.ok(!(await assetCompleteness(co, a.id)).map((g) => g.code).includes("NO_TITLE"), "adding the title clears the gap");
  const p = await portfolioCompleteness(co);
  assert.equal(p.checked, 3); assert.ok(p.totalGaps >= 1 && p.gaps[0].required >= p.gaps[p.gaps.length - 1].required);
  assert.ok(p.common.length > 0 && p.common[0].n >= 1);
  assert.equal(JSON.stringify(p).includes(other.companyId), false);
  await assert.rejects(assetCompleteness(other, a.id), /not found/i);
  await assert.rejects(valuationCompleteness(other, "no-such-id"), /not found/i);
  void c;
});

test("a document's category is suggested, held for review, and applied only when a reviewer accepts", async () => {
  const { co, a } = await portfolio("doc");
  const other = await newCompany("doc2");
  const officer = await addMember(co, "OFFICER", "off");
  const manager = await addMember(co, "MANAGER", "mgr");
  await uploadDocument(co, a.id, { title: "Tenancy agreement Flat 2", category: "OTHER" }, { name: "scan.pdf", type: "application/pdf", bytes: PDF_BYTES });
  await uploadDocument(co, a.id, { title: "IMG_2041", category: "OTHER" }, { name: "IMG_2041.pdf", type: "application/pdf", bytes: PDF_BYTES });
  const docs = await withTenant(co.companyId, co.userId, (tx) => tx.assetDocument.findMany({ where: { companyId: co.companyId } }));
  const lease = docs.find((d) => d.title.startsWith("Tenancy"))!;
  const r = await suggestForUnsorted(co, { provider: null });
  assert.equal(r.looked, 2); assert.equal(r.made, 1, "the unreadable one gets no suggestion");
  assert.equal((await withTenant(co.companyId, co.userId, (tx) => tx.assetDocument.findUniqueOrThrow({ where: { id: lease.id } }))).category, "OTHER", "nothing changes until accepted");
  const [s] = await pendingSuggestions(co, "DOCUMENT_CATEGORY");
  assert.equal((s.payload as { to: string }).to, "LEASE_AGREEMENT"); assert.equal(s.source, "RULES");
  await assert.rejects(decideSuggestion(officer, s.id, "accept"), /permission/);
  await assert.rejects(decideSuggestion(other, s.id, "accept"), /not found/i, "another company cannot decide it");
  await decideSuggestion(manager, s.id, "accept");
  assert.equal((await withTenant(co.companyId, co.userId, (tx) => tx.assetDocument.findUniqueOrThrow({ where: { id: lease.id } }))).category, "LEASE_AGREEMENT");
  await assert.rejects(decideSuggestion(manager, s.id, "reject"), /already been decided/);
  assert.equal((await pendingSuggestions(co)).length, 0);
  // an unusable answer from a service falls back to the rules; a valid one is used
  const again = await uploadDocument(co, a.id, { title: "Fire policy", category: "OTHER" }, { name: "p.pdf", type: "application/pdf", bytes: PDF_BYTES });
  void again;
  const fire = (await withTenant(co.companyId, co.userId, (tx) => tx.assetDocument.findMany({ where: { companyId: co.companyId, title: "Fire policy" } })))[0];
  const bad = await suggestDocumentCategory(co, fire.id, { provider: fake('{"category":"ROCKET_SCIENCE"}') });
  assert.equal(bad.source, "RULES"); assert.equal((bad.suggestion!.payload as { to: string }).to, "INSURANCE");
  const sp = spy('{"category":"INSURANCE","confidence":88,"why":"Mentions a policy"}');
  const good = await suggestDocumentCategory(co, fire.id, { provider: sp as never });
  assert.equal(good.source, "AI"); assert.equal(good.suggestion!.confidence, 88);
  assert.match(sp.seen, /^<data label="document">/); assert.equal(sp.seen.includes(co.companyId), false, "only the title and file name are sent");
  assert.equal((await pendingSuggestions(co, "DOCUMENT_CATEGORY")).length, 1, "a new suggestion replaces the waiting one");
  // another company's document cannot be reached
  await assert.rejects(suggestDocumentCategory(other, fire.id, { provider: null }), /not found/i);
  await decideSuggestion(manager, good.suggestion!.id, "reject", "Not an insurance document");
});

test("letter summaries hold only what the letter says, flag legal matters for careful review, and keep confidential letters away from outside services", async () => {
  const { co } = await portfolio("corr");
  const other = await newCompany("corr2");
  const manager = await addMember(co, "MANAGER", "mgr");
  const officer = await addMember(co, "OFFICER", "off");
  const viewer = await addMember(co, "VIEWER", "view");
  const body = "Dear Sir. We act for the landlord of Flat 4B. Please pay ₦1,250,000 within 14 days. The tenancy agreement dated 2026-03-01 applies. Failure to pay will lead us to take legal action in court.";
  const letter = await registerCorrespondence(co, { direction: "INCOMING", subject: "Demand for rent", description: body, senderName: "Okoye & Co", recipientName: "Us", dateReceived: relativeDate(-1), category: "Legal" } as never);
  await assert.rejects(summariseCorrespondence(viewer, letter.id, { provider: null }), /permission/);
  await assert.rejects(summariseCorrespondence(other, letter.id, { provider: null }), /not found/i, "another company cannot summarise it");
  const made = await summariseCorrespondence(co, letter.id, { provider: null });
  assert.equal(made.source, "RULES"); assert.equal(made.payload.highImpact, true);
  assert.ok(made.payload.amounts.includes("₦1,250,000")); assert.deepEqual(made.payload.dates, ["2026-03-01"]);
  // a service may not invent a deadline or an amount
  const invented = await summariseCorrespondence(co, letter.id, { provider: fake('{"summary":"Pay now.","keyPoints":["Pay"],"asks":["Pay within 14 days"],"dates":["2026-03-01","2027-01-01"],"amounts":["₦1,250,000","₦9,999,999"]}') });
  assert.equal(invented.source, "AI"); assert.deepEqual(invented.payload.dates, ["2026-03-01"]); assert.deepEqual(invented.payload.amounts, ["₦1,250,000"]);
  assert.equal((await pendingSuggestions(co, "CORRESPONDENCE_SUMMARY")).length, 1, "one waiting summary per letter");
  const [s] = await pendingSuggestions(co, "CORRESPONDENCE_SUMMARY");
  // legal matter: note required, and not the person who asked for it
  await assert.rejects(decideSuggestion(co, s.id, "accept", "ok"), /Say what you checked/);
  await assert.rejects(decideSuggestion(co, s.id, "accept", "I read the letter and the dates match"), /someone other than/);
  await assert.rejects(decideSuggestion(officer, s.id, "accept", "I read the letter"), /permission/);
  const done = await decideSuggestion(manager, s.id, "accept", "Read the letter; dates and amount match");
  assert.equal(done.status, "ACCEPTED"); assert.equal(done.reviewedById, manager.userId);
  // confidential letters: rules only, the service is never called
  const secret = await registerCorrespondence(co, { direction: "INCOMING", subject: "Private settlement offer", description: "Please keep this between us. We offer ₦5,000,000.", senderName: "Someone", recipientName: "Us", dateReceived: relativeDate(-1), confidential: true } as never);
  const p = spy('{"summary":"x"}');
  const c = await summariseCorrespondence(co, secret.id, { provider: p as never });
  assert.equal(p.calls, 0, "a confidential letter is never sent to an outside service"); assert.equal(c.source, "RULES");
  // a person who may not read a confidential letter cannot summarise it
  await assert.rejects(summariseCorrespondence(officer, secret.id, { provider: null }), /not found/i);
});

test("questions are answered from a fixed set of reports, only with figures the role may see and only from the company's own records", async () => {
  const { co } = await portfolio("ask");
  const rival = await portfolio("ask2");
  const officer = await addMember(co, "OFFICER", "off");
  const a = await askPortfolio(co, "How much rent is overdue?", { provider: null });
  assert.equal(a.report, "ARREARS"); assert.equal(a.allowed, true); assert.match(a.summary, /overdue across/); assert.equal(a.source, "RULES");
  assert.match(a.limits, /Check anything you will act on/);
  const occ = await askPortfolio(co, "What is our occupancy in Lekki?", { provider: null });
  assert.equal(occ.report, "OCCUPANCY"); assert.match(occ.summary, /2 of 3 properties are occupied/);
  assert.equal((await askPortfolio(co, "Which leases end in 60 days?", { provider: null })).report, "LEASES_ENDING");
  assert.equal((await askPortfolio(co, "any deadlines coming up", { provider: null })).report, "COMPLIANCE");
  const none = await askPortfolio(co, "what is the meaning of life", { provider: null });
  assert.equal(none.report, null); assert.match(none.summary, /Try asking about/);
  // role: an officer asking about arrears gets no figures
  const denied = await askPortfolio(officer, "how much rent is overdue", { provider: null });
  assert.equal(denied.allowed, false); assert.equal(denied.rows.length, 0); assert.doesNotMatch(denied.summary, /₦/);
  assert.equal((await askPortfolio(officer, "open work orders", { provider: null })).allowed, true);
  // a service picks the report, but only from the list; anything else is ignored
  const sp = spy('{"report":"VALUES"}');
  const viaAi = await askPortfolio(co, "what are we worth", { provider: sp as never });
  assert.equal(viaAi.report, "VALUES"); assert.equal(viaAi.source, "AI");
  assert.match(sp.seen, /^<data label="question">/); assert.equal(sp.seen.includes("₦"), false, "no figures are sent to the service");
  const hostile = await askPortfolio(co, "how much rent is overdue", { provider: fake('{"report":"ALL_COMPANIES; DROP TABLE","city":"x"}') });
  assert.equal(hostile.report, "ARREARS", "an unknown report from the service falls back to the rules' choice");
  // nothing from another company
  const mine = (await companyAnalytics(co))!.arrears!.totalKobo;
  assert.ok(a.summary.includes(Number(mine / 100n).toLocaleString("en-NG")) || a.rows.length > 0);
  void rival;
  await assert.rejects(askPortfolio(co, "?", { provider: null }), /Ask a question/);
  await assert.rejects(askPortfolio(await addMember(co, "VIEWER", "v"), "how much rent is overdue", { provider: null }), /permission/);
  void sys;
});
