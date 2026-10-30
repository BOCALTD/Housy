/**
 * Used by scripts/smoke.sh. Signs in as the demo Company Super Admin and the demo Officer by creating
 * session rows. Prints the administrator's token, the officer's, a seeker's (no company) and the platform administrator's, then every signed-in page
 * worth opening (one path per line). The smoke test opens each with those cookies and fails on any
 * error page. Add new pages here as modules are built, so CI renders them against real data.
 */
import { prisma, withPlatformAdmin, withTenant, withUser } from "../src/lib/db";
import { hashToken, newToken } from "../src/lib/tokens";

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "demo.alpha@example.test" } });
  // Memberships are protected by row-level security; read them through the user's own context.
  const membership = await withUser(user.id, (tx) => tx.membership.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" } }));
  const companyId = membership.companyId;
  const token = newToken();
  await prisma.session.create({
    data: { userId: user.id, companyId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const officer = await prisma.user.findUniqueOrThrow({ where: { email: "demo.officer@example.test" } });
  const officerToken = newToken();
  await prisma.session.create({
    data: { userId: officer.id, companyId, tokenHash: hashToken(officerToken), expiresAt: new Date(Date.now() + 3600_000) },
  });

  const seeker = await prisma.user.findUniqueOrThrow({ where: { email: "demo.seeker@example.test" } });
  const seekerToken = newToken();
  await prisma.session.create({ data: { userId: seeker.id, companyId: null, tokenHash: hashToken(seekerToken), expiresAt: new Date(Date.now() + 3600_000) } });
  const platform = await prisma.user.findFirstOrThrow({ where: { isPlatformAdmin: true } });
  const platformToken = newToken();
  await prisma.session.create({ data: { userId: platform.id, companyId: null, tokenHash: hashToken(platformToken), expiresAt: new Date(Date.now() + 3600_000) } });

  const paths = new Set<string>([
    "/browse", "/browse/short-let", "/me/privacy", "/suspended", "/admin/companies", "/admin/companies?status=suspended", "/admin/reference", "/me/inspections", "/app/bookings", "/app/bookings/route", "/app/setup", "/app/setup?t=DEVELOPER", "/trust", "/admin/cases", "/admin/cases?status=all", "/me", "/me/security", "/me/verification", "/app/verification", "/app/api-keys", "/admin/kyc", "/admin/sign-in-locks", "/admin/partners", "/support", "/admin/launch", "/me/following", "/me/notifications", "/me/plan", "/directory", "/directory?kind=companies", "/directory?kind=developers", "/app/profile", "/admin/plans", "/admin/collaborations", "/admin/moderation", "/admin/rewards", "/admin/rewards/payouts", "/admin/referrals", "/admin/vacancies", "/admin/promotions", "/admin/reviews", "/admin/notifications", "/admin/payments", "/admin/payments?view=invoices", "/admin/payments?view=payments", "/admin/payments?view=events", "/admin/finance", "/admin/ai", "/admin/finance?check=1", "/admin/finance?ledger=ADVERTISING", "/me/billing", "/app/billing", "/me/ads", "/app/ads", "/admin/ads", "/admin/ads?status=APPROVED", "/me/saved", "/find", "/map", "/map?purpose=RENT", "/app/analytics", "/app/assistant", "/app/assistant?q=How+much+rent+is+overdue", "/app/completeness", "/app/map", "/app/map?layer=vacancies", "/admin/vacancies/map", "/find?q=3+bedroom+flat+to+rent+in+Lekki+under+5m", "/me/notification-settings", "/admin/reels", "/reels", "/reels/new", "/reels/mine", "/reels/saved", "/admin/awards", "/admin/completed", "/awards", "/completed", "/app/completed", "/app/reviews", "/me/reviews", "/reviews/write", "/admin/feedback", "/app/promotions", "/feedback", "/referrals", "/rewards", "/vacancies", "/vacancies/new", "/messages", "/flatmates", "/flatmates/profile", "/flatmates/matches", "/flatmates/requests", `/messages/new?to=${user.id}`, "/me/collaborations", `/me/collaborations/new?agent=${user.id}`, "/app/collaborations", "/app/collaborations/new", "/app/collaborations/report",
    "/app", "/app/assets", "/app/assets/new", "/app/correspondence", "/app/correspondence/new",
    "/app/files", "/app/settings", "/app/team", "/app/import", "/app/service-charges", "/app/compliance", "/app/inspections", "/app/inspections/templates", "/app/maintenance", "/app/maintenance/contractors", "/app/maintenance/schedules", "/app/inventory", "/app/inventory/counts", "/app/valuations", "/app/projects", "/app/crm", "/app/crm/clients", "/app/crm/leads", "/app/crm/setup", "/app/deals", "/app/sales", "/app/sales/reports", "/app/commissions", "/app/reports", "/app/reports/rent.csv",
  ]);
  await withTenant(companyId, user.id, async (tx) => {
    for (const a of await tx.asset.findMany({ select: { id: true } })) paths.add(`/app/assets/${a.id}`);
    for (const c of await tx.correspondence.findMany({ select: { id: true } })) paths.add(`/app/correspondence/${c.id}`);
    for (const l of await tx.lease.findMany({ select: { id: true } })) paths.add(`/app/leases/${l.id}`);
    for (const p of await tx.serviceChargePeriod.findMany({ select: { id: true } })) paths.add(`/app/service-charges/${p.id}`);
    for (const i of await tx.inspection.findMany({ select: { id: true } })) paths.add(`/app/inspections/${i.id}`);
    for (const i of await tx.inventoryItem.findMany({ select: { id: true } })) paths.add(`/app/inventory/${i.id}`);
    for (const c of await tx.inventoryCount.findMany({ select: { id: true } })) paths.add(`/app/inventory/counts/${c.id}`);
    for (const l of await tx.lease.findMany({ select: { id: true } })) paths.add(`/app/handover-inventory/${l.id}`);
    for (const w of await tx.workOrder.findMany({ select: { id: true } })) paths.add(`/app/maintenance/${w.id}`);
    for (const v of await tx.valuationInstruction.findMany({ select: { id: true } })) paths.add(`/app/valuations/${v.id}`);
    for (const x of await tx.project.findMany({ select: { id: true } })) { paths.add(`/app/projects/${x.id}`); paths.add(`/app/projects/${x.id}/delivery`); paths.add(`/app/projects/${x.id}/handover`); }
    for (const c of await tx.client.findMany({ select: { id: true } })) paths.add(`/app/crm/clients/${c.id}`);
    for (const x of await tx.deal.findMany({ select: { id: true } })) { paths.add(`/app/deals/${x.id}`); paths.add(`/app/deals/${x.id}/file`); }
    for (const c of await tx.collaboration.findMany({ select: { id: true, kind: true } })) { paths.add(`/app/collaborations/${c.id}`); if (c.kind === "SEEKER_AGENT") paths.add(`/me/collaborations/${c.id}`); }
    for (const r of await tx.receipt.findMany({ select: { id: true } })) paths.add(`/app/receipts/${r.id}`);
    for (const b of await tx.inspectionBooking.findMany({ select: { id: true, scheduledAt: true, status: true } })) {
      paths.add(`/app/bookings/${b.id}`);
      if (b.scheduledAt && b.status !== "REQUESTED") paths.add(`/app/bookings/${b.id}/calendar`);
    }
    for (const x of await tx.safetySession.findMany({ where: { companyId }, select: { id: true } })) paths.add(`/app/safety/${x.id}`);
  });

  await withUser(seeker.id, async (tx) => {
    for (const c of await tx.conversation.findMany({ select: { id: true } })) paths.add(`/messages/${c.id}`);
  });

  await withUser(seeker.id, async (tx) => {
    for (const v of await tx.vacancyReport.findMany({ select: { id: true } })) paths.add(`/vacancies/${v.id}`);
    for (const b of await tx.inspectionBooking.findMany({ where: { requesterId: seeker.id }, select: { ref: true, scheduledAt: true, status: true } })) {
      paths.add(`/me/inspections/${b.ref}`);
      if (b.scheduledAt && b.status !== "REQUESTED") paths.add(`/me/inspections/${b.ref}/calendar`);
    }
  });
  await withPlatformAdmin(platform.id, async (tx) => {
    for (const c of await tx.trustCase.findMany({ select: { ref: true } })) paths.add(`/admin/cases/${c.ref}`);
    for (const c of await tx.company.findMany({ select: { id: true }, take: 3 })) paths.add(`/admin/companies/${c.id}`);
  });
  await withPlatformAdmin(platform.id, async (tx) => {
    for (const v of await tx.vacancyReport.findMany({ select: { id: true } })) paths.add(`/admin/vacancies/${v.id}`);
  });

  await withUser(seeker.id, async (tx) => {
    for (const a of await tx.agentProfile.findMany({ where: { listed: true }, select: { userId: true } })) paths.add(`/agents/${a.userId}`);
    for (const c of await tx.companyProfile.findMany({ where: { listed: true }, select: { companyId: true } })) paths.add(`/companies/${c.companyId}`);
    for (const r of await tx.reel.findMany({ where: { status: "PUBLISHED" }, select: { id: true }, take: 3 })) paths.add(`/reels/${r.id}`);
  });

  // Portals: the demo seeker holds an owner and a vendor grant; for this test run, also make them a member of an approved provider.
  paths.add("/portal"); paths.add("/portal/accept/not-a-real-token"); paths.add("/app/portals"); paths.add("/offline");
  const grants = await withUser(seeker.id, (tx) => tx.portalGrant.findMany({ where: { userId: seeker.id, status: "ACTIVE" }, select: { id: true, kind: true, companyId: true, contractorId: true } }));
  for (const g of grants) {
    paths.add(`/portal/${g.kind === "OWNER" ? "owner" : "vendor"}/${g.id}`);
    if (g.kind === "OWNER") { paths.add(`/portal/owner/${g.id}/statement`); paths.add(`/portal/owner/${g.id}/statement?from=2026-01-01&to=2026-06-30`); paths.add(`/app/portals/statement/${g.id}`); }
    if (g.kind === "VENDOR" && g.contractorId) {
      const jobs = await withTenant(g.companyId, "system", (tx) => tx.workOrder.findMany({ where: { contractorId: g.contractorId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, select: { id: true } }));
      for (const j of jobs) paths.add(`/portal/vendor/${g.id}/jobs/${j.id}`);
    }
  }
  const provider = await prisma.serviceProvider.findFirst({ where: { status: "APPROVED" }, select: { id: true } });
  if (provider) {
    await withPlatformAdmin(platform.id, (tx) => tx.providerMember.upsert({ where: { providerId_userId: { providerId: provider.id, userId: seeker.id } }, create: { providerId: provider.id, userId: seeker.id, addedById: platform.id }, update: {} }));
    paths.add(`/portal/provider/${provider.id}`); paths.add(`/portal/provider/${provider.id}?status=SUBMITTED`);
  }

  // Flatmates: the demo seeker's match profile and their open chat room.
  const { myFlatmateActivity } = await import("../src/lib/services/flatmates");
  for (const m of (await myFlatmateActivity(seeker.id)).matches) { paths.add(`/flatmates/p/${m.other}`); if (m.conversationId) paths.add(`/messages/${m.conversationId}`); }

  console.log(token);
  console.log(officerToken);
  console.log(seekerToken);
  console.log(platformToken);
  for (const p of paths) console.log(p);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
