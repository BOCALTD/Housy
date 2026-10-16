/**
 * Phase 16a: attacks on the walls between companies and between roles. One company holds real data across many kinds of record;
 * another company, a stranger and the public try to read it, change it, delete it and reach it by guessing identifiers.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, withPublic, withTenant, withUser, type Tx } from "../../src/lib/db";
import { createAsset, getAsset, getDocumentForDownload, listAssets, setAssetPosition, updateAssetStatus, uploadDocument, addParty } from "../../src/lib/services/assets";
import { createLease, getLease, getReceipt, recordLeasePayment, recordPayment } from "../../src/lib/services/leases";
import { getCorrespondence, getCorrespondenceAttachment, listCorrespondence, registerCorrespondence, addCorrespondenceNote } from "../../src/lib/services/correspondence";
import { getWorkOrder, reportWorkOrder } from "../../src/lib/services/maintenance";
import { acceptInvitation, changeMemberRole, findInvitation, inviteMember, listTeam, myCompanies } from "../../src/lib/services/companies";
import { addMember, newCompany, PASSWORD, PDF_BYTES, withRole } from "./helpers";
import type { Ctx } from "../../src/lib/services/context";

after(() => prisma.$disconnect());

const PDF = { name: "deed.pdf", type: "application/pdf", bytes: PDF_BYTES };

/** Company A with a spread of real records. */
async function victim() {
  const a = await newCompany("victim");
  const asset = await createAsset(a, { name: "Victim Towers", assetClass: "COMMERCIAL", category: "Office", companyRelationship: "OWNER", city: "Lagos", state: "Lagos" });
  await uploadDocument(a, asset.id, { title: "Certificate of Occupancy", category: "TITLE_OWNERSHIP" }, PDF);
  const doc = await prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT set_config('app.company_id', ${a.companyId}, true)`; return tx.assetDocument.findFirstOrThrow({ where: { assetId: asset.id } }); });
  const created = await createLease(a, asset.id, { occupantName: "Tenant Ltd", startDate: "2025-01-01", endDate: "2026-01-01", rent: "400,000", frequency: "QUARTERLY", deposit: "300,000" });
  const full = (await getLease(a, created.id))!;
  const receipt = await recordLeasePayment(a, created.id, { amount: "100,000", paidOn: "2025-01-05", evidence: `VICTIM-${Math.random().toString(36).slice(2, 8)}`, method: "Bank transfer", payerName: "Tenant Ltd" });
  const open = await registerCorrespondence(a, { direction: "INCOMING", subject: "Notice of inspection", senderName: "Ministry", recipientName: "Victim Towers", dateReceived: "2025-01-02" }, PDF);
  const secret = await registerCorrespondence(a, { direction: "INCOMING", subject: "Confidential: pending litigation", senderName: "Counsel", recipientName: "Board", dateReceived: "2025-01-02", confidential: true }, PDF);
  const wo = await reportWorkOrder(a, asset.id, { title: "Leaking roof over server room" });
  const att = await prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT set_config('app.company_id', ${a.companyId}, true)`; return tx.correspondenceAttachment.findFirstOrThrow({ where: { correspondenceId: secret.id } }); });
  return { a, asset, doc, lease: created, charge: full.lease.charges[0], receipt, open, secret, wo, att };
}

test("another company, signed in as its own administrator, cannot read, change or create anything on a victim's records by identifier", async () => {
  const v = await victim();
  const b = await newCompany("intruder");

  // Reading by identifier finds nothing.
  assert.equal(await getAsset(b, v.asset.id), null);
  assert.equal(await getLease(b, v.lease.id), null);
  assert.equal(await getReceipt(b, v.receipt.id), null);
  assert.equal(await getDocumentForDownload(b, v.doc.id), null);
  assert.equal(await getCorrespondence(b, v.open.id), null);
  assert.equal(await getCorrespondenceAttachment(b, v.att.id), null);
  assert.equal(await getWorkOrder(b, v.wo.id), null);
  assert.ok(!(await listAssets(b)).some((x) => x.id === v.asset.id));
  assert.equal((await listCorrespondence(b)).length, 0);

  // Writing by identifier is refused.
  await assert.rejects(updateAssetStatus(b, v.asset.id, "DISPOSED", "taking over"), /not found/i);
  await assert.rejects(addParty(b, v.asset.id, { partyName: "Intruder", relationship: "LEGAL_OWNER", effectiveFrom: "2025-01-01", evidenceNote: "x" }), /not found/i);
  await assert.rejects(uploadDocument(b, v.asset.id, { title: "Forged deed", category: "OTHER" }, PDF), /not found/i);
  await assert.rejects(setAssetPosition(b, v.asset.id, { lat: "6.5", lng: "3.4" }), /not found/i);
  await assert.rejects(createLease(b, v.asset.id, { occupantName: "Squatter", startDate: "2025-01-01", endDate: "2026-01-01", rent: "1", frequency: "MONTHLY" }), /not found/i);
  await assert.rejects(recordLeasePayment(b, v.lease.id, { amount: "1,000", paidOn: "2025-01-06", evidence: "FAKE-PAY-1" }), /not found/i);
  await assert.rejects(recordPayment(b, v.charge.id, { amount: "1,000", paidOn: "2025-01-06", evidence: "FAKE-PAY-2" }), /not found/i);
  await assert.rejects(reportWorkOrder(b, v.asset.id, { title: "Fake request" }), /not found/i);
  await assert.rejects(addCorrespondenceNote(b, v.open.id, "I was here"), /not found/i);
  // Pointing the intruder's own record at the victim's asset or department is refused too.
  await assert.rejects(registerCorrespondence(b, { direction: "INCOMING", subject: "Linked to a stranger's asset", senderName: "Xavier", recipientName: "Yemi", dateReceived: "2025-01-02", assetId: v.asset.id }), /asset was not found/);

  // The victim's records are unchanged.
  const still = await getAsset(v.a, v.asset.id);
  assert.equal(still!.asset.status, "ACTIVE");
  assert.equal((await getLease(v.a, v.lease.id))!.lease.charges.reduce((n, c) => n + c.paidKobo, 0n), 10_000_000n);
});

