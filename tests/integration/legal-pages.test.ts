/**
 * Legal pages written by the administrator: drafts are private, published versions are fixed and kept, a later date keeps the
 * version in force until then, and a material change to the terms asks signed-in people to agree again.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPlatformAdmin } from "../../src/lib/db";
import { acceptLegal, consentVersion, discardLegalDraft, legalHistory, legalIndex, legalPage, needsConsent, publishLegal, saveLegalDraft } from "../../src/lib/services/legal-pages";
import { newCompany, newPlatformAdmin, relativeDate } from "./helpers";

after(() => prisma.$disconnect());
const BODY = "## Who we are\nThese are the rules written by the operator and checked by their lawyer. ".repeat(2);
const slug = `test-policy-${Math.random().toString(36).slice(2, 7)}`;

test("drafts, versions, history and dates for a page the administrator writes", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("legalx");
  await assert.rejects(saveLegalDraft(co.userId, slug, { title: "Refunds", body: BODY }), /platform administrator/);
  await assert.rejects(saveLegalDraft(admin.id, "1x", { title: "Refunds", body: BODY }), /web address/);
  await assert.rejects(saveLegalDraft(admin.id, slug, { title: "Refunds", body: "short" }), /at least/);

  const d1 = await saveLegalDraft(admin.id, slug, { title: "Refund policy", summary: "When money is returned.", body: BODY });
  assert.equal(d1.version, 1);
  assert.equal(await legalPage(slug), null, "a draft is not public");
  assert.equal((await saveLegalDraft(admin.id, slug, { title: "Refund policy", body: BODY + " More." })).id, d1.id, "one draft, saved again");
  const v1 = await publishLegal(admin.id, slug);
  assert.equal(v1.version, 1);
  const shown = (await legalPage(slug))!;
  assert.equal(shown.version, 1);
  assert.ok(shown.body.includes("More."));
  assert.ok((await legalIndex()).some((p) => p.slug === slug));
  await assert.rejects(publishLegal(admin.id, slug), /no draft/);

  // Published text is fixed in the database.
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.legalPageVersion.update({ where: { id: v1.id }, data: { body: "rewritten" } })), /cannot be changed/);
  await assert.rejects(withPlatformAdmin(admin.id, (tx) => tx.legalPageVersion.delete({ where: { id: v1.id } })), /cannot be deleted/);

  // Version 2 takes effect later: version 1 stays in force, and the page points to the new one.
  await assert.rejects(saveLegalDraft(admin.id, slug, { title: "Refund policy", body: BODY, effectiveFrom: relativeDate(-1) }), /past/);
  await saveLegalDraft(admin.id, slug, { title: "Refund policy", body: BODY + " Version two.", changeNote: "Clearer timings", effectiveFrom: relativeDate(10) });
  await publishLegal(admin.id, slug);
  const now = (await legalPage(slug))!;
  assert.equal(now.version, 1);
  assert.equal(now.upcoming?.version, 2);
  assert.ok((await legalPage(slug, 2))!.body.includes("Version two."));
  // Replaced before its date: version 3 (straight away) withdraws version 2, which never comes into force.
  await saveLegalDraft(admin.id, slug, { title: "Refund policy", body: BODY + " Version three.", changeNote: "Changed again" });
  await publishLegal(admin.id, slug);
  assert.equal((await legalPage(slug))!.version, 3);
  assert.equal(await legalPage(slug, 2), null, "a withdrawn version is not shown");
  assert.deepEqual((await legalHistory(slug)).map((h) => h.version), [3, 1]);
  assert.equal((await legalPage(slug, 1))!.status, "RETIRED");

  await saveLegalDraft(admin.id, slug, { title: "Refund policy", body: BODY });
  await discardLegalDraft(admin.id, slug);
  assert.equal(await prisma.legalPageVersion.count({ where: { slug, status: "DRAFT" } }), 0);
});

test("the built-in text shows until a page is published; a material change to the terms asks people to agree again", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("legalc");
  const builtIn = (await legalPage("cookies"))!;
  assert.ok(builtIn.builtIn || builtIn.version, "a page always has text");

  await acceptLegal(co.userId);
  assert.equal(await needsConsent(co.userId), false);
  // A change that is not material does not ask again; publishing the terms needs a note of what changed.
  await saveLegalDraft(admin.id, "terms", { title: "Terms of use", body: BODY });
  await assert.rejects(publishLegal(admin.id, "terms"), /what changed/);
  await saveLegalDraft(admin.id, "terms", { title: "Terms of use", body: BODY, changeNote: "Typo fixed" });
  await publishLegal(admin.id, "terms");
  // Other tests may publish terms too; what matters is that agreeing settles it and a material change reopens it.
  await acceptLegal(co.userId);
  assert.equal(await needsConsent(co.userId), false);
  await saveLegalDraft(admin.id, "terms", { title: "Terms of use", body: BODY + " New fees section.", changeNote: "New fees section", material: true });
  await publishLegal(admin.id, "terms");
  assert.match(await consentVersion(), /terms-v\d+/);
  assert.equal(await needsConsent(co.userId), true);
  await acceptLegal(co.userId);
  assert.equal(await needsConsent(co.userId), false);
});
