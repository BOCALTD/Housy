/**
 * Phase 18d: client files. A company files properties under a client, sees the folders with counts, and sends the client a
 * private link that shows only the chosen sections, counts visits, serves only that property's documents, and stops when closed.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { createAsset, uploadDocument } from "../../src/lib/services/assets";
import { createClient } from "../../src/lib/services/crm";
import { addToClientFile, clientDirectory, clientFile, clientLinkDocument, createClientLink, folderItems, revokeClientLink, viewClientLink } from "../../src/lib/services/client-files";
import { PDF_BYTES, newCompany, withRole } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => randomUUID().slice(0, 6);

test("client file, folders and a private client link", async () => {
  const co = await newCompany("clientfiles");
  const other = await newCompany("clientfiles-other");
  const client = await createClient(co, { name: `File Client ${uid()}`, phone: `0803${Math.floor(1000000 + Math.random() * 8999999)}` } as never);
  const a = await createAsset(co, { name: "Lekki duplex", assetClass: "RESIDENTIAL", category: "Duplex", companyRelationship: "MANAGER" } as never);
  const b = await createAsset(co, { name: "Yaba shop", assetClass: "COMMERCIAL", category: "Shop", companyRelationship: "OWNER" } as never);
  const foreign = await createAsset(other, { name: "Not yours", assetClass: "RESIDENTIAL", category: "Flat", companyRelationship: "OWNER" } as never);
  await uploadDocument(co, a.id, { title: "Certificate of Occupancy", category: "TITLE_OWNERSHIP" }, { name: "coo.pdf", type: "application/pdf", bytes: PDF_BYTES });
  await uploadDocument(co, b.id, { title: "Shop lease", category: "OTHER" }, { name: "lease.pdf", type: "application/pdf", bytes: PDF_BYTES });

  await addToClientFile(co, { clientId: client.id, assetId: a.id, role: "OWNER" });
  await assert.rejects(addToClientFile(co, { clientId: client.id, assetId: foreign.id }), /not found/);
  await assert.rejects(addToClientFile(withRole(co, "VIEWER"), { clientId: client.id, assetId: b.id }), /permission/);

  const dir = await clientDirectory(co);
  assert.equal(dir.find((c) => c.id === client.id)?.properties, 1);
  const file = await clientFile(co, client.id);
  assert.equal(file.groups.length, 1);
  assert.equal(file.groups[0].items[0].counts.documents, 1);
  assert.equal((await folderItems(co, client.id, a.id, "documents")).length, 1);
  await assert.rejects(folderItems(co, client.id, b.id, "documents"), /not in this client's file/);
  await assert.rejects(clientFile(other, client.id), /not found/);

  await assert.rejects(createClientLink(co, { clientId: client.id, assetId: a.id, sections: ["correspondence"], days: 30 }), /at least one/);
  await assert.rejects(createClientLink(co, { clientId: client.id, assetId: b.id, sections: ["documents"], days: 30 }), /Add the property/);
  const token = await createClientLink(co, { clientId: client.id, assetId: a.id, sections: ["documents", "valuations", "correspondence"], days: 30 });
  const v = await viewClientLink(token);
  assert.ok(v);
  assert.deepEqual(v!.sections.map((s) => s.key).sort(), ["documents", "valuations"], "correspondence is never shared");
  assert.equal(v!.asset.name, "Lekki duplex");
  const docId = v!.sections.find((s) => s.key === "documents")!.items[0].id;
  assert.ok(await clientLinkDocument(token, docId));
  assert.equal(await viewClientLink("not-a-real-token-at-all-xxxxxxxx"), null);

  const links = (await clientFile(co, client.id)).groups[0].items[0].links;
  assert.equal(links.length, 1);
  assert.ok(links[0].views >= 1, "visit counted");
  await revokeClientLink(co, links[0].id);
  assert.equal(await viewClientLink(token), null);
  assert.equal(await clientLinkDocument(token, docId), null);
});