test("every table that holds company records is walled off, for another company, for a signed-in stranger and for the public", async () => {
  const v = await victim();
  const b = await newCompany("sweep");
  const stranger = await prisma.user.create({ data: { email: `stranger-${Math.random().toString(36).slice(2, 8)}@example.test`, name: "Stranger", passwordHash: "x" } });
  const tables = (await prisma.$queryRaw<{ t: string; rls: boolean; forced: boolean }[]>`
    SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'company_id')
    ORDER BY 1`);
  assert.ok(tables.length > 100, `found only ${tables.length} company tables`);
  // sessions carries the company the person is browsing as, but belongs to the person; it is checked in the sign-in tests.
  const NOT_COMPANY_OWNED = new Set(["sessions"]);
  // Tables that deliberately show some rows to everyone (published pages and directories). Their rules are checked against the catalogue below.
  const PUBLIC_BY_DESIGN = new Set(["agent_profiles", "collab_participants", "company_profiles", "company_tiers", "listings"]);

  // 1. Row-level security is on for every table, and a table either says who may see it or is on the public list.
  const policies = await prisma.$queryRaw<{ t: string; qual: string | null; cmd: string }[]>`SELECT tablename AS t, qual, cmd FROM pg_policies WHERE schemaname = 'public'`;
  for (const t of tables.filter((x) => !NOT_COMPANY_OWNED.has(x.t))) {
    assert.ok(t.rls, `${t.t}: row-level security is off`);
    const reads = policies.filter((p) => p.t === t.t && (p.cmd === "SELECT" || p.cmd === "ALL"));
    assert.ok(reads.length > 0, `${t.t}: nobody can read it, but it has no policy to say so`);
    if (!PUBLIC_BY_DESIGN.has(t.t)) {
      for (const p of reads) assert.match(p.qual ?? "", /app_current_company|app_platform_admin|app_current_user|app_invite_token/, `${t.t}: a read policy that does not depend on who is asking: ${p.qual}`);
    }
  }

  // 2. The victim has rows, so the next checks are not empty.
  const own = await withTenant(v.a.companyId, v.a.userId, async (tx) => {
    const found: string[] = [];
    for (const t of tables.filter((x) => !NOT_COMPANY_OWNED.has(x.t))) {
      const [{ c }] = await tx.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM "${t.t}" WHERE company_id = $1`, v.a.companyId);
      if (c > 0) found.push(t.t);
    }
    return found;
  });
  assert.ok(own.length >= 10, `the victim has rows in only ${own.length} tables: ${own.join(", ")}`);

  // 3. Nobody else sees any of them, and nobody else can change or delete them.
  type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  const contexts: [string, Run][] = [
    ["another company", (fn) => withTenant(b.companyId, b.userId, fn)],
    ["a signed-in stranger", (fn) => withUser(stranger.id, fn)],
    ["the public", (fn) => withPublic(fn)],
    ["a member of the victim, but with another company selected", (fn) => withTenant(b.companyId, v.a.userId, fn)],
  ];
  for (const [who, run] of contexts) {
    for (const t of own.filter((x) => !PUBLIC_BY_DESIGN.has(x) && !(who.startsWith("a member of the victim") && x === "memberships"))) {
      const seen = await run(async (tx) => (await tx.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM "${t}" WHERE company_id = $1`, v.a.companyId))[0].c);
      assert.equal(seen, 0, `${who} can read ${seen} rows of ${t}`);
      for (const sql of [`UPDATE "${t}" SET company_id = company_id WHERE company_id = $1`, `DELETE FROM "${t}" WHERE company_id = $1`]) {
        try {
          const changed = await run((tx) => tx.$executeRawUnsafe(sql, v.a.companyId));
          assert.equal(changed, 0, `${who} changed ${changed} rows of ${t}: ${sql}`);
        } catch (e) {
          assert.match(String((e as Error).message), /permission denied|row-level security|violates|could not|Transaction/i, `${who}: unexpected failure on ${t}: ${(e as Error).message}`);
        }
      }
    }
  }

  // 4. Nobody can plant rows in the victim's company.
  const plant = (n: string) => ({ data: { companyId: v.a.companyId, name: n, code: n.slice(0, 3).toUpperCase() } });
  await assert.rejects(withTenant(b.companyId, b.userId, (tx) => tx.department.create(plant("Planted one"))), /row-level security/i);
  await assert.rejects(withUser(stranger.id, (tx) => tx.department.create(plant("Planted two"))), /row-level security/i);
  await assert.rejects(withPublic((tx) => tx.department.create(plant("Planted three"))), /row-level security/i);

  // 5. The public sees only published listings, never a draft.
  const listingStatuses = await withPublic((tx) => tx.listing.findMany({ select: { status: true } }));
  assert.ok(listingStatuses.every((l) => l.status === "PUBLISHED"));
});

