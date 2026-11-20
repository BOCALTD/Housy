/**
 * The company's documents in one place: searched, filtered, sorted, and limited to what each person may open (confidential
 * letters stay with the people allowed to see them; roles without a section see none of it). Also the correspondence register's
 * search inside email text and its sort.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAsset, uploadDocument } from "../../src/lib/services/assets";
import { listCorrespondence, registerCorrespondence } from "../../src/lib/services/correspondence";
import { documentLibrary } from "../../src/lib/services/document-library";
import { addMember, newCompany, relativeDate } from "./helpers";

after(() => prisma.$disconnect());
const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
const PNG = new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"));
const date = { key: "date", dir: "desc" as const };

test("documents from every part of the company, found, sorted and kept to who may see them", async () => {
  const co = await newCompany("doclib");
  const viewer = await addMember(co, "VIEWER", "view");
  const a = await createAsset(co, { name: "Palm Court", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" });
  await uploadDocument(co, a.id, { title: "Certificate of Occupancy", category: "TITLE_OWNERSHIP" }, { name: "coo.pdf", type: "application/pdf", bytes: PDF });
  await uploadDocument(co, a.id, { title: "Building insurance", category: "INSURANCE", expiresOn: relativeDate(20) } as never, { name: "insurance.png", type: "image/png", bytes: PNG }).catch(() => uploadDocument(co, a.id, { title: "Building insurance", category: "INSURANCE" }, { name: "insurance.pdf", type: "application/pdf", bytes: PDF }));
  await registerCorrespondence(co, { direction: "INCOMING", subject: "Notice of rent review", description: "Please find the review attached. The new rent applies from March.", senderName: "Okoye & Co", recipientName: "Us", dateReceived: relativeDate(-3), category: "Legal" } as never, { name: "review-letter.pdf", type: "application/pdf", bytes: PDF });
  await registerCorrespondence(co, { direction: "INCOMING", subject: "Private settlement", description: "Strictly between us.", senderName: "Someone", recipientName: "Us", dateReceived: relativeDate(-1), confidential: true } as never, { name: "secret.pdf", type: "application/pdf", bytes: PDF });

  const all = await documentLibrary(co, { sort: date });
  assert.ok(all.docs.length >= 4);
  assert.deepEqual([...new Set(all.docs.map((d) => d.source))].sort(), ["correspondence", "property"]);
  // Search by title, by the property, or by the letter it came with.
  assert.equal((await documentLibrary(co, { q: "occupancy", sort: date })).docs.length, 1);
  assert.ok((await documentLibrary(co, { q: "Palm Court", sort: date })).docs.every((d) => d.source === "property"));
  assert.equal((await documentLibrary(co, { q: "rent review", sort: date })).docs[0]?.source, "correspondence");
  assert.equal((await documentLibrary(co, { source: "correspondence", sort: date })).docs.every((d) => d.source === "correspondence"), true);
  const byName = (await documentLibrary(co, { sort: { key: "name", dir: "asc" } })).docs.map((d) => d.title);
  assert.deepEqual(byName, [...byName].sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base", numeric: true })));

  // A viewer cannot open property documents (no download right) and does not see confidential letters.
  const v = await documentLibrary(viewer, { sort: date });
  assert.equal(v.docs.some((d) => d.source === "property"), false);
  assert.equal(v.docs.some((d) => d.fileName === "secret.pdf"), false);
  assert.equal(v.docs.some((d) => d.fileName === "review-letter.pdf"), true);
  assert.equal(v.available.includes("deal"), false);
});

test("the correspondence register searches inside email text and sorts", async () => {
  const co = await newCompany("corrsort");
  await registerCorrespondence(co, { direction: "INCOMING", subject: "B letter", description: "The borehole pump has failed again.", senderName: "Zed", recipientName: "Us", dateReceived: relativeDate(-5), priority: "LOW" } as never);
  await registerCorrespondence(co, { direction: "INCOMING", subject: "A letter", description: "Thanks for the visit.", senderName: "Ada", recipientName: "Us", dateReceived: relativeDate(-1), priority: "URGENT" } as never);
  assert.deepEqual((await listCorrespondence(co, { q: "borehole" })).map((c) => c.subject), ["B letter"]);
  assert.deepEqual((await listCorrespondence(co, { sort: { key: "subject", dir: "asc" } })).map((c) => c.subject), ["A letter", "B letter"]);
  assert.deepEqual((await listCorrespondence(co, { sort: { key: "received", dir: "asc" } })).map((c) => c.subject), ["B letter", "A letter"]);
  assert.deepEqual((await listCorrespondence(co, { sort: { key: "priority", dir: "desc" } })).map((c) => c.subject), ["A letter", "B letter"]);
});
