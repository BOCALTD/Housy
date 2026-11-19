/**
 * Incoming email: registered once in the right company's correspondence register, linked to the client who sent it.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../../src/lib/db";
import { createClient } from "../../src/lib/services/crm";
import { companyInboundAddress, inboundConfig, receiveInbound, saveInboundConfig, secretMatches } from "../../src/lib/services/inbound-email";
import { newCompany, newPlatformAdmin } from "./helpers";

after(() => prisma.$disconnect());
const uid = () => Math.random().toString(36).slice(2, 8);

test("emails to a company's address are registered once, with attachments, linked to the sending client", async () => {
  const admin = await newPlatformAdmin();
  const co = await newCompany("inbound");
  const other = await newCompany("inboundother");
  await assert.rejects(saveInboundConfig(co.userId, "in.housy.test"), /platform administrator/);
  await assert.rejects(saveInboundConfig(admin.id, "not a domain"), /domain only/);
  await saveInboundConfig(admin.id, "in.housy.test");
  const { secret } = await inboundConfig();
  assert.ok(secret.length >= 24);
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches("wrong", secret), false);

  const address = (await companyInboundAddress(co))!;
  assert.match(address, /^in\+[0-9a-f]{18}@in\.housy\.test$/);
  assert.equal(await companyInboundAddress(co), address, "the address stays the same");
  const tag = uid();
  const client = await createClient(co, { name: `Ada ${tag}`, email: `ada-${tag}@example.test` } as never);
  const email = (id: string, attachments: unknown[] = []) => ({
    FromFull: { Email: `ADA-${tag}@example.test`, Name: "Ada Obi" }, To: address, Subject: "Rent for June", TextBody: "Please find my receipt attached.", MessageID: id, Attachments: attachments,
  });
  const r = await receiveInbound(email(`<${tag}@example.test>`, [
    { Name: "receipt.pdf", ContentType: "application/pdf", Content: Buffer.from("%PDF-1.4 receipt").toString("base64") },
    { Name: "virus.exe", ContentType: "application/octet-stream", Content: Buffer.from("MZ").toString("base64") },
  ]));
  assert.equal(r.status, "registered", JSON.stringify(r));
  const rec = await withTenant(co.companyId, co.userId, (tx) => tx.correspondence.findFirstOrThrow({ where: { companyId: co.companyId, ref: r.refs![0] }, include: { attachments: true, actions: true } }));
  assert.equal(rec.direction, "INCOMING");
  assert.equal(rec.clientId, client.id);
  assert.equal(rec.fromEmail, `ada-${tag}@example.test`);
  assert.equal(rec.attachments.length, 1, "only accepted file types are kept");
  assert.match(rec.actions[0].note, /Not kept .*virus\.exe/);
  assert.equal((await receiveInbound(email(`<${tag}@example.test>`))).status, "duplicate", "the same email is registered once");

  // Unknown or other domains are ignored; the other company sees nothing.
  assert.equal((await receiveInbound({ ...email(`<x-${tag}@example.test>`), To: "in+000000000000000000@in.housy.test" })).status, "ignored");
  assert.equal((await receiveInbound({ ...email(`<y-${tag}@example.test>`), To: "someone@else.test" })).status, "ignored");
  assert.equal(await withTenant(other.companyId, other.userId, (tx) => tx.correspondence.count({ where: { fromEmail: `ada-${tag}@example.test` } })), 0);

  // A new address stops the old one.
  const fresh = (await companyInboundAddress(co, true))!;
  assert.notEqual(fresh, address);
  assert.equal((await receiveInbound(email(`<z-${tag}@example.test>`))).status, "ignored");
  await saveInboundConfig(admin.id, "");
});