test("people and sign-in records are not readable across accounts", async () => {
  const a = await newCompany("people-a"), b = await newCompany("people-b");
  // B sees only its own members, and cannot list A's team through any context.
  assert.ok((await listTeam(b)).members.every((m) => m.companyId === b.companyId));
  assert.deepEqual((await myCompanies(a.userId)).map((c) => c.companyId), [a.companyId]);
  assert.ok(!(await myCompanies(b.userId)).some((c) => c.companyId === a.companyId));
  const crossMembers = await withTenant(b.companyId, b.userId, (tx) => tx.membership.findMany({ where: { companyId: a.companyId } }));
  assert.equal(crossMembers.length, 0);
  const crossInvites = await withTenant(b.companyId, b.userId, (tx) => tx.invitation.findMany({ where: { companyId: a.companyId } }));
  assert.equal(crossInvites.length, 0);
});

test("a member cannot raise their own role, and only the administrator can manage the team", async () => {
  const admin = await newCompany("escalate");
  const manager = await addMember(admin, "MANAGER", "mgr"), agent = await addMember(admin, "AGENT", "agt"), viewer = await addMember(admin, "VIEWER", "view"), officer = await addMember(admin, "OFFICER", "off");
  for (const lower of [manager, agent, viewer, officer]) {
    await assert.rejects(inviteMember(lower, { email: `x-${Math.random().toString(36).slice(2, 8)}@example.test`, role: "COMPANY_SUPER_ADMIN" }), /permission/i);
    await assert.rejects(changeMemberRole(lower, lower.membershipId, "COMPANY_SUPER_ADMIN", "ACTIVE"), /permission/i);
    await assert.rejects(changeMemberRole(lower, admin.membershipId, "VIEWER", "SUSPENDED"), /permission/i);
  }
  // Not even the administrator can change their own role or suspend themselves.
  await assert.rejects(changeMemberRole(admin, admin.membershipId, "VIEWER", "ACTIVE"), /cannot change your own/);
  // Changing a member of another company by identifier does not work.
  const other = await newCompany("escalate-other");
  await assert.rejects(changeMemberRole(other, manager.membershipId, "VIEWER", "SUSPENDED"), /not found/);
  assert.equal((await withTenant(admin.companyId, admin.userId, (tx) => tx.membership.findUniqueOrThrow({ where: { id: manager.membershipId } }))).role, "MANAGER");
  // A suspended member has no company to sign in to.
  await changeMemberRole(admin, agent.membershipId, "AGENT", "SUSPENDED");
  assert.deepEqual(await myCompanies(agent.userId), []);
});

test("invitations: single use, expiring, bound to one email and one company", async () => {
  const admin = await newCompany("invites"), other = await newCompany("invites-other");
  const email = `invitee-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const token = await inviteMember(admin, { email, role: "VIEWER" });
  assert.equal(await findInvitation("not-a-token"), null);
  assert.equal(await findInvitation(token.slice(0, -2) + "xx"), null);
  const joined = await acceptInvitation(token, { name: "Invitee Person", password: PASSWORD });
  assert.equal(joined.companyId, admin.companyId);
  const m = await withTenant(admin.companyId, joined.userId, (tx) => tx.membership.findFirstOrThrow({ where: { userId: joined.userId } }));
  assert.equal(m.role, "VIEWER", "the role is the one in the invitation, not one the invitee chose");
  await assert.rejects(acceptInvitation(token, { name: "Again Person", password: PASSWORD }), /invalid or has expired/); // single use

  // An invitation for an existing account can only be accepted by that signed-in account.
  const t2 = await inviteMember(other, { email, role: "MANAGER" });
  await assert.rejects(acceptInvitation(t2, { name: "Impostor", password: PASSWORD }), /Sign in as/);
  await assert.rejects(acceptInvitation(t2, { existingUserId: admin.userId }), /Sign in as/);
  await acceptInvitation(t2, { existingUserId: joined.userId });

  // Expired invitations stop working.
  const t3 = await inviteMember(admin, { email: `late-${Math.random().toString(36).slice(2, 8)}@example.test`, role: "AGENT" });
  await withTenant(admin.companyId, admin.userId, (tx) => tx.invitation.updateMany({ where: { companyId: admin.companyId, acceptedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } }));
  await assert.rejects(acceptInvitation(t3, { name: "Late Person", password: PASSWORD }), /invalid or has expired/);
});

test("documents are released only to roles allowed to download them, and confidential letters only to those who may see them", async () => {
  const v = await victim();
  const viewer = withRole(v.a, "VIEWER"), agent = withRole(v.a, "AGENT");
  // Role checks come first, so even the right identifier gets nothing.
  await assert.rejects(getDocumentForDownload(viewer, v.doc.id), /permission/i);
  await assert.rejects(uploadDocument(viewer, v.asset.id, { title: "Viewer upload", category: "OTHER" }, PDF), /permission/i);
  await assert.rejects(uploadDocument(agent, v.asset.id, { title: "Agent upload", category: "OTHER" }, PDF), /permission/i);
  assert.ok(await getDocumentForDownload(agent, v.doc.id));

  // A member without the confidential right sees the ordinary letter but not the confidential one, nor its attachment, even by identifier.
  const manager = await addMember(v.a, "MANAGER", "mgr"), mgrAsAgent = { ...manager, role: "AGENT" as const };
  assert.ok(await getCorrespondence(mgrAsAgent, v.open.id));
  assert.equal(await getCorrespondence(mgrAsAgent, v.secret.id), null);
  assert.equal(await getCorrespondenceAttachment(mgrAsAgent, v.att.id), null);
  assert.ok(!(await listCorrespondence(mgrAsAgent)).some((r) => r.id === v.secret.id));
  await assert.rejects(addCorrespondenceNote(mgrAsAgent, v.secret.id, "peeking"), /not found|permission/i);
  // The administrator, and the person who registered it, can.
  assert.ok(await getCorrespondence(v.a, v.secret.id));
  assert.ok(await getCorrespondenceAttachment(v.a, v.att.id));

  // Every download is recorded in the audit trail.
  const log = await withTenant(v.a.companyId, v.a.userId, (tx) => tx.activityLog.findMany({ where: { companyId: v.a.companyId, action: { in: ["document.downloaded", "correspondence.attachment_downloaded"] } } }));
  assert.ok(log.length >= 2);
});

test("an uploaded file is checked by its contents, and a stored file can be read back only by its own company", async () => {
  const v = await victim();
  const b = await newCompany("files-b");
  // A program or page renamed as a PDF is refused, whatever it is called.
  for (const bytes of [new Uint8Array(Buffer.from("MZ\x90\x00this is a program")), new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")), new Uint8Array(Buffer.from("<svg onload=alert(1)>"))]) {
    await assert.rejects(uploadDocument(v.a, v.asset.id, { title: "Totally a PDF", category: "OTHER" }, { name: "a.pdf", type: "application/pdf", bytes }), /do not match/);
  }
  for (const type of ["text/html", "image/svg+xml", "application/x-sh"]) {
    await assert.rejects(uploadDocument(v.a, v.asset.id, { title: "Not allowed", category: "OTHER" }, { name: "a.bin", type, bytes: PDF_BYTES }), /Upload a PDF/);
  }
  // The stored bytes are in a table the other company cannot read.
  const keys = await withTenant(v.a.companyId, v.a.userId, (tx) => tx.storedFile.findMany({ where: { companyId: v.a.companyId }, select: { key: true } }));
  assert.ok(keys.length >= 3);
  const seen = await withTenant(b.companyId, b.userId, (tx) => tx.storedFile.findMany({ where: { key: { in: keys.map((k) => k.key) } } }));
  assert.equal(seen.length, 0);
  // Stored names are random, so a file cannot be found by guessing a name.
  for (const k of keys) assert.match(k.key, /^[0-9a-f-]{36}\.(pdf|png|jpg|webp|docx)$/);
});
